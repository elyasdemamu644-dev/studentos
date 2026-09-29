import { api } from "@/lib/api/client";
import type { AiMessage, Conversation, ConversationType, Page } from "@/types/api-types";

export interface ConversationListParams {
  type?: ConversationType;
  limit?: number;
  cursor?: string;
}

export function listConversations(params: ConversationListParams = {}): Promise<Page<Conversation>> {
  const query = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const qs = query.toString();
  return api.get<Page<Conversation>>(qs ? `/ai/conversations?${qs}` : "/ai/conversations");
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

export function listMessages(conversationId: string): Promise<AiMessage[]> {
  return api.get<AiMessage[]>(`/ai/conversations/${conversationId}/messages`);
}

export interface AddMessageResult {
  message: AiMessage;
  reply: AiMessage | null;
}

export interface SendMessageInput {
  conversationId: string;
  content: string;
  generateReply?: boolean;
}

export function sendMessage(input: SendMessageInput): Promise<AddMessageResult> {
  return api.post<AddMessageResult>(`/ai/conversations/${input.conversationId}/messages`, {
    content: input.content,
    generateReply: input.generateReply ?? true,
  });
}