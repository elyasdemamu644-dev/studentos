import { z } from "zod";

export const idSchema = z.string().min(1);

export const conversationTypeSchema = z.enum(["CHAT", "TUTOR", "QUIZ", "STUDY_PLAN", "EXPLAIN"]);

// ── AI modes ────────────────────────────────────
//
// An AI mode is the *behaviour* the assistant runs a turn in — how long it
// answers, whether it reasons first, whether it produces a deliverable. It is a
// per-user preference, deliberately separate from the selected model (which
// only changes *who* answers) and from the write-confirmation rules (which no
// mode can relax). `AUTO` keeps the existing balanced behaviour.

export const AI_MODES = ["AUTO", "QUICK", "THINK", "BUILDER", "AGENT", "RESEARCH", "STUDY"] as const;

export const aiModeSchema = z.enum(AI_MODES);

export type AiMode = z.infer<typeof aiModeSchema>;

export const DEFAULT_AI_MODE: AiMode = "AUTO";

/** Narrow an unknown settings value to a known mode. */
export function isAiMode(value: unknown): value is AiMode {
  return typeof value === "string" && (AI_MODES as readonly string[]).includes(value);
}

export const createConversationSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  type: conversationTypeSchema.optional(),
});

/**
 * Rename surface for a conversation. Only `title` is editable — the type is
 * chosen when the conversation is created, and everything else on the record
 * is derived.
 */
export const updateConversationSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
});

export const messageRoleSchema = z.enum(["USER", "ASSISTANT", "SYSTEM"]);

/**
 * Maximum characters accepted for a chat message's content.
 *
 * This is the single source of truth for the "supported limit": the request
 * schema enforces it, and the AI execution path uses the same value when it
 * replays a turn, so the whole accepted message is delivered to the provider
 * rather than being silently clipped. The frontend mirrors it as
 * `MAX_MESSAGE_LENGTH` in `features/ai/chat-utils.ts`.
 */
export const MAX_MESSAGE_CONTENT_LENGTH = 20000;

export const createMessageSchema = z.object({
  content: z.string().trim().min(1, "Message content is required").max(MAX_MESSAGE_CONTENT_LENGTH),
  role: messageRoleSchema.optional().default("USER"),
  // When true (default) the AI provider is asked to produce a reply.
  // When false the message is stored without invoking any provider.
  generateReply: z.boolean().optional().default(true),
  // Optional attachment resource IDs to include with this message.
  attachmentIds: z.array(z.string().min(1)).max(10).optional(),
});

/**
 * Edit one of the student's own questions. The same size limit as sending a
 * message applies, so an edit can never smuggle in content a send would reject.
 */
export const updateMessageSchema = z.object({
  content: z.string().trim().min(1, "Message content is required").max(MAX_MESSAGE_CONTENT_LENGTH),
});

export const studyPlanEntryStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED"]);

export const createStudyPlanEntrySchema = z.object({
  dayNumber: z.number().int().min(1),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(1440),
});

export const createStudyPlanSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  examDate: z.string().nullable().optional(),
  courseId: idSchema.nullable().optional(),
  entries: z.array(createStudyPlanEntrySchema).max(100).optional(),
});

export const updateStudyPlanSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  examDate: z.string().nullable().optional(),
  courseId: idSchema.nullable().optional(),
});

export const updateStudyPlanEntrySchema = z.object({
  dayNumber: z.number().int().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  status: studyPlanEntryStatusSchema.optional(),
});

export const queryConversationSchema = z.object({
  type: conversationTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: idSchema.optional(),
});

export const queryStudyPlanSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: idSchema.optional(),
});

// ── Structured extraction (POST /ai/structured) ─────────────────────────
//
// A client describes the JSON shape it wants back; the server converts it to a
// Zod validator (`jsonSchemaToZod` in the tool layer) and returns only output
// that matched it. Only this bounded, `$ref`-free subset is accepted — the
// `.strict()` object rejects `$ref`, `oneOf`, `pattern`, `format`, `minLength`,
// … outright, so the converter can never be asked to walk recursion the schema
// cannot express. Together with the converter's depth cap, a bad schema is a
// 400 before any provider call is made.

export const structuredFieldSchema = z.lazy(() =>
  z
    .object({
      type: z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]).optional(),
      description: z.string().min(1).max(200).optional(),
      properties: z.record(z.lazy(() => structuredFieldSchema)).optional(),
      required: z.array(z.string().min(1)).max(24).optional(),
      items: z.lazy(() => structuredFieldSchema).optional(),
      enum: z
        .array(z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
        .min(1)
        .max(32)
        .optional(),
      anyOf: z.array(z.lazy(() => structuredFieldSchema)).min(2).max(8).optional(),
      additionalProperties: z.literal(false).optional(),
    })
    .strict(),
);

export const structuredRequestSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt is required").max(4000),
  schema: structuredFieldSchema,
  // Inline the student's own Tutor Walle data so the model grounds its answer.
  // False turns the endpoint into a pure text → JSON utility.
  ground: z.boolean().optional().default(true),
});

// ── AI Attachments ──────────────────────────────
//
// Upload a file as an attachment for an AI conversation. Creates a resource
// with storageType=UPLOAD and returns the resource ID for use with messages.

export const uploadAttachmentFieldsSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  conversationId: z.string().min(1),
});

export type UploadAttachmentFields = z.infer<typeof uploadAttachmentFieldsSchema>;

