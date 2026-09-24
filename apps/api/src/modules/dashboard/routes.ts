import { Router } from "express";
import { authenticate, type AuthRequest } from "@/modules/auth/routes";
import { dashboardService } from "./service";

const router = Router();
router.use(authenticate);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const data = await dashboardService.getDashboard(req.currentUser!.id);
    return res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

export default router;
