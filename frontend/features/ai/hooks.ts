"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AiActionOutcome, AiAgentRun, AiArtifact, AiMessage, Conversation } from "@/types/api-types";
import { formatApiError } from "@/components/states";
import type { ConversationFile } from "./conversation-files";
import * as api from "./ai-api";

export const conversationsKey = ["ai", "conversations"];
export const messagesKey = (conversationId: string | undefined) => ["ai", "messages", conversationId];
/**
 * The generated files of one conversation.
 *
 * Fetched from the artifacts endpoint rather than scraped off `message.artifacts`
 * so a file that is both linked to its reply and listed by the conversation is
 * fetched once, from a source that survives a reload.
 */
export const artifactsKey = (conversationId: string | undefined) => [
  "ai",
  "artifacts",
  conversationId,
];
export const pendingActionKey = (conversationId: string | undefined) => [
  "ai",
  "pending-action",
  conversationId,
];
/**
 * Per-step results of the last confirm in a conversation.
 *
 * Held apart from `pendingAction` because these are the API's real outcomes
 * (`ok` vs `verified`) for the steps the student just approved. It is written
 * only by a confirm response, so the card can never show a result it did not
 * receive.
 */
export const actionOutcomesKey = (conversationId: string | undefined) => [
  "ai",
  "action-outcomes",
  conversationId,
];

/**
 * The last agent run per conversation.
 *
 * Cache-only for the same reason as `actionOutcomes`: the API returns
 * `AiAgentRun` on `addMessage` and does not replay past runs after a reload, so
 * an unknown conversation reports `null` rather than a fabricated summary.
 * This is what lets the UI say which provider and model answered, which tools
 * actually ran, and — importantly — that a turn ended on a tool limit or on a
 * provider with no tool support.
 */
export const agentRunsKey = (conversationId: string | undefined) => [
  "ai",
  "agent-runs",
  conversationId,
];

// ── Missions ────────────────────────────────────────

export const missionsKey = ["ai", "missions"];
export const missionKey = (missionId: string) => ["ai", "missions", missionId];

/**
 * How often the mission list refreshes itself, in milliseconds.
 *
 * A mission is a long-running job, so its state changes on the server long
 * after the request that started it returned: steps complete, a proposal
 * expires, a retry succeeds. Without polling the panel would show the state
 * the mission had when the page loaded, and the student would never see the
 * work finish.
 *
 * The interval depends on why the state can still change:
 *
 *   - A mission that is queued, running or cancelling is being worked on right
 *     now, so it is polled often.
 *   - A mission that is waiting is waiting for the *student* — but the proposal
 *     it waits on can still be approved, cancelled or expire, and the panel is
 *     where the student approves it, so it is polled slowly rather than not at
 *     all.
 *   - Everything else is settled: nothing polls, so an idle panel costs
 *     nothing.
 *
 * `false` stops the polling entirely.
 */
export type MissionPollInterval = number | false;

/** Statuses that mean the server is actively working on the mission. */
const ACTIVE_MISSION_STATUSES: ReadonlySet<string> = new Set([
  "QUEUED",
  "RUNNING",
  "CANCEL_REQUESTED",
]);

/** Statuses that mean the mission is waiting on the student, not on the server. */
const WAITING_MISSION_STATUSES: ReadonlySet<string> = new Set(["WAITING"]);

/** How fast a mission that is being worked on is re-read. */
const ACTIVE_POLL_MS = 2_000;

/** How fast a mission that is waiting on the student is re-read. */
const WAITING_POLL_MS = 10_000;

/**
 * The poll interval for a set of missions.
 *
 * Exported so the rule is testable on its own and so the panel and the detail
 * view cannot drift apart.
 */
