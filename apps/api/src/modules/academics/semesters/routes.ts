import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/lib/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import { semestersService } from "./service";
import {
  listQuery,
  create,
  update,
} from "./schema";

const router = Router();

const idParam = { id: z.string().min(1) };

// GET /semesters
router.get("/", authenticate, zValidator("query", listQuery), async (req: AuthRequest, res: any, next: any) => {
  try {
    const result = await semestersService.listSemesters(req.currentUser!.id);
    res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// POST /semesters
router.post("/", authenticate, zValidator("body", create), async (req: AuthRequest, res: any, next: any) => {
  try {
    const semester = await semestersService.createSemester(req.currentUser!.id, req.body);
    res.status(201).json({ success: true, data: semester });
  } catch (error) { next(error); }
});

// GET /semesters/:id
router.get("/:id", authenticate, zValidator("params", idParam), async (req: AuthRequest, res: any, next: any) => {
  try {
    const semester = await semestersService.getSemester(req.currentUser!.id, String(req.params.id));
    res.status(200).json({ success: true, data: semester });
  } catch (error) { next(error); }
});

// PATCH /semesters/:id
router.patch("/:id", authenticate, zValidator("params", idParam), zValidator("body", update), async (req: AuthRequest, res: any, next: any) => {
  try {
    const semester = await semestersService.updateSemester(req.currentUser!.id, String(req.params.id), req.body);
    res.status(200).json({ success: true, data: semester });
  } catch (error) { next(error); }
});

// DELETE /semesters/:id
router.delete("/:id", authenticate, zValidator("params", idParam), async (req: AuthRequest, res: any, next: any) => {
  try {
    await semestersService.deleteSemester(req.currentUser!.id, String(req.params.id));
    res.status(200).json({ success: true, data: { deleted: true } });
  } catch (error) { next(error); }
});

export default router;