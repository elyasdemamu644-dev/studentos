import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { notificationsService } from "../services/notifications";
import {
  queryNotificationSchema,
  updateNotificationSchema,
  type NotificationListQuery,
  type UpdateNotificationInput,
} from "../schemas/notifications";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

// Static routes first so "read-all" never matches a dynamic :id.
router.post("/read-all", async (req: AuthRequest, res, next) => {
  try {
    const result = await notificationsService.readAll(req.currentUser!.id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// Derives reminder notifications from the user's live tasks, exams and goals.
// Idempotent, so the client can call this on every load.
router.post("/generate", async (req: AuthRequest, res, next) => {
  try {
    const result = await notificationsService.generateForUser(req.currentUser!.id);
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/", zValidator("query", queryNotificationSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await notificationsService.list(
      req.currentUser!.id,
      req.query as unknown as NotificationListQuery,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const notification = await notificationsService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: notification });
  } catch (error) { next(error); }
});

router.post("/:id/read", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const notification = await notificationsService.markRead(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: notification });
  } catch (error) { next(error); }
});

// Emails the notification to the authenticated user's own mailbox. The
// recipient is never an input — only the owner can dispatch, and only to
// themselves — so this cannot become an arbitrary-mail relay.
router.post("/:id/email", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await notificationsService.dispatchEmail(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.patch(
  "/:id",
  zValidator("params", idParam),
  zValidator("body", updateNotificationSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as UpdateNotificationInput;
      const notification = await notificationsService.update(req.currentUser!.id, String(req.params.id), input);
      return res.status(200).json({ success: true, data: notification });
    } catch (error) { next(error); }
  },
);

export default router;