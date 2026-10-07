import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { coursesService } from "../services/courses";
import {
  courseListQuerySchema,
  courseCreateSchema,
  courseUpdateSchema,
  type CourseListQuery,
} from "../schemas/courses";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

function withEntity(entity: Record<string, unknown>) {
  // One envelope, one copy of the data. The fields used to be spread onto the
  // root as well, which gave clients two places to read the same value from.
  return { success: true, data: entity };
}

router.get("/", zValidator("query", courseListQuerySchema), async (req: AuthRequest, res, next) => {
  try {
    const { limit, cursor, search, status, semesterId } =
      req.query as unknown as CourseListQuery;
    const result = await coursesService.list(
      req.currentUser!.id,
      { limit, cursor },
      { search, status, semesterId },
    );
    return res.status(200).json({ success: true, data: result.items });
  } catch (error) { next(error); }
});

router.post("/", zValidator("body", courseCreateSchema), async (req: AuthRequest, res, next) => {
  try {
    const course = await coursesService.create(req.currentUser!.id, req.body);
    return res.status(201).json(withEntity(course));
  } catch (error) { next(error); }
});

router.get("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const course = await coursesService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json(withEntity(course));
  } catch (error) { next(error); }
});

// Cross-system rollup (tasks, events, exams, notes, resources, grades, study).
router.get("/:id/summary", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const summary = await coursesService.getSummary(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: summary });
  } catch (error) { next(error); }
});

router.patch("/:id", zValidator("params", idParam), zValidator("body", courseUpdateSchema), async (req: AuthRequest, res, next) => {
  try {
    const course = await coursesService.update(req.currentUser!.id, String(req.params.id), req.body);
    return res.status(200).json(withEntity(course));
  } catch (error) { next(error); }
});

router.delete("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await coursesService.delete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;