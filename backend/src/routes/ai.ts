import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { config } from "@/config";
import { ValidationApiError, NotFoundError } from "@/config/errors";
import { parseMultipart } from "@/utils/multipart";
import { aiService } from "../services/ai/service";
import { resourcesService } from "../services/resources";
import {
  createConversationSchema,
  createMemorySchema,
  createMessageSchema,
  createMissionSchema,
  createStudyPlanSchema,
  missionStepInputSchema,
  missionStatusSchema,
  queryConversationSchema,
  queryMemorySchema,
  queryMissionSchema,
  queryStudyPlanSchema,
  structuredRequestSchema,
  updateConversationSchema,
  updateMemorySchema,
  updateMessageSchema,
  updateStudyPlanEntrySchema,
  updateStudyPlanSchema,
  uploadAttachmentFieldsSchema,
  type AiProviderName,
  type CreateConversationInput,
  type CreateMemoryInput,
  type CreateMessageInput,
  type CreateMissionInput,
  type CreateStudyPlanInput,
  type QueryMemoryInput,
  type QueryMissionInput,
  type StructuredRequestInput,
  type UpdateConversationInput,
  type UpdateMemoryInput,
  type UpdateMessageInput,
  type UpdateStudyPlanEntryInput,
  type UpdateStudyPlanInput,
  type UploadAttachmentFields,
} from "../schemas/ai";
import { memoryService } from "../services/ai/memory";
import { proactiveService } from "../services/ai/proactive";
import { UPLOAD_ERROR_CODES } from "@/utils/file-validation";
import { storageKeyFor } from "@/services/storage";
import { getFileStorage } from "@/services/storage";
import { limitAndLogAiUsage } from "@/middlewares/ai-usage";
import { buildDefaultAiProvider } from "@/services/ai/provider";
import { listAiModels } from "@/services/ai/models";
import { settingsService } from "@/services/settings";
import * as aiConnectionsService from "@/services/ai-connections";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };
const messageParam = { id: z.string().min(1) };
const singleMessageParam = { id: z.string().min(1), messageId: z.string().min(1) };
const studyPlanIdParam = { id: z.string().min(1) };
const studyPlanEntryParam = { id: z.string().min(1), entryId: z.string().min(1) };
const missionIdParam = { id: z.string().min(1) };
const missionActionParam = { id: z.string().min(1), actionId: z.string().min(1) };

router.get("/provider-selection", async (req: AuthRequest, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const [settings, personalConnection] = await Promise.all([
      settingsService.get(userId),
      aiConnectionsService.getActiveConnection(userId),
    ]);
    const defaultProvider = buildDefaultAiProvider();
    const mode = settings["ai.providerMode"] ??
      (personalConnection ? "personal" : "default");

    return res.status(200).json({
      success: true,
      data: {
        mode,
        defaultAvailable: Boolean(defaultProvider),
        defaultProvider: config.aiProvider,
        defaultModel: defaultProvider?.model ?? config.aiModel,
        personalConnectionAvailable: Boolean(personalConnection),
        // Behaviour mode + Default AI model preference. Kept alongside the
        // provider choice because the assistant's preferences are read together.
        aiMode: settings["ai.mode"] ?? "AUTO",
        model: settings["ai.model"] ?? null,
        // Execution autonomy: whether safe WRITE tools run without confirmation.
        executionAutonomyMode: settings["ai.executionMode"] ?? "manual",
      },
    });
  } catch (error) { next(error); }
});

/**
 * Selectable models for the Default AI. Static and read-only: the picker offers
 * real model ids without the server calling out to any provider. The stored
 * preference is a plain string, so an unlisted id is still accepted by PATCH
 * /settings.
 */
router.get("/models", async (_req: AuthRequest, res, next) => {
  try {
    const provider = config.aiProvider as AiProviderName;
    return res.status(200).json({
      success: true,
      data: {
        defaultProvider: provider,
        defaultModel: buildDefaultAiProvider()?.model ?? config.aiModel,
        group: listAiModels(provider),
      },
    });
  } catch (error) { next(error); }
});

// ── Attachments ───────────────────────────────────
//
// Upload any file type as an AI attachment. Unknown binary content is stored
// as application/octet-stream; text extraction remains format-limited.

