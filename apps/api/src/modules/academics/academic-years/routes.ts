import { Router } from "express";
import { zValidator } from "@/lib/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import { academicYearsService } from "./service";
import {
  listQuery,
  create,
  update,
} from "./schema";

const router = Router();

// GET /academic-years
router.get("/", authenticate, zValidator("query", listQuery), async (req: AuthRequest, res: any, next: any) => {
  try {
    const result = await academicYearsService.listAcademicYears(req.currentUser!.id);
    res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// POST /academic-years
router.post("/", authenticate, zValidator("body", create), async (req: AuthRequest, res: any, next: any) => {
  try {
    const year = await academicYearsService.createAcademicYear(req.currentUser!.id, req.body);
    res.status(201).json({ success: true, data: year });
  } catch (error) { next(error); }
});

// GET /academic-years/:id
router.get("/:id", authenticate, async (req: AuthRequest, res: any, next: any) => {
  try {
    const year = await academicYearsService.getAcademicYear(req.currentUser!.id, String(req.params.id));
    res.status(200).json({ success: true, data: year });
  } catch (error) { next(error); }
});

// PATCH /academic-years/:id
router.patch("/:id", authenticate, zValidator("body", update), async (req: AuthRequest, res: any, next: any) => {
  try {
    const year = await academicYearsService.updateAcademicYear(req.currentUser!.id, String(req.params.id), req.body);
    res.status(200).json({ success: true, data: year });
  } catch (error) { next(error); }
});

// DELETE /academic-years/:id
router.delete("/:id", authenticate, async (req: AuthRequest, res: any, next: any) => {
  try {
    await academicYearsService.deleteAcademicYear(req.currentUser!.id, String(req.params.id));
    res.status(200).json({ success: true, data: { deleted: true } });
  } catch (error) { next(error); }
});

export default router;