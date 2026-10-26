import { z } from "zod";

import { settingsService } from "@/services/settings";
import { MAX_MEMORY_CONTENT_LENGTH } from "@/schemas/ai";
import { memoryService, isMemoryEnabled } from "../memory";
import { fail, ok, type AiToolDefinition } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Memory tools
// ─────────────────────────────────────────────────────────────────────────────
//
// The only ways the model reaches saved memories:
//
//  * `get_memories` (READ) — the explicitly saved facts, bounded.
//  * `save_memory` (WRITE, confirmation "autonomous") — saving is a write like
//    any other: in manual mode it is parked as a proposal the student confirms,
//    and it executes without a click only when the student has opted into
//    autonomous execution. Either way a row appears only through the student's
//    own consent path — the tool is never used to extract facts on its own, and
//    the system prompt says so.
//
// Both respect the `ai.memoryEnabled` setting: when the student turns memory
// off, the read comes back empty and the write is refused with a model-readable
// error rather than silently writing rows the prompt will never show.

const memoryCategory = z
  .enum(["PREFERENCE", "ACADEMIC", "GOALS", "SCHEDULE", "OTHER"])
  .describe("Which kind of fact this is.");

const getMemoriesArgs = z.object({
  category: memoryCategory.optional().describe("Only memories of this category."),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

export const getMemoriesTool: AiToolDefinition = {
  name: "get_memories",
  description:
    "List facts the student explicitly saved for you to remember (preferences, goals, schedule constraints). Use them as personal context. Record facts — dates, grades, deadlines — still come from the read tools, never from here.",
  kind: "READ",
  activityLabel: "Checking saved memories",
  parameters: getMemoriesArgs,
  async execute(args, ctx) {
    const input = getMemoriesArgs.parse(args);
    const settings = await settingsService.get(ctx.userId);
    if (!isMemoryEnabled(settings)) {
      return ok({ items: [], enabled: false }, "saved memory is turned off for this account");
    }
    const result = await memoryService.list(ctx.userId, {
      category: input.category,
      limit: input.limit,
    });
    return ok(
      { items: result.items, enabled: true },
      `${result.items.length} saved memor${result.items.length === 1 ? "y" : "ies"}`,
    );
  },
};

const saveMemoryArgs = z.object({
  content: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MEMORY_CONTENT_LENGTH)
    .describe("The fact to remember, in the student's own words."),
  category: memoryCategory.optional().default("OTHER"),
});

export const saveMemoryTool: AiToolDefinition = {
  name: "save_memory",
  description:
    "Save one fact the student explicitly asked you to remember in this conversation (a preference, goal, academic context or schedule constraint). Only call this when the student has asked to be remembered — never extract facts on your own, and never save record data that the read tools already hold. Requires the student's confirmation first, unless autonomous execution is enabled.",
  kind: "WRITE",
  activityLabel: "Saving a memory",
  confirmation: "autonomous",
  parameters: saveMemoryArgs,
  async execute(args, ctx) {
    const input = saveMemoryArgs.parse(args);
    const settings = await settingsService.get(ctx.userId);
    if (!isMemoryEnabled(settings)) {
      return fail(
        "memory_disabled",
        "Saved memory is turned off for this account. Tell the student they can turn it back on in Settings.",
      );
    }
    const { memory, created } = await memoryService.create(
      ctx.userId,
      { content: input.content, category: input.category },
      "AI",
    );
    return ok(
      { ...memory, created },
      created ? "memory saved" : "an identical memory was already saved",
    );
  },
};

export const memoryTools: AiToolDefinition[] = [getMemoriesTool, saveMemoryTool];