router.post("/attachments/upload", async (req: AuthRequest, res, next) => {
  try {
    const parsed = await parseMultipart(req, config.uploadMaxFileSizeBytes);
    if (!parsed.file) {
      throw new ValidationApiError(
        "A file is required in the `file` field",
        UPLOAD_ERROR_CODES.MISSING_FILE,
      );
    }

    const fields = uploadAttachmentFieldsSchema.safeParse(parsed.fields);
    if (!fields.success) {
      next(fields.error);
      return;
    }

    // Verify the conversation belongs to the user
    const conversation = await aiService.getConversation(req.currentUser!.id, fields.data.conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Create the resource using the existing upload logic
    const record = await resourcesService.createFromUpload(
      req.currentUser!.id,
      {
        title: fields.data.title ?? parsed.file.originalName,
        description: fields.data.description ?? undefined,
        courseId: undefined,
        resourceType: undefined,
      },
      parsed.file,
      { allowAnyMimeType: true },
    );

    return res.status(201).json({
      success: true,
      data: {
        resourceId: record.id,
        attachment: {
          id: record.id,
          resourceId: record.id,
          fileName: record.fileName ?? "file",
          mimeType: record.mimeType ?? "application/octet-stream",
          fileSize: record.fileSize ?? 0,
          resourceType: record.resourceType,
        },
      },
    });
  } catch (error) { next(error); }
});

// ── Conversations ──────────────────────────────

router.get("/conversations", zValidator("query", queryConversationSchema), async (req: AuthRequest, res, next) => {
  try {
    const { type, limit, cursor } = req.query as unknown as {
      type?: "CHAT" | "TUTOR" | "QUIZ" | "STUDY_PLAN" | "EXPLAIN";
      limit?: number;
      cursor?: string;
    };
    const result = await aiService.listConversations(req.currentUser!.id, { type, limit, cursor });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.post("/conversations", zValidator("body", createConversationSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as CreateConversationInput;
    const conversation = await aiService.createConversation(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: conversation });
  } catch (error) { next(error); }
});

router.get("/conversations/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const conversation = await aiService.getConversation(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: conversation });
  } catch (error) { next(error); }
});

router.delete("/conversations/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await aiService.deleteConversation(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

/**
 * Rename a conversation. The web client titles a new conversation from its
 * first user message and lets the student override it afterwards, so this is
 * the only mutable field on the record.
 */
router.patch("/conversations/:id", zValidator("params", idParam), zValidator("body", updateConversationSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as UpdateConversationInput;
    const conversation = await aiService.updateConversation(req.currentUser!.id, String(req.params.id), input);
    return res.status(200).json({ success: true, data: conversation });
  } catch (error) { next(error); }
});

// ── Messages ───────────────────────────────────

router.get("/conversations/:id/messages", zValidator("params", messageParam), async (req: AuthRequest, res, next) => {
  try {
    const messages = await aiService.listMessages(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: messages });
  } catch (error) { next(error); }
});

router.post("/conversations/:id/messages", zValidator("params", messageParam), zValidator("body", createMessageSchema), limitAndLogAiUsage, async (req: AuthRequest, res, next) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const input = req.body as unknown as CreateMessageInput;
    const result = await aiService.addMessage(req.currentUser!.id, String(req.params.id), input, controller.signal);
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (controller.signal.aborted) return;
    next(error);
  }
});

/**
 * Edit one of the student's own questions and regenerate its answer. Every
 * message after the edited question is removed, so the reply they see always
 * belongs to the question they are reading.
 */
router.patch("/conversations/:id/messages/:messageId", zValidator("params", singleMessageParam), zValidator("body", updateMessageSchema), limitAndLogAiUsage, async (req: AuthRequest, res, next) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const input = req.body as unknown as UpdateMessageInput;
    const result = await aiService.editMessage(
      req.currentUser!.id,
      String(req.params.id),
      String(req.params.messageId),
      input,
      controller.signal,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (controller.signal.aborted) return;
    next(error);
  }
});

/** Regenerate an answer, replacing it and everything after it. */
router.post("/conversations/:id/messages/:messageId/regenerate", zValidator("params", singleMessageParam), limitAndLogAiUsage, async (req: AuthRequest, res, next) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const result = await aiService.regenerateMessage(
      req.currentUser!.id,
      String(req.params.id),
      String(req.params.messageId),
      controller.signal,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (controller.signal.aborted) return;
    next(error);
  }
});

// ── Structured extraction ─────────────────────
//
// Pure read-only text → JSON path: it calls the same grounded provider chat
// endpoint the no-tools path uses, then returns only output that validated
// against the client-supplied JSON Schema. No tools run and nothing is written,
// so there is never a proposal to confirm.