export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>;
export type StructuredRequestInput = z.infer<typeof structuredRequestSchema>;
export type StudyPlanEntryStatus = z.infer<typeof studyPlanEntryStatusSchema>;
export type CreateStudyPlanInput = z.infer<typeof createStudyPlanSchema>;
export type UpdateStudyPlanInput = z.infer<typeof updateStudyPlanSchema>;
export type UpdateStudyPlanEntryInput = z.infer<typeof updateStudyPlanEntrySchema>;
export type AiProviderName =
  | "openai"
  | "gemini"
  | "anthropic"
  | "openrouter"
  | "ollama"
  | "custom";

// ── Execution autonomy ───────────────────────────
//
// Execution autonomy controls whether the assistant can execute certain
// WRITE tools without requiring the student's explicit confirmation.
// This is separate from AI mode (which controls reasoning depth and
// tool budgets) and from model/provider selection (which controls
// which model answers).
//
// "manual"   — default. Every WRITE tool requires explicit confirmation.
// "autonomous" — a curated set of safe WRITE tools runs automatically
//                after the student enables this mode. The student can
//                still review and cancel pending actions if desired.

export const EXECUTION_AUTONOMY_MODES = ["manual", "autonomous"] as const;

export const executionAutonomyModeSchema = z.enum(EXECUTION_AUTONOMY_MODES);

export type ExecutionAutonomyMode = z.infer<typeof executionAutonomyModeSchema>;

export const DEFAULT_EXECUTION_AUTONOMY_MODE: ExecutionAutonomyMode = "manual";

/** Narrow an unknown settings value to a known execution autonomy mode. */
export function isExecutionAutonomyMode(value: unknown): value is ExecutionAutonomyMode {
  return typeof value === "string" && (EXECUTION_AUTONOMY_MODES as readonly string[]).includes(value);
}

// ── AI Missions (Persistent Multi-Step Missions) ────────────────────────
//
// A mission is a durable, multi-step plan that the AI can execute across
// multiple turns. Each step represents a tool call with explicit dependencies.
// The mission survives restarts and can be resumed, retried, or cancelled.

export const missionStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "WAITING",
  "PARTIAL",
  "FAILED_RECOVERABLE",
  "FAILED_TERMINAL",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "COMPLETED",
]);

export const missionStepStatusSchema = z.enum([
  "PENDING",
  "QUEUED",
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED_RECOVERABLE",
  "FAILED_TERMINAL",
  "SKIPPED",
  "CANCELLED",
]);

export const missionStepInputSchema = z.object({
  toolName: z.string().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  arguments: z.record(z.unknown()),
  dependsOn: z.array(z.string().min(1)).optional().default([]),
  maxAttempts: z.number().int().min(1).max(10).optional().default(3),
});

export const createMissionSchema = z.object({
  objective: z.string().trim().min(1, "Objective is required").max(2000),
  conversationId: z.string().min(1).optional(),
  steps: z.array(missionStepInputSchema).min(1).max(50),
  contextSnapshot: z.record(z.unknown()).optional(),
});

export const queryMissionSchema = z.object({
  status: missionStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().min(1).optional(),
});

export type MissionStatus = z.infer<typeof missionStatusSchema>;
export type MissionStepStatus = z.infer<typeof missionStepStatusSchema>;
export type MissionStepInput = z.infer<typeof missionStepInputSchema>;
export type CreateMissionInput = z.infer<typeof createMissionSchema>;
export type QueryMissionInput = z.infer<typeof queryMissionSchema>;

// ── AI Memories (user-controlled assistant memory) ──────────────────────
//
// Facts the student has explicitly saved so the assistant can reuse them
// across conversations. Two rules shape this contract:
//
//  * Nothing is extracted automatically. A memory row exists only because the
//    student typed it in Settings or confirmed a `save_memory` proposal in
//    chat — ordinary chat is never retained.
//  * The assistant may read a memory as personal context, but a memory is
//    never a record fact: dates, grades and deadlines always come from tools.
//
// The categories mirror how a student thinks about their own context, and the
// provenance marks who created the row so the UI can label it honestly.

export const memoryCategorySchema = z.enum(["PREFERENCE", "ACADEMIC", "GOALS", "SCHEDULE", "OTHER"]);

export const memoryProvenanceSchema = z.enum(["USER", "AI"]);

/**
 * Maximum characters accepted for one saved memory. Bounded so a single entry
 * cannot flood the prompt block, and so the dedup/normalisation scan stays
 * cheap.
 */
export const MAX_MEMORY_CONTENT_LENGTH = 1000;

export const createMemorySchema = z.object({
  content: z.string().trim().min(1, "Memory content is required").max(MAX_MEMORY_CONTENT_LENGTH),
  category: memoryCategorySchema.optional().default("OTHER"),
});

/** Partial update — every field optional, at least one field required. */
export const updateMemorySchema = z
  .object({
    content: z.string().trim().min(1, "Memory content is required").max(MAX_MEMORY_CONTENT_LENGTH).optional(),
    category: memoryCategorySchema.optional(),
  })
  .refine((value) => value.content !== undefined || value.category !== undefined, {
    message: "Provide at least one field to update",
  });

export const queryMemorySchema = z.object({
  category: memoryCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

export type MemoryCategory = z.infer<typeof memoryCategorySchema>;
export type MemoryProvenance = z.infer<typeof memoryProvenanceSchema>;
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type QueryMemoryInput = z.infer<typeof queryMemorySchema>;