import { z } from "zod";

import { artifactsService } from "@/services/ai/artifacts";
import type { AiToolDefinition } from "./types";
import { ok } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// create_artifact — save a generated document as a downloadable file
// ─────────────────────────────────────────────────────────────────────────────
//
// The AI writes study guides, summaries and revision sheets as prose. Without a
// way to save them, the text scrolls away and the student has no file to
// reopen. This tool turns a generated document into a real file in the
// workspace, attached to the conversation it was produced in.
//
// It is a WRITE tool, so the registry blocks it until the student confirms the
// exact content — the assistant shows the file before offering to save it.

const createArtifactArgs = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe("File name, e.g. 'Chapter 9 study guide'. Do not include a path."),
  description: z
    .string()
    .max(2000)
    .optional()
    .describe("One-line description shown next to the file."),
  content: z
    .string()
    .min(1)
    .max(50000)
    .describe("The full text of the document to save. This is the file's contents."),
});

export const createArtifactTool: AiToolDefinition = {
  name: "create_artifact",
  description:
    "Save a generated document (a study guide, summary, revision sheet or essay) as a downloadable file in the student's workspace, attached to this conversation. Requires the student's confirmation first — show them the full content before proposing it.",
  kind: "WRITE",
  activityLabel: "Saving a file",
  parameters: createArtifactArgs,
  async execute(args, ctx) {
    const input = createArtifactArgs.parse(args);
    const artifact = await artifactsService.createFromText(ctx.userId, ctx.conversationId, {
      name: input.name,
      description: input.description,
      content: input.content,
    });
    // Record it so the assistant message this reply becomes can link to it.
    ctx.createdArtifactIds?.push(artifact.id);
    return ok(
      { id: artifact.id, name: artifact.name, mimeType: artifact.mimeType, size: artifact.size },
      `Saved "${artifact.name}"`,
    );
  },
};

export const artifactTools: AiToolDefinition[] = [createArtifactTool];
