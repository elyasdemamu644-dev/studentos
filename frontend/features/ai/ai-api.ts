import { api } from "@/lib/api/client";
import type {
  AiActionOutcome,
  AiAgentRun,
  AiMessage,
  AiToolActivity,
  Conversation,
  ConversationType,
  Page,
  PendingAction,
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
  /**
   * Aborting this leaves the server request in flight; the user's message is
   * still persisted by the API, so a later reload shows it. It only stops the
   * browser from waiting for a reply nobody is reading.
   */
  signal?: AbortSignal;
}

export function sendMessage(input: SendMessageInput): Promise<AddMessageResult> {
  return api.post<AddMessageResult>(
    `/ai/conversations/${input.conversationId}/messages`,
    { content: input.content, generateReply: input.generateReply ?? true },
    { signal: input.signal },
  );
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