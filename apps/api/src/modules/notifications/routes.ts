import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/lib/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import { notificationsService } from "./service";
import {
  queryNotificationSchema,
  updateNotificationSchema,
  type UpdateNotificationInput,
} from "./schema";

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

router.get("/", zValidator("query", queryNotificationSchema), async (req: AuthRequest, res, next) => {
  try {
    const { limit, cursor, status, type, unread } = req.query as unknown as {
      limit?: number;
      cursor?: string;
      status?: "UNREAD" | "READ" | "ARCHIVED";
      type?: "ASSIGNMENT_DUE" | "EXAM_REMINDER" | "OVERDUE_TASK" | "STUDY_REMINDER" | "STUDY_PLAN_REMINDER" | "GOAL_REMINDER" | "GENERAL";
      unread?: boolean;
    };
    const result = await notificationsService.list(req.currentUser!.id, {
      limit,
      cursor,
      status,
      type,
      unread,
    });
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