export function missionPollInterval(
  missions: ReadonlyArray<{ status: string }> | undefined,
): MissionPollInterval {
  if (!missions || missions.length === 0) return false;
  if (missions.some((mission) => ACTIVE_MISSION_STATUSES.has(mission.status))) {
    return ACTIVE_POLL_MS;
  }
  if (missions.some((mission) => WAITING_MISSION_STATUSES.has(mission.status))) {
    return WAITING_POLL_MS;
  }
  return false;
}

export function useMissions(params: api.MissionListParams = {}) {
  return useQuery({
    queryKey: [...missionsKey, params],
    queryFn: () => api.listMissions(params),
    // Polled only while something can still change — see `missionPollInterval`.
    refetchInterval: (query) => missionPollInterval(query.state.data?.items),
  });
}

export function useMission(missionId: string | undefined) {
  return useQuery({
    queryKey: missionKey(missionId ?? ""),
    queryFn: () => api.getMission(missionId!),
    enabled: Boolean(missionId),
    // Polled only while this mission can still change — see `missionPollInterval`.
    refetchInterval: (query) => missionPollInterval(query.state.data ? [query.state.data] : undefined),
  });
}

export function useCreateMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateMissionInput) => api.createMission(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: missionsKey });
    },
    onError: () => toast.error("Could not create the mission"),
  });
}

export function useCancelMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (missionId: string) => api.cancelMission(missionId),
    onSuccess: (mission) => {
      qc.invalidateQueries({ queryKey: missionsKey });
      qc.setQueryData(missionKey(mission.id), mission);
      toast.success("Mission cancelled");
    },
    onError: () => toast.error("Could not cancel the mission"),
  });
}

export function useRetryMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (missionId: string) => api.retryMission(missionId),
    onSuccess: (mission) => {
      qc.invalidateQueries({ queryKey: missionsKey });
      qc.setQueryData(missionKey(mission.id), mission);
      toast.success("Mission retry started");
    },
    onError: () => toast.error("Could not retry the mission"),
  });
}

export function useExecuteMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (missionId: string) => api.executeMission(missionId),
    onSuccess: (mission) => {
      qc.invalidateQueries({ queryKey: missionsKey });
      qc.setQueryData(missionKey(mission.id), mission);
    },
    onError: () => toast.error("Could not execute the mission"),
  });
}

/**
 * Approve the change a mission is waiting on.
 *
 * The approval carries the mission on: the approved step is applied and the
 * remaining steps run, so the mission that comes back is the new state rather
 * than the one before the approval.
 */
export function useApproveMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (missionId: string) => api.approveMission(missionId),
    onSuccess: (mission) => {
      qc.invalidateQueries({ queryKey: missionsKey });
      qc.setQueryData(missionKey(mission.id), mission);
      toast.success("Change approved");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      if (/conflict|already/i.test(message)) {
        toast.error("That change was already applied or is no longer waiting");
      } else {
        toast.error("Could not approve the change");
      }
    },
  });
}

// ── Proactive briefing ───────────────────────────

export const proactiveBriefingKey = ["ai", "proactive-briefing"];

/**
 * The "what needs you now" digest. A minute of staleness keeps a workspace
 * from re-asking on every focus, and a failed briefing must never surface as
 * an error in the chat — the strip simply stays hidden.
 */
export function useProactiveBriefing() {
  return useQuery({
    queryKey: proactiveBriefingKey,
    queryFn: api.getProactiveBriefing,
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function useConversations(params: api.ConversationListParams = {}) {
  return useQuery({
    queryKey: [...conversationsKey, params],
    queryFn: () => api.listConversations(params),
  });
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: messagesKey(conversationId),
    queryFn: () => api.listMessages(conversationId!),
    enabled: Boolean(conversationId),
  });
}

/** The files the assistant generated in a conversation. */
export function useArtifacts(conversationId: string | undefined) {
  return useQuery({
    queryKey: artifactsKey(conversationId),
    queryFn: () => api.listArtifacts(conversationId!),
    enabled: Boolean(conversationId),
  });
}

/** Patch one conversation in every cached list, by id. */
function patchConversationTitle(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
  title: string,
) {
  queryClient.setQueriesData<api.ConversationListResult>({ queryKey: conversationsKey }, (current) =>
    current
      ? {
          ...current,
          items: current.items.map((item) => (item.id === id ? { ...item, title } : item)),
        }
      : current,
  );
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; type?: "CHAT" | "TUTOR" | "QUIZ" | "STUDY_PLAN" | "EXPLAIN" }) =>
      api.createConversation(input),
    onSuccess: (conversation: Conversation) => {
      qc.invalidateQueries({ queryKey: conversationsKey });
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
      qc.invalidateQueries({ queryKey: conversationsKey });
      toast.success("Conversation deleted");
    },
    onError: () => toast.error("Could not delete the conversation"),
  });
}

