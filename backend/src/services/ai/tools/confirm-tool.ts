import { z } from "zod";

import { confirmationStore, summarizeOutcomes, type ConfirmationActionOutcome } from "@/services/ai/confirmations";

// Type-only import: erased at compile time, so it does not close the runtime
// cycle with registry.ts (which imports this module to build its table).
import type { executeTool } from "./registry";

import type { AiToolDefinition, ProposedAction } from "./types";
import { fail, ok } from "./types";
import { verifyExecutedAction } from "./verify";

// ─────────────────────────────────────────────────────────────────────────────
// confirm_pending_actions
// ─────────────────────────────────────────────────────────────────────────────
//
// The one tool whose invocation *is* the student's approval. It is the chat-side
// of the confirmation flow: the UI has a Confirm button that hits a REST
// endpoint, and a student who simply types "create it" reaches the same place
// through this tool. Either way `consumeProposal` is what releases the
// arguments, so the two paths cannot diverge.

const confirmArgs = z.object({
  confirmationId: z
    .string()
    .min(1)
    .describe("Id of the pending action the student is approving. Shown in the confirmation prompt."),
});

export const confirmPendingActionsTool: AiToolDefinition = {
  name: "confirm_pending_actions",
  description:
    "Execute the actions of a pending proposal the student just approved. Only call this when the student has explicitly said yes to a proposal you presented (for example 'create it', 'yes, do that'). Never call it otherwise.",
  kind: "WRITE",
  confirmation: "self",
  activityLabel: "Applying your confirmed actions",
  parameters: confirmArgs,
  async execute(args, ctx) {
    const { confirmationId } = confirmArgs.parse(args);

    // Dynamic import: the registry imports this module to build its table, so a
    // static import would close an ESM cycle. Matches the pattern already used
    // between `ai` and `ai-connections`.
    const { executeTool } = await import("./registry");

    const proposal = confirmationStore.consume(ctx.userId, ctx.conversationId, confirmationId);
    if (!proposal) {
      return fail(
        "no_pending_action",
        "That proposal is no longer pending — it was already applied, cancelled, or it expired. Re-check with a read tool and offer the actions again.",
      );
    }

    const executed = await executeProposalActions(proposal.actions, ctx, executeTool);
    const summary = summarizeOutcomes(executed);

    confirmationStore.complete(proposal.id, {
      executed: executed.filter((e) => e.ok).length,
      verified: executed.filter((e) => e.ok && e.verified).length,
      failed: executed.filter((e) => !e.ok).length,
      summary,
    });

    return {
      ...ok({ executed, confirmationId: proposal.id }, summary),
      // The proposal is spent; never offer it for approval a second time.
      proposedActions: [],
    };
  },
};

/**
 * Run an approved set of actions, then prove each one landed.
 *
 * Each step goes back through `executeTool` with a single-entry allow-list, so a
 * write can never execute more than what the student was shown — the same
 * validation and error shaping applies here as on a normal call. Afterwards each
 * changed record is re-read through its own service and the approved fields are
 * compared, so a returned `ok` is never reported as success on its own.
 *
 * Failures are per action and never abort the batch: a proposal that saves four
 * study sessions and loses one to a bad time still applies the other three, and
 * says exactly that.
 */
export async function executeProposalActions(
  actions: ProposedAction[],
  ctx: { userId: string; conversationId: string },
  runner: typeof executeTool,
): Promise<ConfirmationActionOutcome[]> {
  const outcomes: ConfirmationActionOutcome[] = [];

  for (const action of actions) {
    const result = await runner(
      { name: action.tool, arguments: action.arguments },
      { userId: ctx.userId, conversationId: ctx.conversationId, approvedActions: [action] },
    );

    if (!result.ok) {
      outcomes.push({
        tool: action.tool,
        description: action.description,
        ok: false,
        verified: false,
        error: result.error?.message ?? "Action failed",
      });
      continue;
    }

    const recordId = extractRecordId(result.data);
    const verification = await verifyExecutedAction(
      ctx.userId,
      action.tool,
      action.arguments as Record<string, unknown>,
      result.data,
    );

    outcomes.push({
      tool: action.tool,
      description: action.description,
      ok: true,
      verified: verification.verified,
      recordId,
      ...(verification.verified
        ? { verification: verification.message }
        : { error: verification.message, verification: verification.message }),
    });
  }

  return outcomes;
}

/** Pull the created record's id out of a tool payload, when it has one. */
function extractRecordId(data: unknown): string | null {
  if (data && typeof data === "object" && "id" in data) {
    const id = (data as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return null;
}
