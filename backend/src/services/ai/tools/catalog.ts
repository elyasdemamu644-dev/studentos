import type { ExecutionAutonomyMode } from "@/schemas/ai";

import { zodToJsonSchema } from "./json-schema";
import { isAutonomousExecution } from "../mode-execution";
import { listTools, toolNeedsApproval } from "./registry";
import type { AiToolDefinition, AiToolKind, JsonSchemaObject } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Mission tool catalog
// ─────────────────────────────────────────────────────────────────────────────
//
// A mission is a plan the *student* writes: a list of steps, each one a tool
// call with explicit arguments. This module is the contract that makes that
// possible — it lists the tools a mission may use and, for each one, the JSON
// Schema of its arguments.
//
// The schema is the same one the model is given (`zodToJsonSchema` over the
// tool's own Zod schema), so the builder cannot drift from what the tool
// actually accepts: a field the student fills in is validated by the tool
// itself when the step runs.
//
// Two things are deliberately *not* in here:
//
//  - The tool's handler. A catalog entry describes a tool; running it is the
//    registry's job.
//  - The `"self"` tools. `confirm_pending_actions` *is* the student's approval
//    gesture — running it is the confirmation. A mission step has nowhere to
//    ask that question, so such tools are not offered as steps at all (and
//    `validatePlan` refuses them if one is sent anyway).

/** How a tool satisfies the confirmation requirement, as the builder sees it. */
export type MissionToolConfirmation = "none" | "required" | "autonomous";

/** One tool a mission step may use. */
export interface MissionToolCatalogEntry {
  /** Stable tool name, e.g. `create_task`. */
  name: string;
  /** READ, ANALYZE or WRITE. */
  kind: AiToolKind;
  /** Short present-tense label for the UI, e.g. "Creating your task". */
  activityLabel: string;
  /** What the tool does, in one or two sentences. */
  description: string;
  /**
   * Whether the tool changes data and how that change is confirmed.
   *
   *  - `"none"` — the tool only reads or analyses; it changes nothing.
   *  - `"required"` — the tool changes data and needs the student's approval.
   *  - `"autonomous"` — the tool changes data, but runs on its own while the
   *    student has autonomous execution enabled.
   */
  confirmation: MissionToolConfirmation;
  /**
   * Whether this student has to approve the tool before it runs.
   *
   * Computed for the student asking, from the same rule the registry's
   * confirmation gate uses — so the builder never promises an approval the
   * runtime would not ask for, or hides one it would.
   */
  requiresApproval: boolean;
  /** JSON Schema of the tool's arguments. */
  parameters: JsonSchemaObject;
}

/** The catalog, plus the autonomy mode it was computed for. */
export interface MissionToolCatalog {
  tools: MissionToolCatalogEntry[];
  /** The student's execution autonomy mode (`manual` or `autonomous`). */
  executionAutonomyMode: ExecutionAutonomyMode;
}

/**
 * Build the catalog for one student.
 *
 * `mode` is the student's execution autonomy setting. It only affects
 * `requiresApproval`: the tool list itself is the same for everybody.
 */
export function buildMissionToolCatalog(mode: ExecutionAutonomyMode): MissionToolCatalog {
  const autonomous = isAutonomousExecution(mode);
  const tools = listTools()
    .filter((tool) => tool.confirmation !== "self")
    .map((tool) => toCatalogEntry(tool, autonomous));

  return { tools, executionAutonomyMode: mode };
}

function toCatalogEntry(tool: AiToolDefinition, autonomous: boolean): MissionToolCatalogEntry {
  return {
    name: tool.name,
    kind: tool.kind,
    activityLabel: tool.activityLabel,
    description: tool.description,
    confirmation: catalogConfirmation(tool),
    requiresApproval: toolNeedsApproval(tool, autonomous),
    parameters: zodToJsonSchema(tool.parameters),
  };
}

/**
 * How the catalog reports a tool's confirmation requirement.
 *
 * Only WRITE tools can change anything, so only they have a requirement to
 * report; `"self"` never reaches here (those tools are filtered out above).
 */
function catalogConfirmation(tool: AiToolDefinition): MissionToolConfirmation {
  if (tool.kind !== "WRITE") return "none";
  return tool.confirmation === "autonomous" ? "autonomous" : "required";
}
