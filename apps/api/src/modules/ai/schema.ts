import { z } from "zod";

export const idSchema = z.string().min(1);

export const conversationTypeSchema = z.enum(["CHAT", "TUTOR", "QUIZ", "STUDY_PLAN", "EXPLAIN"]);

export const createConversationSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  type: conversationTypeSchema.optional(),
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

export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type StudyPlanEntryStatus = z.infer<typeof studyPlanEntryStatusSchema>;
export type CreateStudyPlanInput = z.infer<typeof createStudyPlanSchema>;
export type UpdateStudyPlanInput = z.infer<typeof updateStudyPlanSchema>;
export type UpdateStudyPlanEntryInput = z.infer<typeof updateStudyPlanEntrySchema>;