import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { resourcesService } from "../services/resources";
import {
  queryResourceSchema,
  createResourceSchema,
  updateResourceSchema,
  type ResourceListQuery,
  type ResourceCreate,
  type ResourceUpdate,
} from "../schemas/resources";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

router.get("/", zValidator("query", queryResourceSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await resourcesService.list(
      req.currentUser!.id,
      req.query as unknown as ResourceListQuery,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const record = await resourcesService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: record });
  } catch (error) { next(error); }
});

router.post("/", zValidator("body", createResourceSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as ResourceCreate;
    const record = await resourcesService.create(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: record });
  } catch (error) { next(error); }
});

router.patch(
  "/:id",
  zValidator("params", idParam),
  zValidator("body", updateResourceSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as ResourceUpdate;
      const record = await resourcesService.update(req.currentUser!.id, String(req.params.id), input);
      return res.status(200).json({ success: true, data: record });
    } catch (error) { next(error); }
  },
);

router.delete("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await resourcesService.delete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;