import { confirmationStore } from "./confirmations";
import { config } from "@/config";
import type { AiProvider, ChatMessage, ChatToolCall, ToolChoice } from "./provider";
import { buildAgentSystemPrompt } from "./system-prompt";
import type { StudentContext } from "./context";
import { executeTool, getProviderToolSchemas, getTool } from "./tools/registry";
import type { AiToolContext, AiToolResult, ProposedAction } from "./tools/types";

// ─────────────────────────────────────────────────────────────────────────────
// The tool-calling agent loop
// ─────────────────────────────────────────────────────────────────────────────
//
// A bounded, provider-agnostic loop:
//
//   1. ask the model what it needs,
//   2. run whatever tools it asked for through the registry,
//   3. hand the results back and repeat,
//   4. stop as soon as it answers in prose.
//
// Four hard limits, all of them here rather than in the prompt so a
// non-compliant model cannot blow past them:
//
//  * `MAX_TOOL_ROUNDS` provider round-trips (4). A model that keeps calling
//    tools is cut off and forced to answer from what it already has.
//  * `MAX_TOOL_CALLS` tool calls per run (12), so one turn cannot fan out into
//    hundreds of database reads regardless of how many rounds it takes.
//  * `MAX_PROPOSED_ACTIONS` changes in a single proposal (8), so a runaway model
//    cannot bury the student under a hundred confirmations.
//  * A write attempt ends the round and forces a prose turn, so the model
//    cannot "confirm" its own proposal by calling the write tool again.
//
// Tool output is truncated before it goes back into the prompt, so a large
// result cannot blow the context window on the next call.
//
// `config.aiAgentMax*` may lower these for a deployment; it can never raise them
// past the ceilings above.

export const MAX_TOOL_ROUNDS = 4;
export const MAX_TOOL_CALLS = 12;
export const MAX_PROPOSED_ACTIONS = 8;

/** How much of a single tool result is fed back to the model. */
const MAX_TOOL_RESULT_CHARS = 6000;

/** Conversation turns replayed to the model (the user's own words only). */
const MAX_HISTORY_MESSAGES = 12;

const MAX_USER_MESSAGE_CHARS = 4000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** One entry in the "what the assistant is doing" feed the UI renders. */
export interface ToolActivityEntry {
  tool: string;
  /** Present-tense label, e.g. "Checking your exams". */
  label: string;
  status: "success" | "error" | "proposed";
  /** One-line, user-safe outcome. */
  summary: string;
}

export interface AgentRunInput {
  provider: AiProvider;
  /** Authenticated user id. Everything the agent touches is scoped to it. */
  userId: string;
  conversationId: string;
  history: Array<{ role: string; content: string }>;
  userMessage: string;
  studentName?: string | null;
  /** The JSON context snapshot, used only on the no-tools fallback path. */
  context?: string;
  /**
   * The same snapshot as a structured object, inlined into the tool-path system
   * prompt so the model starts oriented instead of blind. The no-tools path uses
   * the serialized `context` above.
   */
  studentContext?: StudentContext | null;
  /**
   * Exact calls the student has already approved this turn. Non-null only for
   * a turn that is explicitly approving a stored proposal.
   */
  approvedActions?: ProposedAction[] | null;
  maxRounds?: number;
}

export interface AgentRunResult {
  /** The assistant's answer. Never empty. */
  content: string;
  toolActivity: ToolActivityEntry[];
  /** Actions the model asked for that still need the student's confirmation. */
  proposedActions: ProposedAction[];
  /** True when at least one tool ran. */
  usedTools: boolean;
  rounds: number;
  /** How the loop ended, useful for tests and for the API response. */
  finish: "answered" | "tool_limit" | "confirmation_pending" | "no_tool_support";
}