router.post("/structured", zValidator("body", structuredRequestSchema), limitAndLogAiUsage, async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as StructuredRequestInput;
    const result = await aiService.structured(req.currentUser!.id, input);
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// ── Pending action confirmations ──────────────
//
// The three endpoints behind the confirmation card. They operate on the
// in-memory proposal the agent parked, scoped to the authenticated user *and*
// the conversation — a proposal id from another account resolves to 404.

const actionParam = { id: z.string().min(1), actionId: z.string().min(1) };

/** What the student can currently approve. Used to rehydrate a reloaded page. */
router.get("/conversations/:id/pending-action", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const pending = await aiService.getPendingAction(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: { pendingAction: pending } });
  } catch (error) { next(error); }
});

/** Apply the proposal. Idempotent-guarded: a second confirm is a 409, not a re-run. */
router.post("/conversations/:id/pending-action/:actionId/confirm", zValidator("params", actionParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await aiService.confirmAction(
      req.currentUser!.id,
      String(req.params.id),
      String(req.params.actionId),
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

/** Decline the proposal. Safe to call twice. */
router.post("/conversations/:id/pending-action/:actionId/cancel", zValidator("params", actionParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await aiService.cancelAction(
      req.currentUser!.id,
      String(req.params.id),
      String(req.params.actionId),
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// ── Generated files (artifacts) ────────────────
//
// Files the assistant generated in a conversation, and their bytes. The list is
// conversation-scoped; the download is owner-scoped and streams the raw file
// (like the resource download, this endpoint is not JSON-wrapped).

router.get("/conversations/:id/artifacts", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const artifacts = await aiService.listArtifacts(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: { artifacts } });
  } catch (error) { next(error); }
});

const artifactParam = { artifactId: z.string().min(1) };

router.get("/artifacts/:artifactId/download", zValidator("params", artifactParam), async (req: AuthRequest, res, next) => {
  try {
    const file = await aiService.downloadArtifact(req.currentUser!.id, String(req.params.artifactId));
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.buffer.length));
    res.setHeader("Content-Disposition", contentDisposition(file.fileName));
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(file.buffer);
  } catch (error) { next(error); }
});

// ── Study plans ────────────────────────────────

router.get("/study-plans", zValidator("query", queryStudyPlanSchema), async (req: AuthRequest, res, next) => {
  try {
    const { limit, cursor } = req.query as unknown as { limit?: number; cursor?: string };
    const result = await aiService.listStudyPlans(req.currentUser!.id, { limit, cursor });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.post("/study-plans", zValidator("body", createStudyPlanSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as CreateStudyPlanInput;
    const plan = await aiService.createStudyPlan(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: plan });
  } catch (error) { next(error); }
});

router.get("/study-plans/:id", zValidator("params", studyPlanIdParam), async (req: AuthRequest, res, next) => {
  try {
    const plan = await aiService.getStudyPlan(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: plan });
  } catch (error) { next(error); }
});

router.patch("/study-plans/:id", zValidator("params", studyPlanIdParam), zValidator("body", updateStudyPlanSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as UpdateStudyPlanInput;
    const plan = await aiService.updateStudyPlan(req.currentUser!.id, String(req.params.id), input);
    return res.status(200).json({ success: true, data: plan });
  } catch (error) { next(error); }
});

router.delete("/study-plans/:id", zValidator("params", studyPlanIdParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await aiService.deleteStudyPlan(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// ── Study plan entries ─────────────────────────

router.get("/study-plans/:id/entries", zValidator("params", studyPlanIdParam), async (req: AuthRequest, res, next) => {
  try {
    const entries = await aiService.listStudyPlanEntries(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: entries });
  } catch (error) { next(error); }
});

router.patch("/study-plans/:id/entries/:entryId", zValidator("params", studyPlanEntryParam), zValidator("body", updateStudyPlanEntrySchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as UpdateStudyPlanEntryInput;
    const entry = await aiService.updateStudyPlanEntry(
      req.currentUser!.id,
      String(req.params.id),
      String(req.params.entryId),
      input,
    );
    return res.status(200).json({ success: true, data: entry });
  } catch (error) { next(error); }
});

// ── Mission tools ──────────────────────────────────
//
// The tool catalog the mission builder uses: names, kinds, confirmation
// requirements, and the JSON Schema for each tool's arguments. The schema
// comes from the tool definitions themselves, so the builder and the
// registry cannot drift apart.

router.get("/tools", async (req: AuthRequest, res, next) => {
  try {
    const catalog = await aiService.listMissionTools(req.currentUser!.id);
    return res.status(200).json({ success: true, data: catalog });
  } catch (error) { next(error); }
});

// ── Missions ─────────────────────────────────────
//
// Persistent multi-step missions. Each mission has ordered steps with
// explicit dependencies. Missions survive restarts and can be resumed,
// retried, or cancelled. Steps execute using the same tool layer as chat.

router.get("/missions", zValidator("query", queryMissionSchema), async (req: AuthRequest, res, next) => {
  try {
    const { status, limit, cursor } = req.query as unknown as QueryMissionInput;
    const result = await aiService.listMissions(req.currentUser!.id, { status, limit, cursor });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.post("/missions", zValidator("body", createMissionSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as CreateMissionInput;
    const mission = await aiService.createMission(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: mission });
  } catch (error) { next(error); }
});

router.get("/missions/:id", zValidator("params", missionIdParam), async (req: AuthRequest, res, next) => {
  try {
    const mission = await aiService.getMission(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: mission });
  } catch (error) { next(error); }
});

router.post("/missions/:id/cancel", zValidator("params", missionIdParam), async (req: AuthRequest, res, next) => {
  try {
    const mission = await aiService.cancelMission(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: mission });
  } catch (error) { next(error); }
});

