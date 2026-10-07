import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { studySessionsService } from "../services/study-sessions";
import {
  queryStudySessionSchema,
  createStudySessionSchema,
  updateStudySessionSchema,
  completeStudySessionSchema,
  type StudySessionListQuery,
  type StudySessionCreate,
  type StudySessionUpdate,
} from "../schemas/study-sessions";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

router.get("/", zValidator("query", queryStudySessionSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await studySessionsService.list(
      req.currentUser!.id,
      req.query as unknown as StudySessionListQuery,
    );
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