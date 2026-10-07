import { Router } from "express";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { settingsService } from "../services/settings";
import { updateSettingsSchema, type UpdateSettingsInput } from "../schemas/settings";

const router = Router();
router.use(authenticate);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const settings = await settingsService.get(req.currentUser!.id);
    return res.status(200).json({ success: true, data: settings });
  } catch (error) { next(error); }
});

router.patch("/", zValidator("body", updateSettingsSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as UpdateSettingsInput;
    const settings = await settingsService.update(req.currentUser!.id, input.settings);
    return res.status(200).json({ success: true, data: settings });
  } catch (error) { next(error); }
});

export default router;