router.post("/missions/:id/retry", zValidator("params", missionIdParam), async (req: AuthRequest, res, next) => {
  try {
    const mission = await aiService.retryMission(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: mission });
  } catch (error) { next(error); }
});

router.post("/missions/:id/execute", zValidator("params", missionIdParam), async (req: AuthRequest, res, next) => {
  try {
    const mission = await aiService.executeMission(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: mission });
  } catch (error) { next(error); }
});

// Approve the change a mission is waiting on. A mission step that writes in
// manual mode parks the proposal and waits; this claims it atomically and
// carries the mission on. A second approval of the same proposal is a 409 —
// the write happens exactly once.
router.post("/missions/:id/approve", zValidator("params", missionIdParam), async (req: AuthRequest, res, next) => {
  try {
    const mission = await aiService.approveMission(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: mission });
  } catch (error) { next(error); }
});

// ── Saved memories ─────────────────────────────
//
// Facts the student has explicitly saved so the assistant can reuse them.
// Rows exist only through this UI (provenance USER) or a confirmed save_memory
// proposal in chat (provenance AI) — ordinary chat is never retained. The
// `ai.memoryEnabled` setting (PATCH /settings) turns assistant-side use off;
// these endpoints keep serving the student's own list either way, so nothing
// they saved becomes unreachable.

const memoryParam = { id: z.string().min(1) };

router.get("/memories", zValidator("query", queryMemorySchema), async (req: AuthRequest, res, next) => {
  try {
    const { category, limit } = req.query as unknown as QueryMemoryInput;
    const result = await memoryService.list(req.currentUser!.id, { category, limit });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

/** 201 for a new memory; 200 when an equivalent one already existed (dedup). */
router.post("/memories", zValidator("body", createMemorySchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as CreateMemoryInput;
    const { memory, created } = await memoryService.create(req.currentUser!.id, input);
    return res.status(created ? 201 : 200).json({ success: true, data: memory });
  } catch (error) { next(error); }
});

/** Clear every saved memory for the current user. */
router.delete("/memories", async (req: AuthRequest, res, next) => {
  try {
    const result = await memoryService.clearAll(req.currentUser!.id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/memories/:id", zValidator("params", memoryParam), async (req: AuthRequest, res, next) => {
  try {
    const memory = await memoryService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: memory });
  } catch (error) { next(error); }
});

router.patch("/memories/:id", zValidator("params", memoryParam), zValidator("body", updateMemorySchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as UpdateMemoryInput;
    const memory = await memoryService.update(req.currentUser!.id, String(req.params.id), input);
    return res.status(200).json({ success: true, data: memory });
  } catch (error) { next(error); }
});

router.delete("/memories/:id", zValidator("params", memoryParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await memoryService.remove(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// ── Proactive briefing ────────────────────────
//
// A deterministic, read-only digest of what needs the student now: overdue and
// imminently due work, upcoming exams, at-risk goals and a study-week summary.
// No model call and no stored rows — the client fetches it when the AI
// workspace opens (and on refresh), which is why there is no scheduler behind
// it.

router.get("/proactive/briefing", async (req: AuthRequest, res, next) => {
  try {
    const briefing = await proactiveService.briefing(req.currentUser!.id);
    return res.status(200).json({ success: true, data: briefing });
  } catch (error) { next(error); }
});

export default router;

/** RFC 6266 Content-Disposition with an ASCII fallback + UTF-8 form. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
