import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { aiService } from "../services/ai/service";
import {
  createConversationSchema,
  createMessageSchema,
  createStudyPlanSchema,
  structuredRequestSchema,
  updateConversationSchema,
  updateStudyPlanSchema,
  updateStudyPlanEntrySchema,
  queryConversationSchema,
  queryStudyPlanSchema,
  type CreateConversationInput,
  type CreateMessageInput,
  type CreateStudyPlanInput,
  type StructuredRequestInput,
  type UpdateConversationInput,
  type UpdateStudyPlanInput,
  type UpdateStudyPlanEntryInput,
} from "../schemas/ai";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };
const messageParam = { id: z.string().min(1) };
const studyPlanIdParam = { id: z.string().min(1) };
const studyPlanEntryParam = { id: z.string().min(1), entryId: z.string().min(1) };

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

router.post("/conversations/:id/messages", zValidator("params", messageParam), zValidator("body", createMessageSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as CreateMessageInput;
    const result = await aiService.addMessage(req.currentUser!.id, String(req.params.id), input);
    return res.status(201).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// ── Structured extraction ─────────────────────
//
// Pure read-only text → JSON path: it calls the same grounded provider chat
// endpoint the no-tools path uses, then returns only output that validated
// against the client-supplied JSON Schema. No tools run and nothing is written,
// so there is never a proposal to confirm.

router.post("/structured", zValidator("body", structuredRequestSchema), async (req: AuthRequest, res, next) => {
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

export default router;