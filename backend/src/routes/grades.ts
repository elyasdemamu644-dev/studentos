import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { gradesService } from "../services/grades";
import {
  queryGradeSchema,
  createGradeSchema,
  updateGradeSchema,
  type GradeListQuery,
  type GradeCreate,
  type GradeUpdate,
} from "../schemas/grades";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

router.get("/", zValidator("query", queryGradeSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await gradesService.list(
      req.currentUser!.id,
      req.query as unknown as GradeListQuery,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const grade = await gradesService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: grade });
  } catch (error) { next(error); }
});

router.post("/", zValidator("body", createGradeSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as GradeCreate;
    const grade = await gradesService.create(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: grade });
  } catch (error) { next(error); }
});

router.patch(
  "/:id",
  zValidator("params", idParam),
  zValidator("body", updateGradeSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as GradeUpdate;
      const grade = await gradesService.update(req.currentUser!.id, String(req.params.id), input);
      return res.status(200).json({ success: true, data: grade });
    } catch (error) { next(error); }
  },
);

router.delete("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await gradesService.delete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;