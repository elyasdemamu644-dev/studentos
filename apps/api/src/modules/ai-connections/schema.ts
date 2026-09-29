import { z } from "zod";

export const AiProviderSchema = z.enum([
  "openai",
  "gemini",
  "anthropic",
  "openrouter",
  "ollama",
  "custom",
]);

/**
 * Providers that authenticate by endpoint alone and therefore need no key.
 * `ollama` runs locally and exposes its API unauthenticated. `custom` is an
 * OpenAI-compatible endpoint, so it still needs a key.
 */
export const CREDENTIAL_FREE_PROVIDERS = ["ollama"] as const;

export function isCredentialFreeProvider(provider: string): boolean {
  return (CREDENTIAL_FREE_PROVIDERS as readonly string[]).includes(provider);
}

export const CreateAiConnectionSchema = z
  .object({
    provider: AiProviderSchema,
    model: z.string().trim().max(256).optional().nullable(),
    endpoint: z
      .string()
      .trim()
      .max(512)
      .url()
      .optional()
      .nullable()
      .refine((val) => {
          // endpoint is optional; when provided it must be an http(s) URL.
          // Presence requirements (ollama/custom) are enforced in superRefine below.
          if (!val) return true;
          if (val.startsWith("http://") || val.startsWith("https://")) {
            return true;
          }
          return false;
        },
        { message: "Invalid endpoint URL" }
      ),
    // Optional in the type, but required at runtime for every provider that
    // actually uses a key (see superRefine below). `credentialsEncrypted` is a
    // non-nullable column, and the route validator enforces the same rule.
    credentials: z.string().min(1).max(2000).optional(),
  })
  .superRefine((data, ctx) => {
      if (data.provider === "ollama" || data.provider === "custom") {
        if (!data.endpoint) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endpoint"],
            message: "Endpoint is required for ollama and custom providers",
          });
          return false;
        }
      }
      if (!isCredentialFreeProvider(data.provider) && !data.credentials) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["credentials"],
          message: `Credentials are required for the ${data.provider} provider`,
        });
        return false;
      }
      return true;
    });

export const UpdateAiConnectionSchema = z
  .object({
    provider: AiProviderSchema.optional(),
    model: z.string().trim().max(256).optional().nullable(),
    endpoint: z
      .string()
      .trim()
      .max(512)
      .url()
      .optional()
      .nullable(),
    credentials: z.string().min(1).max(2000).optional(),
    enabled: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

export const AiConnectionResponseSchema = z.object({
  id: z.string().cuid(),
  provider: AiProviderSchema,
  model: z.string().max(256).nullable(),
  endpoint: z.string().max(512).nullable(),
  enabled: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const AiConnectionPageSchema = z.object({
  items: z.array(AiConnectionResponseSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});

export const TestConnectionInputSchema = z
  .object({
    provider: AiProviderSchema,
    model: z.string().trim().max(256).optional().nullable(),
    endpoint: z
      .string()
      .trim()
      .max(512)
      .url()
      .optional()
      .nullable(),
    // An ad-hoc test has no stored connection to read credentials from, so a key
    // must be supplied inline — except for credential-free providers like ollama.
    // POST /:id/test does not parse this schema; it takes credentials from the DB.
    credentials: z.string().min(1).max(2000).optional(),
  })
  .superRefine((data, ctx) => {
      if (data.provider === "ollama" || data.provider === "custom") {
        if (!data.endpoint) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endpoint"],
            message: "Endpoint is required for ollama and custom providers",
          });
          return false;
        }
      }
      if (!isCredentialFreeProvider(data.provider) && !data.credentials) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["credentials"],
          message: `Credentials are required for the ${data.provider} provider`,
        });
        return false;
      }
      return true;
    });

export const TestConnectionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  model: z.string().max(256).nullable().optional(),
  error: z.string().nullable().optional(),
});

// ── Type exports ──────────────────────────────────────────────────────────────

export type AiProviderName = z.infer<typeof AiProviderSchema>;
export type CreateAiConnectionInput = z.infer<typeof CreateAiConnectionSchema>;
export type UpdateAiConnectionInput = z.infer<typeof UpdateAiConnectionSchema>;
export type AiConnectionResponse = z.infer<typeof AiConnectionResponseSchema>;
export type AiConnectionPage = z.infer<typeof AiConnectionPageSchema>;
export type TestConnectionInput = z.infer<typeof TestConnectionInputSchema>;
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;
