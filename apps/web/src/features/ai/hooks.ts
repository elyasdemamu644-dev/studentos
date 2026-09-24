"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AiMessage, Conversation } from "@/features/api-types";
import * as api from "./ai-api";

export function useConversations(params: api.ConversationListParams = {}) {
  return useQuery({
    queryKey: ["ai", "conversations", params],
    queryFn: () => api.listConversations(params),
  });
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["ai", "messages", conversationId],
    queryFn: () => api.listMessages(conversationId!),
    enabled: Boolean(conversationId),
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; type?: "CHAT" | "TUTOR" | "QUIZ" | "STUDY_PLAN" | "EXPLAIN" }) =>
      api.createConversation(input),
    onSuccess: (conversation: Conversation) => {
      qc.invalidateQueries({ queryKey: ["ai", "conversations"] });
      return conversation;
    },
    onError: () => toast.error("Could not create the conversation"),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteConversation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai", "conversations"] });
      toast.success("Conversation deleted");
    },
    onError: () => toast.error("Could not delete the conversation"),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.SendMessageInput) => api.sendMessage(input),
    onSuccess: (result, input) => {
      // Patch the cached message list with the stored user message + reply.
      qc.setQueryData<AiMessage[]>(["ai", "messages", input.conversationId], (current) => {
        const next = [...(current ?? [])];
        if (!next.some((m) => m.id === result.message.id)) next.push(result.message);
        if (result.reply && !next.some((m) => m.id === result.reply!.id)) next.push(result.reply!);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["ai", "conversations"] });
    },
  });
}

export function isAiNotConfigured(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: string }).code;
    return code === "AI_PROVIDER_NOT_CONFIGURED";
  }
  return false;
}