/**
 * Rename, showing the new title before the request lands.
 *
 * The list is patched by id so the row updates instantly and rolls back to the
 * previous value if the rename fails — the student never loses their place.
 */
export function useRenameConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.updateConversation(id, { title }),
    onMutate: async ({ id, title }) => {
      await qc.cancelQueries({ queryKey: conversationsKey });
      const previous = qc.getQueriesData<api.ConversationListResult>({ queryKey: conversationsKey });
      patchConversationTitle(qc, id, title);
      return { previous };
    },
    onError: (_error, _input, context) => {
      for (const [key, value] of context?.previous ?? []) qc.setQueryData(key, value);
      toast.error("Could not rename the conversation");
    },
    onSuccess: (conversation: Conversation) => {
      // Trust the stored row over the optimistic guess.
      patchConversationTitle(qc, conversation.id, conversation.title);
    },
  });
}

/** A client-side id for a message that has not been persisted yet. */
export function optimisticMessageId(): string {
  return `optimistic-${Math.random().toString(36).slice(2)}`;
}

export interface SendMessageResult extends api.AddMessageResult {
  /** The stored id of the optimistic message this call replaced. */
  optimisticId: string;
}

export interface SendMessageVariables extends api.SendMessageInput {
  /**
   * Retry an existing failed message instead of adding a new one.
   *
   * The id of the message the student is retrying. Its slot is reused — flipped
   * back to `optimistic` and refilled by the stored message on success — so the
   * text appears once, not twice. Ignored when no such message is in the cache,
   * which happens if the transcript refetched away in between; the retry then
   * appends, exactly as a first attempt would.
   */
  retryOf?: string;
}

/**
 * Send a message and show it immediately.
 *
 * The student's message is written into the cached list the moment the
 * mutation starts, so the UI never shows a blank gap while the assistant is
 * thinking. On success the optimistic entry is replaced in place by the stored
 * message plus the reply; on failure it is left on screen, marked failed, and
 * `retryOf` can send it again without a second copy.
 */
