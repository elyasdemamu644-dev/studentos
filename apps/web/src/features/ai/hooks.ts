"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AiMessage, Conversation } from "@/types/api-types";
import { formatApiError } from "@/components/states";
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
      // A fresh reply can leave a new proposal behind (or supersede an old one).
      qc.setQueryData(["ai", "pending-action", input.conversationId], result.pendingAction);
      qc.invalidateQueries({ queryKey: ["ai", "conversations"] });
    },
  });
}

// ── Pending-action confirmation ────────────────────

export function usePendingAction(conversationId: string | undefined) {
  return useQuery({
    queryKey: ["ai", "pending-action", conversationId],
    queryFn: () => api.getPendingAction(conversationId!),
    enabled: Boolean(conversationId),
  });
}

export function useConfirmPendingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, actionId }: { conversationId: string; actionId: string }) =>
      api.confirmPendingAction(conversationId, actionId),
    onSuccess: (result, { conversationId }) => {
      qc.setQueryData(["ai", "pending-action", conversationId], result.pendingAction);
      toast.success("Change applied");
      // Tasks, study sessions and goals may all have changed.
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["study-sessions"] });
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(formatApiError(error)),
  });
}

export function useCancelPendingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, actionId }: { conversationId: string; actionId: string }) =>
      api.cancelPendingAction(conversationId, actionId),
    onSuccess: (result, { conversationId }) => {
      qc.setQueryData(["ai", "pending-action", conversationId], result.pendingAction);
      toast.success("Change discarded");
    },
    onError: (error) => toast.error(formatApiError(error)),
  });
}

export function isAiNotConfigured(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: string }).code;
    return code === "AI_PROVIDER_NOT_CONFIGURED";
  }
  return false;
}