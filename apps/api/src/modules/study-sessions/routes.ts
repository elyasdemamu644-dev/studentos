import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/lib/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import { studySessionsService } from "./service";
import {
  queryStudySessionSchema,
  createStudySessionSchema,
  updateStudySessionSchema,
  completeStudySessionSchema,
  type StudySessionCreate,
  type StudySessionUpdate,
} from "./schema";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

router.get("/", zValidator("query", queryStudySessionSchema), async (req: AuthRequest, res, next) => {
  try {
    const { limit, cursor, courseId, taskId, range, from, to } = req.query as unknown as {
      limit?: number;
      cursor?: string;
      courseId?: string;
      taskId?: string;
      range?: "today" | "week" | "month";
      from?: string;
      to?: string;
    };
    const result = await studySessionsService.list(req.currentUser!.id, {
      limit,
      cursor,
      courseId,
      taskId,
      range,
      from,
      to,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const session = await studySessionsService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: session });
  } catch (error) { next(error); }
});

router.post("/", zValidator("body", createStudySessionSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as StudySessionCreate;
    const session = await studySessionsService.create(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: session });
  } catch (error) { next(error); }
});

router.post("/:id/complete", zValidator("params", idParam), zValidator("body", completeStudySessionSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as {
      endedAt?: string | null;
      durationMinutes?: number | null;
      focusRating?: number | null;
    };
    const session = await studySessionsService.complete(req.currentUser!.id, String(req.params.id), {
      endedAt: input.endedAt ? new Date(input.endedAt) : input.endedAt === null ? null : undefined,
      durationMinutes: input.durationMinutes,
      focusRating: input.focusRating,
    });
    return res.status(200).json({ success: true, data: session });
  } catch (error) { next(error); }
});

router.patch(
  "/:id",
  zValidator("params", idParam),
  zValidator("body", updateStudySessionSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as StudySessionUpdate;
      const session = await studySessionsService.update(req.currentUser!.id, String(req.params.id), input);
      return res.status(200).json({ success: true, data: session });
    } catch (error) { next(error); }
  },
);

router.delete("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await studySessionsService.delete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;