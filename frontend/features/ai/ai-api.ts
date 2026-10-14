import { api } from "@/lib/api/client";
import type {
  AiActionOutcome,
  AiAgentRun,
  AiMessage,
  AiMessageAttachment,
  AiToolActivity,
  Conversation,
  ConversationType,
  Page,
  PendingAction,
  StudyPlan,
  StudyPlanEntry,
  StudyPlanEntryStatus,
} from "@/types/api-types";

export interface ConversationListParams {
  type?: ConversationType;
  limit?: number;
  cursor?: string;
}

export type ConversationListResult = Page<Conversation>;

export function listConversations(params: ConversationListParams = {}): Promise<ConversationListResult> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<ConversationListResult>(qs ? `/ai/conversations?${qs}` : "/ai/conversations");
}

export function getConversation(id: string): Promise<Conversation> {
  return api.get<Conversation>(`/ai/conversations/${id}`);
}

export function createConversation(input: { title?: string; type?: ConversationType }): Promise<Conversation> {
  return api.post<Conversation>("/ai/conversations", input);
}

export function deleteConversation(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/ai/conversations/${id}`);
}

/** Rename a conversation. The title is the only editable field. */
export function updateConversation(id: string, input: { title: string }): Promise<Conversation> {
  return api.patch<Conversation>(`/ai/conversations/${id}`, input);
}

export function listMessages(conversationId: string): Promise<AiMessage[]> {
  return api.get<AiMessage[]>(`/ai/conversations/${conversationId}/messages`);
}

export interface AddMessageResult {
  message: AiMessage;
  reply: AiMessage | null;
  /** What the assistant read/analysed, in order. */
  toolActivity: AiToolActivity[];
  /** The change awaiting the user's confirmation, if any. */
  pendingAction: PendingAction | null;
  /** How the loop ran; `null` when no provider was called. */
  agent: AiAgentRun | null;
}

export interface SendMessageInput {
  conversationId: string;
  content: string;
  generateReply?: boolean;
  /** Attachments to include with the message (uploaded resources). */
  attachmentIds?: string[];
  /** Aborting this cancels the upstream generation and leaves no assistant reply. */
  signal?: AbortSignal;
}

export function sendMessage(input: SendMessageInput): Promise<AddMessageResult> {
  const { conversationId, attachmentIds, signal, ...body } = input;
  return api.post<AddMessageResult>(
    `/ai/conversations/${conversationId}/messages`,
    { ...body, attachmentIds },
    { signal },
  );
}

/**
 * Upload a file as an AI attachment. This creates a resource with storageType=UPLOAD
 * and returns the resource ID for use with sendMessage.
 */
export interface UploadAttachmentInput {
  file: File;
  conversationId: string;
  title?: string;
  description?: string;
}

export function uploadAttachment(input: UploadAttachmentInput): Promise<{ resourceId: string; attachment: AiMessageAttachment }> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("title", input.title ?? input.file.name);
  if (input.description) form.append("description", input.description);
  form.append("conversationId", input.conversationId);
  return api.upload<{ resourceId: string; attachment: AiMessageAttachment }>("/ai/attachments/upload", form);
}

// ── Pending-action confirmation ────────────────────

export interface PendingActionResult {
  pendingAction: PendingAction | null;
}

/** The confirm endpoint's answer: the per-step outcomes the API actually ran. */
export interface ConfirmActionResult extends PendingActionResult {
  /** `PARTIAL` whenever a step failed or could not be verified on re-read. */
  status: "EXECUTED" | "PARTIAL";
  summary: string;
  executed: AiActionOutcome[];
}

/**
 * The proposal awaiting confirmation, or null.
 *
 * This endpoint wraps its answer in `{ pendingAction }` (unlike
 * `addMessage`, which returns the action at the top level of `data`), so the
 * envelope has to be unwrapped here. Without this the page receives
 * `{ pendingAction: null }` — a truthy object — and `PendingActionCard` throws
 * on `action.actions.map(...)`.
 */
export async function getPendingAction(conversationId: string): Promise<PendingAction | null> {
  const result = await api.get<PendingActionResult>(
    `/ai/conversations/${conversationId}/pending-action`,
  );
  return result?.pendingAction ?? null;
}

/** Applies the exact stored proposal the user is looking at. */
export function confirmPendingAction(
  conversationId: string,
  actionId: string,
): Promise<ConfirmActionResult> {
  return api.post<ConfirmActionResult>(
    `/ai/conversations/${conversationId}/pending-action/${actionId}/confirm`,
    {},
  );
}

export function cancelPendingAction(
  conversationId: string,
  actionId: string,
): Promise<PendingActionResult> {
  return api.post<PendingActionResult>(
    `/ai/conversations/${conversationId}/pending-action/${actionId}/cancel`,
    {},
  );
}

// ── Persistent study plans ─────────────────────────

export type StudyPlanPage = Page<StudyPlan>;

export interface CreateStudyPlanInput {
  title: string;
  examDate?: string | null;
  courseId?: string | null;
  entries?: Array<{
    dayNumber: number;
    title: string;
    description?: string | null;
    durationMinutes: number;
  }>;
}

export function listStudyPlans(params: { limit?: number; cursor?: string } = {}): Promise<StudyPlanPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const qs = query.toString();
  return api.get<StudyPlanPage>(qs ? `/ai/study-plans?${qs}` : "/ai/study-plans");
}

export function createStudyPlan(input: CreateStudyPlanInput): Promise<StudyPlan> {
  return api.post<StudyPlan>("/ai/study-plans", input);
}

export function updateStudyPlan(
  id: string,
  input: { title?: string; examDate?: string | null; courseId?: string | null },
): Promise<StudyPlan> {
  return api.patch<StudyPlan>(`/ai/study-plans/${id}`, input);
}

export function deleteStudyPlan(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/ai/study-plans/${id}`);
}

export function updateStudyPlanEntry(
  planId: string,
  entryId: string,
  input: {
    dayNumber?: number;
    title?: string;
    description?: string | null;
    durationMinutes?: number;
    status?: StudyPlanEntryStatus;
  },
): Promise<StudyPlanEntry> {
  return api.patch<StudyPlanEntry>(`/ai/study-plans/${planId}/entries/${entryId}`, input);
}

export interface StructuredRequestInput {
  prompt: string;
  schema: Record<string, unknown>;
  ground?: boolean;
}

export interface StructuredResult {
  result: unknown;
  repaired: boolean;
  provider: string;
  model: string | null;
}

export function extractStructured(input: StructuredRequestInput): Promise<StructuredResult> {
  return api.post<StructuredResult>("/ai/structured", input);
}
