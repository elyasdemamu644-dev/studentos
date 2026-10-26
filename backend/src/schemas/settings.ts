import { z } from "zod";
import { isAiMode, isExecutionAutonomyMode } from "./ai";

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

    // AI mode is a closed set; an unknown value would silently fall back to
    // AUTO, so reject it here instead of storing something the assistant ignores.
    const aiMode = settings["ai.mode"];
    if (aiMode !== undefined && aiMode !== null && !isAiMode(aiMode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai.mode"],
        message: "Unknown AI mode",
      });
    }

    // Execution autonomy mode: controls whether safe WRITE tools run automatically.
    const execMode = settings["ai.executionMode"];
    if (execMode !== undefined && execMode !== null && !isExecutionAutonomyMode(execMode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai.executionMode"],
        message: "Unknown execution autonomy mode",
      });
    }

    // The Default AI model is a free-form provider model id, but never blank —
    // an empty string would override the server default with nothing.
    const model = settings["ai.model"];
    if (model !== undefined && model !== null && (model.trim().length === 0 || model.length > 200)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai.model"],
        message: "AI model must be 1–200 characters",
      });
    }

    // Saved memory is an on/off switch stored as "true"/"false"; anything else
    // would silently flip the wrong way when read back.
    const memoryEnabled = settings["ai.memoryEnabled"];
    if (memoryEnabled !== undefined && memoryEnabled !== null && memoryEnabled !== "true" && memoryEnabled !== "false") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai.memoryEnabled"],
        message: "AI memory must be 'true' or 'false'",
      });
    }
  }),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;