import { z } from "zod";

// ─────────────────────────────────────────────
// Settings contract
// ─────────────────────────────────────────────
//
// User settings are stored as key/value rows (UserSetting model, unique on
// [userId, key]). PATCH accepts an object of key → value; a null value
// deletes the setting, restoring the default.

export const stringPattern = z
  .string()
  .min(1, "Key cannot be empty")
  .max(100, "Key is too long");

export const updateSettingsSchema = z.object({
  settings: z.record(
    stringPattern,
    z.string().max(1000, "Value is too long").nullable(),
  ).default({}).superRefine((settings, ctx) => {
    const mode = settings["ai.providerMode"];
    if (mode !== undefined && mode !== null && mode !== "default" && mode !== "personal") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai.providerMode"],
        message: "AI provider mode must be 'default' or 'personal'",
      });
    }
  }),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;