import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { notesService } from "../services/notes";
import {
  queryNoteSchema,
  createNoteSchema,
  updateNoteSchema,
  type NoteListQuery,
  type NoteCreate,
  type NoteUpdate,
} from "../schemas/notes";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

router.get("/", zValidator("query", queryNoteSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await notesService.list(
      req.currentUser!.id,
      req.query as unknown as NoteListQuery,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.get("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const note = await notesService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: note });
  } catch (error) { next(error); }
});

router.post("/", zValidator("body", createNoteSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as NoteCreate;
    const note = await notesService.create(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: note });
  } catch (error) { next(error); }
});

router.patch(
  "/:id",
  zValidator("params", idParam),
  zValidator("body", updateNoteSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as NoteUpdate;
      const note = await notesService.update(req.currentUser!.id, String(req.params.id), input);
      return res.status(200).json({ success: true, data: note });
    } catch (error) { next(error); }
  },
);

router.delete("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await notesService.delete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;