export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation<SendMessageResult, unknown, SendMessageVariables, { optimisticId: string }>({
    mutationFn: async (input: SendMessageVariables): Promise<SendMessageResult> => {
      const result = await api.sendMessage(input);
      return { ...result, optimisticId: "" };
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: messagesKey(input.conversationId) });
      const key = messagesKey(input.conversationId);

      if (input.retryOf) {
        const reusable = (qc.getQueryData<AiMessage[]>(key) ?? []).some(
          (message) => message.id === input.retryOf,
        );
        if (reusable) {
          qc.setQueryData<AiMessage[]>(key, (current) =>
            (current ?? []).map((message) =>
              message.id === input.retryOf
                ? { ...message, optimistic: true, failed: false }
                : message,
            ),
          );
          return { optimisticId: input.retryOf };
        }
      }

      const id = optimisticMessageId();
      qc.setQueryData<AiMessage[]>(key, (current) => [
        ...(current ?? []),
        {
          id,
          conversationId: input.conversationId,
          role: "USER",
          content: input.content,
          createdAt: new Date().toISOString(),
          // Client-only markers; the stored message carries neither.
          optimistic: true,
          failed: false,
        },
      ]);

      return { optimisticId: id };
    },
    onSuccess: (result, input, context) => {
      const key = messagesKey(input.conversationId);
      const optimisticId = context?.optimisticId;
      qc.setQueryData<AiMessage[]>(key, (current) => {
        const list = (current ?? []).filter(
          // Drop optimistic copies and any messages already returned by a
          // transcript refresh that raced this mutation.
          (message) =>
            message.id !== optimisticId &&
            message.id !== result.message.id &&
            message.id !== result.reply?.id,
        );
        return [...list, result.message, ...(result.reply ? [result.reply] : [])];
      });

      qc.setQueryData(pendingActionKey(input.conversationId), result.pendingAction);
      // The last run's real telemetry, for the same reason as `actionOutcomes`.
      if (result.agent) {
        qc.setQueryData(agentRunsKey(input.conversationId), result.agent);
      }
      // A turn can have generated files — either through the REST confirm path
      // or by running `confirm_pending_actions` during the turn — so the
      // conversation's Files list is stale. The `onSettled` refetch of the
      // messages covers the attachments that arrived with this reply.
      qc.invalidateQueries({ queryKey: artifactsKey(input.conversationId) });
      // The reply is new, so the row's preview and recency are stale.
      qc.invalidateQueries({ queryKey: conversationsKey });
    },
    onError: (error, input, context) => {
      const key = messagesKey(input.conversationId);
      const optimisticId = context?.optimisticId;
      if (optimisticId) {
        // Keep the message visible and mark it failed so it can be retried in
        // place. Removing it would make the student think nothing was sent.
        qc.setQueryData<AiMessage[]>(key, (current) =>
          (current ?? []).map((message) =>
            message.id === optimisticId ? { ...message, failed: true, optimistic: false } : message,
          ),
        );
      }
      if (input.signal?.aborted) return;
      if (isAiNotConfigured(error)) return;
      toast.error(formatApiError(error));
    },
    onSettled: (_data, _error, input) => {
      // Reconcile against the server even on failure: the API persists the
      // user's message before it generates, so it exists either way.
      qc.invalidateQueries({ queryKey: messagesKey(input.conversationId) });
    },
  });
}

// ── Editing and regeneration ───────────────────────

/**
 * Apply a turn's result to the cached transcript: keep everything before the
 * question it belongs to, then place the (possibly edited) question and its new
 * reply. The tail the server deleted is dropped from the cache the same way, so
 * a rewritten thread never shows a reply detached from its prompt.
 */
function applyTurnResult(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: string,
  result: api.AddMessageResult,
) {
  qc.setQueryData<AiMessage[]>(messagesKey(conversationId), (current) => {
    if (!current) return current;
    const index = current.findIndex((message) => message.id === result.message.id);
    if (index === -1) return current;
    return [
      ...current.slice(0, index),
      result.message,
      ...(result.reply ? [result.reply] : []),
    ];
  });
  qc.setQueryData(pendingActionKey(conversationId), result.pendingAction);
  if (result.agent) qc.setQueryData(agentRunsKey(conversationId), result.agent);
  qc.invalidateQueries({ queryKey: artifactsKey(conversationId) });
  qc.invalidateQueries({ queryKey: conversationsKey });
}

export interface EditMessageVariables {
  conversationId: string;
  messageId: string;
  content: string;
  signal?: AbortSignal;
}

/**
 * Edit a question and show the change immediately.
 *
 * The cached thread is rewritten optimistically — the question's new wording
 * replaces the old, and everything the old answer said is removed — then the
 * server's regenerated reply is dropped in. A failure restores the previous
 * thread rather than leaving a half-edited one.
 */
