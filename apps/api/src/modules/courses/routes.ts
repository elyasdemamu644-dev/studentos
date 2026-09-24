import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/lib/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import { coursesService } from "./service";
import { courseListQuerySchema, courseCreateSchema, courseUpdateSchema } from "./schema";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

function withEntity(entity: Record<string, unknown>) {
  return { success: true, data: entity, ...entity };
}

router.get("/", zValidator("query", courseListQuerySchema), async (req: AuthRequest, res, next) => {
  try {
    const { limit, cursor, search, status, semesterId } = req.query as any;
    const result = await coursesService.list(req.currentUser!.id, {
      limit: limit ? Number(limit) : undefined,
      cursor,
    }, { search, status, semesterId });
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