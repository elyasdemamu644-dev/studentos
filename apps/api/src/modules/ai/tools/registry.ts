import { ZodError } from "zod";

import { readTools } from "./read-tools";
import { analyzeTools } from "./analyze-tools";
import { actionTools } from "./action-tools";
import { confirmPendingActionsTool } from "./confirm-tool";
import { zodToJsonSchema } from "./json-schema";
import type {
  AiToolContext,
  AiToolDefinition,
  AiToolKind,
  AiToolResult,
  ProviderToolSchema,
  ProposedAction,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Tool registry
// ─────────────────────────────────────────────────────────────────────────────
//
// The single entry point between the model and StudentOS. Everything the model
// can do goes through `executeTool`, which:
//
//   1. refuses an unknown tool name,
//   2. validates the arguments with the tool's Zod schema (which strips any
//      key the schema does not declare — that is how a model-supplied `userId`
//      is discarded before the handler runs),
//   3. enforces the confirmation gate for WRITE tools, and
//   4. converts every thrown error into a safe, model-readable result.
//
// It never throws for a tool-level problem, and it never re-throws a raw
// service error, so nothing internal can leak into the model's context.

/** Tool names are sent in `tools[].function.name`, which is a constrained charset. */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

const REGISTRY = new Map<string, AiToolDefinition>();

export function registerTool(tool: AiToolDefinition): AiToolDefinition {
  if (!TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error(`Invalid AI tool name "${tool.name}" — expected ${TOOL_NAME_PATTERN}`);
  }
  if (REGISTRY.has(tool.name)) {
    throw new Error(`AI tool "${tool.name}" is already registered`);
  }
  // Fail at import time rather than at model-call time if a schema uses a Zod
  // construct the JSON-Schema converter does not support.
  zodToJsonSchema(tool.parameters);
  REGISTRY.set(tool.name, tool);
  return tool;
}

for (const tool of [...readTools, ...analyzeTools, ...actionTools, confirmPendingActionsTool]) {
  registerTool(tool);
}

export function getTool(name: string): AiToolDefinition | undefined {
  return REGISTRY.get(name);
}

export function listTools(kind?: AiToolKind): AiToolDefinition[] {
  const all = [...REGISTRY.values()];
  return kind ? all.filter((t) => t.kind === kind) : all;
}

export function getToolNames(): string[] {
  return [...REGISTRY.keys()];
}

/** The `tools` payload for an OpenAI-compatible chat-completions request. */
export function getProviderToolSchemas(names?: string[]): ProviderToolSchema[] {
  const selected = names
    ? names.map((name) => REGISTRY.get(name)).filter((t): t is AiToolDefinition => Boolean(t))
    : listTools();

  return selected.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters),
    },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolCallRequest {
  name: string;
  /** Raw JSON string from the model; parsed and validated here. */
  arguments: string | Record<string, unknown> | null | undefined;
}

/**
 * Run one tool call on behalf of `ctx.userId`.
 *
 * Always resolves — a failure comes back as `{ ok: false, error }` so the agent
 * can hand the model a readable reason and let it recover.
 */
export async function executeTool(
  call: ToolCallRequest,
  ctx: AiToolContext,
): Promise<AiToolResult> {
  const tool = REGISTRY.get(call.name);
  if (!tool) {
    return {
      ok: false,
      error: {
        code: "unknown_tool",
        message: `No tool named "${call.name}". Available tools: ${getToolNames().join(", ")}.`,
      },
    };
  }

  // ── Arguments ──────────────────────────────────────────────────────────────
  let raw: unknown;
  if (typeof call.arguments === "string") {
    const trimmed = call.arguments.trim();
    if (trimmed === "") raw = {};
    else {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        return {
          ok: false,
          error: {
            code: "invalid_arguments",
            message: `Arguments for ${tool.name} were not valid JSON. Re-send them as a JSON object.`,
          },
        };
      }
    }
  } else {
    raw = call.arguments ?? {};
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: { code: "invalid_arguments", message: `Arguments for ${tool.name} must be a JSON object.` },
    };
  }

  let parsed: unknown;
  try {
    parsed = tool.parameters.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        error: {
          code: "invalid_arguments",
          message: `Arguments for ${tool.name} did not match its schema: ${formatZodIssues(error)}`,
          details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      };
    }
    return { ok: false, error: { code: "invalid_arguments", message: `Arguments for ${tool.name} could not be validated.` } };
  }

  const args = parsed as Record<string, unknown>;

  // ── Confirmation gate ──────────────────────────────────────────────────────
  if (tool.kind === "WRITE" && (tool.confirmation ?? "required") === "required") {
    if (!isApproved(ctx.approvedActions, tool.name, args)) {
      return {
        ok: false,
        error: {
          code: "confirmation_required",
          message: `${tool.name} changes StudentOS data and cannot run yet. Present the change to the student and ask them to confirm; do not claim it succeeded.`,
        },
        // Returning the validated call lets the agent turn it into a proposal
        // the student can approve with one click.
        proposedActions: [{ tool: tool.name, description: describeAction(tool, args), arguments: args }],
      };
    }
  }

  // ── Run ────────────────────────────────────────────────────────────────────
  try {
    const result = await tool.execute(args, ctx);
    return { ...result, proposedActions: result.proposedActions ?? [] };
  } catch (error) {
    return toSafeFailure(tool.name, error);
  }
}

/**
 * Is this exact call on the student's approved list?
 *
 * Compared by value, not identity: the proposal stores the arguments the
 * student was shown, so an approved `create_task` cannot be widened into
 * `create_task` with a different title mid-flight.
 */
function isApproved(approved: ProposedAction[] | null, name: string, args: Record<string, unknown>): boolean {
  if (!approved) return false;
  return approved.some((a) => a.tool === name && deepEqual(a.arguments, args));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

/** A one-line description used when the model asks for a write directly. */
function describeAction(tool: AiToolDefinition, args: Record<string, unknown>): string {
  const label = Object.entries(args)
    .filter(([key, value]) => value !== undefined && value !== null && !key.toLowerCase().endsWith("id"))
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 80)}`)
    .join(", ");
  return label ? `${tool.activityLabel.replace(/^[^ ]+ /, "")} (${label})` : tool.activityLabel;
}

function formatZodIssues(error: ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Translate a thrown service error into something the model can act on.
 *
 * `ApiError` messages are already user-safe (`"Course not found"`), so they are
 * forwarded with their code. Anything else is reduced to a generic failure —
 * a stack trace or a raw Prisma message must never reach the prompt.
 */
function toSafeFailure(toolName: string, error: unknown): AiToolResult {
  if (error && typeof error === "object" && "code" in error && "statusCode" in error) {
    const apiError = error as unknown as { code: string; message: string };
    return { ok: false, error: { code: apiError.code.toLowerCase(), message: apiError.message } };
  }
  return {
    ok: false,
    error: { code: "tool_execution_failed", message: `${toolName} could not be completed. Try again or explain the problem to the student.` },
  };
}