export function useEditMessage() {
  const qc = useQueryClient();
  return useMutation<api.AddMessageResult, unknown, EditMessageVariables, { previous?: AiMessage[] }>({
    mutationFn: ({ conversationId, messageId, content, signal }) =>
      api.editMessage(conversationId, messageId, content, signal),
    onMutate: async ({ conversationId, messageId, content }) => {
      await qc.cancelQueries({ queryKey: messagesKey(conversationId) });
      const key = messagesKey(conversationId);
      const previous = qc.getQueryData<AiMessage[]>(key);
      qc.setQueryData<AiMessage[]>(key, (current) => {
        if (!current) return current;
        const index = current.findIndex((message) => message.id === messageId);
        if (index === -1) return current;
        return [
          ...current.slice(0, index),
          { ...current[index], content, failed: false, optimistic: false },
        ];
      });
      return { previous };
    },
    onError: (error, { conversationId, signal }, context) => {
      if (context?.previous) qc.setQueryData(messagesKey(conversationId), context.previous);
      if (signal?.aborted) return;
      toast.error(formatApiError(error));
    },
    onSuccess: (result, { conversationId }) => applyTurnResult(qc, conversationId, result),
    onSettled: (_data, _error, { conversationId }) =>
      qc.invalidateQueries({ queryKey: messagesKey(conversationId) }),
  });
}

export interface RegenerateMessageVariables {
  conversationId: string;
  messageId: string;
  signal?: AbortSignal;
}

/**
 * Regenerate an answer. The reply being replaced, and everything after it, is
 * hidden at once so the student sees the thread that is actually being rebuilt;
 * the new reply lands when the server answers.
 */
export function useRegenerateMessage() {
  const qc = useQueryClient();
  return useMutation<api.AddMessageResult, unknown, RegenerateMessageVariables, { previous?: AiMessage[] }>({
    mutationFn: ({ conversationId, messageId, signal }) =>
      api.regenerateMessage(conversationId, messageId, signal),
    onMutate: async ({ conversationId, messageId }) => {
      await qc.cancelQueries({ queryKey: messagesKey(conversationId) });
      const key = messagesKey(conversationId);
      const previous = qc.getQueryData<AiMessage[]>(key);
      qc.setQueryData<AiMessage[]>(key, (current) => {
        if (!current) return current;
        const index = current.findIndex((message) => message.id === messageId);
        if (index === -1) return current;
        // An assistant message is replaced; a user message keeps its place and
        // only the replies after it go.
        const cut = current[index].role === "ASSISTANT" ? index : index + 1;
        return current.slice(0, cut);
      });
      return { previous };
    },
    onError: (error, { conversationId, signal }, context) => {
      if (context?.previous) qc.setQueryData(messagesKey(conversationId), context.previous);
      if (signal?.aborted) return;
      toast.error(formatApiError(error));
    },
    onSuccess: (result, { conversationId }) => applyTurnResult(qc, conversationId, result),
    onSettled: (_data, _error, { conversationId }) =>
      qc.invalidateQueries({ queryKey: messagesKey(conversationId) }),
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
      qc.setQueryData(actionOutcomesKey(conversationId), result.executed);
      // A confirmed proposal can save files, so the conversation's Files list
      // must not stay stale after the student approves it.
      qc.invalidateQueries({ queryKey: artifactsKey(conversationId) });
      // Show the assistant's outcome summary in the transcript. The API stores
      // this message, so a later reload reproduces it; appending it here means
      // the student sees the result of Confirm immediately, without a gap.
      if (result.reply) {
        const reply = result.reply;
        qc.setQueryData<AiMessage[]>(messagesKey(conversationId), (current) => [
          ...(current ?? []).filter((message) => message.id !== reply.id),
          reply,
        ]);
      }
      // Report the server's own count, not a blanket "applied": a batch where a
      // step failed or could not be verified on re-read must not read as success.
      if (result.status === "EXECUTED") {
        toast.success(result.summary);
      } else {
        toast.error(result.summary);
      }
      // Tasks, study sessions and goals may all have changed.
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["study-sessions"] });
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      // Notes, resources, calendar, grades and courses are equally reachable
      // from a confirmed proposal, so their caches must not stay stale.
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["resources"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["grades"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
    },
    onError: (error) => toast.error(formatApiError(error)),
  });
}