// ─────────────────────────────────────────────────────────────────────────────
// The loop
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const { provider } = input;

  // Providers without native tool support (Gemini, Anthropic) keep the legacy
  // grounded behaviour: one grounded call with the data snapshot inlined.
  if (!provider.supportsTools()) {
    const legacy = await provider.chat({
      messages: [...input.history, { role: "user", content: input.userMessage }],
      ...(input.context ? { context: input.context } : {}),
    });
    return {
      content: legacy.content,
      toolActivity: [],
      proposedActions: [],
      usedTools: false,
      rounds: 1,
      finish: "no_tool_support",
    };
  }

  const pending = confirmationStore.getPending(input.userId, input.conversationId);
  const tools = getProviderToolSchemas();

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        studentName: input.studentName,
        studentContext: input.studentContext,
        pendingProposal: pending
          ? {
              id: pending.id,
              title: pending.title,
              actionCount: pending.actions.length,
              expiresAt: pending.expiresAt,
            }
          : null,
      }),
    },
    ...buildHistory(input.history),
    { role: "user", content: input.userMessage.slice(0, MAX_USER_MESSAGE_CHARS) },
  ];

  const toolActivity: ToolActivityEntry[] = [];
  const proposals: ProposedAction[] = [];
  const maxRounds = clamp(input.maxRounds ?? config.aiAgentMaxToolRounds, MAX_TOOL_ROUNDS);
  const maxToolCalls = clamp(config.aiAgentMaxToolCalls, MAX_TOOL_CALLS);
  const maxProposals = clamp(config.aiAgentMaxProposedActions, MAX_PROPOSED_ACTIONS);
  let rounds = 0;
  let toolCallsRun = 0;
  let forceProse = false;
  let budgetNote: string | null = null;

  for (let round = 0; round < maxRounds; round += 1) {
    rounds += 1;

    const turn = await provider.chatWithTools({
      messages,
      ...(forceProse ? { toolChoice: "none" as ToolChoice } : { tools }),
    });

    const toolCalls = turn.toolCalls ?? [];

    // A prose turn with no tool calls is the answer.
    if (toolCalls.length === 0) {
      return {
        content: nonEmpty(turn.content) ?? fallbackText(toolActivity, proposals),
        toolActivity,
        proposedActions: proposals,
        usedTools: toolActivity.length > 0,
        rounds,
        finish: proposals.length > 0 ? "confirmation_pending" : "answered",
      };
    }

    // Call budget left: run what fits, and tell the model the rest was dropped
    // rather than silently running a subset it believes is complete.
    const runnable = toolCallsRun + toolCalls.length <= maxToolCalls
      ? toolCalls
      : toolCalls.slice(0, Math.max(0, maxToolCalls - toolCallsRun));
    if (runnable.length < toolCalls.length) {
      budgetNote = `I stopped after ${maxToolCalls} tool calls for this turn. Ask me about the rest separately and I'll pick it up.`;
    }
    toolCallsRun += runnable.length;

    messages.push({ role: "assistant", content: turn.content ?? null, toolCalls: runnable });

    const { results, roundProposals, activity } = await runToolCalls(
      runnable,
      input,
      Math.max(0, maxProposals - proposals.length),
    );
    toolActivity.push(...activity);

    for (const [index, result] of results.entries()) {
      messages.push({
        role: "tool",
        toolCallId: runnable[index]?.id ?? `call_${index}`,
        name: runnable[index]?.function.name,
        content: serializeToolResult(result),
      });
    }

    // Anything that still needs approval is parked for the student. Recording
    // it here (rather than in the tool) keeps the write path read-only until
    // `confirm_pending_actions` runs.
    proposals.push(...roundProposals);

    // A proposal was just created: the next turn is prose-only so the model
    // explains and asks, and cannot chain more writes behind the first one.
    if (roundProposals.length > 0) forceProse = true;

    // The proposal budget is spent, so stop asking for more approval.
    if (proposals.length >= maxProposals) {
      budgetNote = `I prepared ${proposals.length} changes, which is the limit for one turn. Review those, then ask for the rest.`;
      break;
    }
  }

  // Round budget exhausted. One last, tool-free turn so the student gets an
  // answer instead of a truncated tool trace.
  const finalTurn = await provider.chatWithTools({
    messages,
    toolChoice: "none",
  });

  const finalContent =
    nonEmpty(finalTurn.content) ??
    "I looked through several of your records but did not reach a conclusion. Try asking about one thing at a time.";

  return {
    content: budgetNote ? `${finalContent}\n\n${budgetNote}` : finalContent,
    toolActivity,
    proposedActions: proposals,
    usedTools: toolActivity.length > 0,
    rounds,
    finish: proposals.length > 0 ? "confirmation_pending" : "tool_limit",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool execution
// ─────────────────────────────────────────────────────────────────────────────

async function runToolCalls(
  toolCalls: ChatToolCall[],
  input: AgentRunInput,
  remainingProposals: number,
): Promise<{ results: AiToolResult[]; roundProposals: ProposedAction[]; activity: ToolActivityEntry[] }> {
  // The allow-list is scoped to this turn. A write tool that is not on it is
  // refused by the registry, whatever the model asks for.
  const ctx: AiToolContext = {
    userId: input.userId,
    conversationId: input.conversationId,
    approvedActions: input.approvedActions ?? null,
  };

  const results: AiToolResult[] = [];
  const roundProposals: ProposedAction[] = [];
  const activity: ToolActivityEntry[] = [];

  for (const call of toolCalls) {
    const tool = getTool(call.function.name);
    const label = tool?.activityLabel ?? "Running a tool";
    const isWrite = tool?.kind === "WRITE";

    // The proposal budget is spent: refuse further writes with an explanation
    // the model can act on, rather than silently dropping them.
    if (isWrite && remainingProposals - roundProposals.length <= 0) {
      const message = "This turn already has as many pending changes as it is allowed. Ask again for the rest.";
      results.push({ ok: false, error: { code: "proposal_limit", message } });
      activity.push({ tool: call.function.name, label, status: "error", summary: message });
      continue;
    }

    const result = await executeTool(
      { name: call.function.name, arguments: call.function.arguments },
      ctx,
    );

    results.push(result);

    if (result.proposedActions && result.proposedActions.length > 0) {
      roundProposals.push(...result.proposedActions);
      activity.push({
        tool: call.function.name,
        label,
        status: "proposed",
        summary: `Waiting for your confirmation (${result.proposedActions.length} change${result.proposedActions.length === 1 ? "" : "s"})`,
      });
      continue;
    }

    activity.push(
      result.ok
        ? { tool: call.function.name, label, status: "success", summary: result.summary ?? "Done" }
        : { tool: call.function.name, label, status: "error", summary: result.error?.message ?? "Tool failed" },
    );
  }

  return { results, roundProposals, activity };
}

/** A configured value, forced into 1..ceiling so config can only tighten. */
function clamp(value: number, ceiling: number): number {
  if (!Number.isFinite(value)) return ceiling;
  return Math.max(1, Math.min(Math.floor(value), ceiling));
}

/**
 * How a result looks to the model: a compact JSON envelope. Errors are returned
 * as data, not thrown, so the model can read the reason and correct itself.
 */
function serializeToolResult(result: AiToolResult): string {
  const payload = result.ok
    ? { ok: true, data: result.data ?? null, summary: result.summary ?? null }
    : { ok: false, error: result.error };

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    serialized = JSON.stringify({ ok: result.ok, error: { code: "unserializable", message: "Result could not be encoded." } });
  }

  if (serialized.length <= MAX_TOOL_RESULT_CHARS) return serialized;
  return `${serialized.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Replay the last N conversation turns as plain user/assistant messages. */
function buildHistory(history: Array<{ role: string; content: string }>): ChatMessage[] {
  return history
    .filter((m) => m.role === "USER" || m.role === "ASSISTANT")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role === "ASSISTANT" ? ("assistant" as const) : ("user" as const),
      content: m.content.slice(0, MAX_USER_MESSAGE_CHARS),
    }));
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * If the provider answered with tool calls but no text (a model that thinks in
 * tools), the student still needs a sentence. Derive one from what happened
 * rather than inventing an answer.
 */
function fallbackText(activity: ToolActivityEntry[], proposals: ProposedAction[]): string {
  if (proposals.length > 0) {
    return `I've prepared ${proposals.length} change${proposals.length === 1 ? "" : "s"} for you. Review the details below and confirm if you'd like me to apply ${proposals.length === 1 ? "it" : "them"}.`;
  }
  if (activity.some((a) => a.status === "error")) {
    return "I couldn't read everything I needed just now. Could you try asking that again, or narrow it down?";
  }
  if (activity.length > 0) {
    return "I've pulled up the relevant records, but I'd like a moment to summarise them properly — could you ask me again?";
  }
  return "I don't have enough information to answer that yet. Could you add a bit more detail?";
}
