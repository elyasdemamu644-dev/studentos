import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/lib/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import { subtasksService } from "./service";
import {
  querySubtaskSchema,
  createSubtaskSchema,
  updateSubtaskSchema,
  type CreateSubtaskInput,
  type UpdateSubtaskInput,
} from "./schema";

const router = Router();
router.use(authenticate);

const taskParam = { taskId: z.string().min(1) };
const subtaskParam = { taskId: z.string().min(1), subtaskId: z.string().min(1) };

router.get("/tasks/:taskId/subtasks", zValidator("params", taskParam), zValidator("query", querySubtaskSchema), async (req: AuthRequest, res, next) => {
  try {
    const { status } = req.query as unknown as { status?: "TODO" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" };
    const subtasks = await subtasksService.list(req.currentUser!.id, String(req.params.taskId), { status });
    return res.status(200).json({ success: true, data: subtasks });
  } catch (error) { next(error); }
});

router.post("/tasks/:taskId/subtasks", zValidator("params", taskParam), zValidator("body", createSubtaskSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as CreateSubtaskInput;
    const subtask = await subtasksService.create(req.currentUser!.id, String(req.params.taskId), input);
    return res.status(201).json({ success: true, data: subtask });
  } catch (error) { next(error); }
});

router.patch(
  "/tasks/:taskId/subtasks/:subtaskId",
  zValidator("params", subtaskParam),
  zValidator("body", updateSubtaskSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as UpdateSubtaskInput;
      const subtask = await subtasksService.update(
        req.currentUser!.id,
        String(req.params.taskId),
        String(req.params.subtaskId),
        input,
      );
      return res.status(200).json({ success: true, data: subtask });
    } catch (error) { next(error); }
  },
);

router.delete(
  "/tasks/:taskId/subtasks/:subtaskId",
  zValidator("params", subtaskParam),
  async (req: AuthRequest, res, next) => {
    try {
      const result = await subtasksService.delete(
        req.currentUser!.id,
        String(req.params.taskId),
        String(req.params.subtaskId),
      );
      return res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  },
);

export default router;