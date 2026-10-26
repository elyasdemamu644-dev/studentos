// ─────────────────────────────────────────────────────────────────────────────
// Per-mode execution profiles
// ─────────────────────────────────────────────────────────────────────────────
//
// A behaviour mode is not only a paragraph of prompt text: it also changes how
// the agent loop runs. This table is the single source of that difference, so a
// mode is observable on the wire (its provider request and the loop's budget)
// rather than only in wording.
//
// Three levers, all enforced in `agent.ts` — never merely suggested to a model
// that could ignore them:
//
//  * `maxRounds`      — provider round-trips allowed for the turn.
//  * `maxToolCalls`   — tool calls allowed for the turn.
//  * `toolKinds`      — which kinds of tool the model may see and run. A mode
//                       without `WRITE` is read-only: it can read and analyse,
//                       but it can prepare no change. The confirmation gate is
//                       untouched — a mode that does allow writes still parks
//                       every one for the student.
//
// `AUTO` has no profile: it keeps the deployment's configured budget and every
// tool, so someone who never picks a mode gets exactly the behaviour that
// existed before modes were introduced.

import type { AiMode } from "@/schemas/ai";
import type { AiToolKind } from "./tools/types";

export interface AiModeExecution {
  /** Provider round-trips allowed for this turn (also clamped by config). */
  maxRounds: number;
  /** Tool calls allowed for this turn (also clamped by config). */
  maxToolCalls: number;
  /** Tool kinds the model may see and run. Omitting `WRITE` makes a mode read-only. */
  toolKinds: readonly AiToolKind[];
}

const ALL_KINDS: readonly AiToolKind[] = ["READ", "ANALYZE", "WRITE"];
const READ_ONLY_KINDS: readonly AiToolKind[] = ["READ", "ANALYZE"];

/**
 * `confirm_pending_actions` is the student's approval of a proposal they were
 * shown earlier. It is never blocked by a read-only mode: refusing it would
 * strand a change the student explicitly asked for (and, since the proposal was
 * already presented under the confirmation gate, allowing it weakens nothing).
 */
export const ALWAYS_ALLOWED_TOOL = "confirm_pending_actions";

export const AI_MODE_EXECUTION: Record<Exclude<AiMode, "AUTO">, AiModeExecution> = {
  // One round, a handful of calls: a quick answer, not an investigation.
  QUICK: { maxRounds: 1, maxToolCalls: 3, toolKinds: ALL_KINDS },
  // Reasoning over the student's data, but no changes: think, don't act.
  THINK: { maxRounds: 4, maxToolCalls: 12, toolKinds: READ_ONLY_KINDS },
  // A deliverable is a write (saved file), so BUILDER keeps the write tools.
  BUILDER: { maxRounds: 4, maxToolCalls: 12, toolKinds: ALL_KINDS },
  // End-to-end: the full budget, reads and writes.
  AGENT: { maxRounds: 4, maxToolCalls: 12, toolKinds: ALL_KINDS },
  // Read the sources and answer from them; never change the student's data.
  RESEARCH: { maxRounds: 3, maxToolCalls: 10, toolKinds: READ_ONLY_KINDS },
  // Teach from what already exists; a short, read-only turn.
  STUDY: { maxRounds: 2, maxToolCalls: 6, toolKinds: READ_ONLY_KINDS },
};

/** The profile for a mode, or null for `AUTO`/unset/unknown (use config defaults). */
export function executionForMode(mode: AiMode | null | undefined): AiModeExecution | null {
  if (!mode || mode === "AUTO") return null;
  return AI_MODE_EXECUTION[mode] ?? null;
}

/**
 * Whether a mode may prepare changes at all. `AUTO`/unset may (it is the
 * unrestricted baseline); a mode whose profile omits `WRITE` may not.
 */
export function modeAllowsWrites(mode: AiMode | null | undefined): boolean {
  const profile = executionForMode(mode);
  return !profile || profile.toolKinds.includes("WRITE");
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution autonomy (manual vs autonomous)
// ─────────────────────────────────────────────────────────────────────────────
//
// Execution autonomy is a per-user setting that controls whether a curated set
// of "safe" WRITE tools can execute without requiring the student's explicit
// confirmation. It is independent of AI mode (which controls reasoning depth)
// and model/provider selection (which controls which model answers).
//
// - "manual" (default): every WRITE tool requires explicit confirmation.
// - "autonomous": a curated set of safe WRITE tools runs automatically after
//   the student enables this mode. The student can still review and cancel
//   pending actions if desired.
//
// The autonomy mode is read from the user's settings (`ai.executionMode`)
// and checked in the tool registry before the confirmation gate.

import type { ExecutionAutonomyMode } from "@/schemas/ai";

/** Check if the user has enabled autonomous execution mode. */
export function isAutonomousExecution(mode: ExecutionAutonomyMode | null | undefined): boolean {
  return mode === "autonomous";
}

// Which WRITE tools are safe to run autonomously is declared on each tool
// definition (`confirmation: "autonomous"`), next to the tool it describes.
// The registry's `toolNeedsApproval` is the single rule that reads it; there is
// deliberately no second list here that could drift away from the tools.
