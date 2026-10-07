import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { taskTagsService } from "../services/task-tags";
import {
  createTaskTagSchema,
  updateTaskTagSchema,
  type CreateTaskTagInput,
  type UpdateTaskTagInput,
} from "../schemas/task-tags";

const router = Router();
router.use(authenticate);

const taskParam = { taskId: z.string().min(1) };
const tagParam = { taskId: z.string().min(1), tagId: z.string().min(1) };

router.get("/tasks/:taskId/tags", zValidator("params", taskParam), async (req: AuthRequest, res, next) => {
  try {
    const tags = await taskTagsService.list(req.currentUser!.id, String(req.params.taskId));
    return res.status(200).json({ success: true, data: tags });
  } catch (error) { next(error); }
});

router.post("/tasks/:taskId/tags", zValidator("params", taskParam), zValidator("body", createTaskTagSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as CreateTaskTagInput;
    const tag = await taskTagsService.create(req.currentUser!.id, String(req.params.taskId), input);
    return res.status(201).json({ success: true, data: tag });
  } catch (error) { next(error); }
});

router.patch(
  "/tasks/:taskId/tags/:tagId",
  zValidator("params", tagParam),
  zValidator("body", updateTaskTagSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as UpdateTaskTagInput;
      const tag = await taskTagsService.update(
        req.currentUser!.id,
        String(req.params.taskId),
        String(req.params.tagId),
        input,
      );
      return res.status(200).json({ success: true, data: tag });
    } catch (error) { next(error); }
  },
);

router.delete(
  "/tasks/:taskId/tags/:tagId",
  zValidator("params", tagParam),
  async (req: AuthRequest, res, next) => {
    try {
      const result = await taskTagsService.delete(
        req.currentUser!.id,
        String(req.params.taskId),
        String(req.params.tagId),
      );
      return res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  },
);

export default router;