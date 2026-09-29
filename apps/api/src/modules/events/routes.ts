import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/lib/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import { eventsService } from "./service";
import {
  queryEventSchema,
  createEventSchema,
  updateEventSchema,
  type EventListQuery,
  type EventCreate,
  type EventUpdate,
} from "./schema";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

router.get("/", zValidator("query", queryEventSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await eventsService.list(
      req.currentUser!.id,
      req.query as unknown as EventListQuery,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const event = await eventsService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: event });
  } catch (error) { next(error); }
});

router.post("/", zValidator("body", createEventSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as EventCreate;
    const event = await eventsService.create(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: event });
  } catch (error) { next(error); }
});

router.patch(
  "/:id",
  zValidator("params", idParam),
  zValidator("body", updateEventSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as EventUpdate;
      const event = await eventsService.update(req.currentUser!.id, String(req.params.id), input);
      return res.status(200).json({ success: true, data: event });
    } catch (error) { next(error); }
  },
);

router.delete("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await eventsService.delete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;