/**
 * The real per-step outcomes of the last confirm in this conversation.
 *
 * Cache-only by design: the data is written by `useConfirmPendingAction` from
 * the confirm response, and no endpoint replays past outcomes after a reload, so
 * this returns `[]` rather than inventing a previous result.
 */
export function useActionOutcomes(conversationId: string | undefined) {
  return useQuery<AiActionOutcome[]>({
    queryKey: actionOutcomesKey(conversationId),
    queryFn: async () => [],
    enabled: Boolean(conversationId),
    staleTime: Infinity,
  });
}

/**
 * The last agent run in this conversation, or `null` when this browser session
 * has not seen one (a reload, or a conversation opened without sending).
 */
export function useLastAgentRun(conversationId: string | undefined) {
  return useQuery<AiAgentRun | null>({
    queryKey: agentRunsKey(conversationId),
    queryFn: async () => null,
    enabled: Boolean(conversationId),
    staleTime: Infinity,
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

export function useStudyPlans() {
  return useQuery({
    queryKey: ["ai", "study-plans"],
    queryFn: () => api.listStudyPlans({ limit: 100 }),
  });
}

export function useCreateStudyPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createStudyPlan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai", "study-plans"] });
      toast.success("Study plan saved");
    },
    onError: () => toast.error("Could not save the study plan"),
  });
}

export function useUpdateStudyPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { title?: string; examDate?: string | null; courseId?: string | null } }) =>
      api.updateStudyPlan(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai", "study-plans"] }),
    onError: () => toast.error("Could not update the study plan"),
  });
}

export function useDeleteStudyPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteStudyPlan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai", "study-plans"] });
      toast.success("Study plan deleted");
    },
    onError: () => toast.error("Could not delete the study plan"),
  });
}

export function useUpdateStudyPlanEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, entryId, input }: {
      planId: string;
      entryId: string;
      input: {
        dayNumber?: number;
        title?: string;
        description?: string | null;
        durationMinutes?: number;
        status?: import("@/types/api-types").StudyPlanEntryStatus;
      };
    }) => api.updateStudyPlanEntry(planId, entryId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai", "study-plans"] }),
    onError: () => toast.error("Could not update the study plan step"),
  });
}

export function useStructuredExtraction() {
  return useMutation({
    mutationFn: api.extractStructured,
    onError: () => toast.error("Could not extract structured data"),
  });
}

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.UploadAttachmentInput) => api.uploadAttachment(input),
    onError: (error) => toast.error(formatApiError(error)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["resources"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
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

/**
 * Fetch a generated file's bytes. The caller saves the returned blob (the hook
 * has no DOM side effects), preferring the server's filename and falling back
 * to the artifact's own name.
 */
export function useDownloadArtifact() {
  return useMutation({
    mutationFn: (artifact: Pick<AiArtifact, "id" | "name">) => api.downloadArtifact(artifact.id),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not download the file"),
  });
}

/**
 * Download either kind of conversation file.
 *
 * A generated file and an uploaded one are fetched from different
 * endpoints, so the caller passes the unified `ConversationFile` and this picks
 * the right one. The mutation has no DOM side effects (the panel saves the
 * blob), which keeps it testable and reusable.
 */
export function useDownloadConversationFile() {
  return useMutation({
    mutationFn: (file: ConversationFile) =>
      file.kind === "artifact"
        ? api.downloadArtifact(file.artifactId ?? file.id)
        : api.downloadAttachment(file.resourceId ?? file.id),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not download the file"),
  });
}

export function useMissionTools() {
  return useQuery({
    queryKey: ["ai", "mission-tools"],
    queryFn: () => api.listMissionTools(),
    staleTime: 60_000,
  });
}
