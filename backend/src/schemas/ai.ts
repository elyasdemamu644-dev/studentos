import { z } from "zod";

export const idSchema = z.string().min(1);

export const conversationTypeSchema = z.enum(["CHAT", "TUTOR", "QUIZ", "STUDY_PLAN", "EXPLAIN"]);

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

export const createMessageSchema = z.object({
  content: z.string().trim().min(1, "Message content is required").max(20000),
  role: messageRoleSchema.optional().default("USER"),
  // When true (default) the AI provider is asked to produce a reply.
  // When false the message is stored without invoking any provider.
  generateReply: z.boolean().optional().default(true),
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
  // Inline the student's own StudentOS data so the model grounds its answer.
  // False turns the endpoint into a pure text → JSON utility.
  ground: z.boolean().optional().default(true),
});

export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
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