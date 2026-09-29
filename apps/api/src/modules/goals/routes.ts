import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/lib/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import { goalsService } from "./service";
import {
  queryGoalSchema,
  createGoalSchema,
  updateGoalSchema,
  createMilestoneSchema,
  updateMilestoneSchema,
  type GoalListQuery,
  type GoalCreate,
  type MilestoneCreate,
  type GoalUpdate,
  type MilestoneUpdate,
} from "./schema";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

// ── Goal CRUD ────────────────────────────────────────────────

router.get("/", zValidator("query", queryGoalSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await goalsService.list(
      req.currentUser!.id,
      req.query as unknown as GoalListQuery,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const goal = await goalsService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: goal });
  } catch (error) { next(error); }
});

router.post("/", zValidator("body", createGoalSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as GoalCreate;
    const goal = await goalsService.create(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: goal });
  } catch (error) { next(error); }
});

router.patch(
  "/:id",
  zValidator("params", idParam),
  zValidator("body", updateGoalSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as GoalUpdate;
      const goal = await goalsService.update(req.currentUser!.id, String(req.params.id), input);
      return res.status(200).json({ success: true, data: goal });
    } catch (error) { next(error); }
  },
);

router.delete("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await goalsService.delete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// ── Milestones (nested under a goal) ─────────────────────────

router.get("/:goalId/milestones", zValidator("params", { goalId: z.string().min(1) }), async (req: AuthRequest, res, next) => {
  try {
    const milestones = await goalsService.listMilestones(req.currentUser!.id, String(req.params.goalId));
    return res.status(200).json({ success: true, data: milestones });
  } catch (error) { next(error); }
});

router.post("/:goalId/milestones", zValidator("params", { goalId: z.string().min(1) }), zValidator("body", createMilestoneSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as MilestoneCreate;
    const milestone = await goalsService.createMilestone(req.currentUser!.id, String(req.params.goalId), input);
    return res.status(201).json({ success: true, data: milestone });
  } catch (error) { next(error); }
});

router.patch(
  "/:goalId/milestones/:milestoneId",
  zValidator("params", { goalId: z.string().min(1), milestoneId: z.string().min(1) }),
  zValidator("body", updateMilestoneSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as MilestoneUpdate;
      const milestone = await goalsService.updateMilestone(
        req.currentUser!.id,
        String(req.params.goalId),
        String(req.params.milestoneId),
        input,
      );
      return res.status(200).json({ success: true, data: milestone });
    } catch (error) { next(error); }
  },
);

router.delete(
  "/:goalId/milestones/:milestoneId",
  zValidator("params", { goalId: z.string().min(1), milestoneId: z.string().min(1) }),
  async (req: AuthRequest, res, next) => {
    try {
      const result = await goalsService.deleteMilestone(
        req.currentUser!.id,
        String(req.params.goalId),
        String(req.params.milestoneId),
      );
      return res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  },
);

export default router;