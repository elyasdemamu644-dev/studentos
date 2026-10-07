import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { tasksService } from "../services/tasks";
import {
  createTaskSchema,
  updateTaskSchema,
  queryTaskSchema,
  type TaskCreate,
  type TaskUpdate,
} from "../schemas/tasks";

const router = Router();
router.use(authenticate);

router.get("/", zValidator("query", queryTaskSchema), async (req: AuthRequest, res, next) => {
  try {
    const { limit, cursor, status, priority, type, courseId, dueBefore, dueAfter, search } = req.query as any;
    const result = await tasksService.list(req.currentUser!.id, {
      status, priority, type, courseId, dueBefore, dueAfter, search,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/:id", zValidator("params", { id: z.string().min(1) }), async (req: AuthRequest, res, next) => {
  try {
    const task = await tasksService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: task });
  } catch (error) { next(error); }
});

router.post("/", zValidator("body", createTaskSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as TaskCreate;
    const task = await tasksService.create(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: task });
  } catch (error) { next(error); }
});

router.patch("/:id", zValidator("params", { id: z.string().min(1) }), zValidator("body", updateTaskSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as TaskUpdate;
    const task = await tasksService.update(req.currentUser!.id, String(req.params.id), input);
    return res.status(200).json({ success: true, data: task });
  } catch (error) { next(error); }
});

router.post("/:id/complete", zValidator("params", { id: z.string().min(1) }), async (req: AuthRequest, res, next) => {
  try {
    const task = await tasksService.complete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: task });
  } catch (error) { next(error); }
});

router.delete("/:id", zValidator("params", { id: z.string().min(1) }), async (req: AuthRequest, res, next) => {
  try {
    const result = await tasksService.delete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;
