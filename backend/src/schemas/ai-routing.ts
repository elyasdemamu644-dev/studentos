import { z } from "zod";
import { CAPABILITY_KINDS, EVIDENCE_LEVELS } from "@/services/ai/routing/capability-catalog";

// ─────────────────────────────────────────────────────────────────────────────
// Routing schemas
// ─────────────────────────────────────────────────────────────────────────────
//
// The wire contract for the unified routing architecture. Kept apart from
// `schemas/ai.ts` so the routing surface can evolve without touching the chat
// schemas, but both share the same provider enum so a provider name is valid in
// exactly one place.

export const aiProviderEnum = z.enum([
  "openai",
  "gemini",
  "anthropic",
  "openrouter",
  "ollama",
  "custom",
]);

export const routingStrategySchema = z.enum(["FIXED", "AUTO"]);
export type RoutingStrategy = z.infer<typeof routingStrategySchema>;

export const capabilityKindSchema = z.enum(CAPABILITY_KINDS);
export const evidenceLevelSchema = z.enum(EVIDENCE_LEVELS);

/**
 * Named routing presets. A preset is a starting point the engine applies; the
 * individual allow/deny/priority rows always win over it.
 */
export const ROUTING_PRESETS = ["quality", "speed", "cost", "local-first", "balanced"] as const;
export const routingPresetSchema = z.enum(ROUTING_PRESETS);
export type RoutingPreset = z.infer<typeof routingPresetSchema>;

export const updateRoutingPolicySchema = z
  .object({
    strategy: routingStrategySchema.optional(),
    fixedConnectionId: z.string().min(1).max(64).nullable().optional(),
    fixedModel: z.string().trim().max(256).nullable().optional(),
    freeOnly: z.boolean().optional(),
    spendCeilingCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    spendWindowDays: z.number().int().min(1).max(365).optional(),
    allowAutoFallback: z.boolean().optional(),
    externalProcessingDisabled: z.boolean().optional(),
    preset: routingPresetSchema.nullable().optional(),
    fallbackOrder: z.array(z.string().min(1).max(64)).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpdateRoutingPolicyInput = z.infer<typeof updateRoutingPolicySchema>;

export const modelPreferenceInputSchema = z.object({
  scope: z.enum(["GLOBAL", "CONVERSATION"]).default("GLOBAL"),
  conversationId: z.string().min(1).max(64).nullable().optional(),
  provider: aiProviderEnum,
  model: z.string().trim().min(1).max(256),
  connectionId: z.string().min(1).max(64).nullable().optional(),
  priority: z.number().int().min(0).max(1000).nullable().optional(),
  allowed: z.boolean().optional(),
});

export type ModelPreferenceInput = z.infer<typeof modelPreferenceInputSchema>;

export const upsertModelPreferencesSchema = z.object({
  preferences: z.array(modelPreferenceInputSchema).max(200),
});

/**
 * Per-conversation model override. Sending `null` clears the override so the
 * conversation falls back to the global default → Auto precedence.
 */
export const conversationModelOverrideSchema = z.object({
  provider: aiProviderEnum.nullable(),
  model: z.string().trim().max(256).nullable(),
  connectionId: z.string().min(1).max(64).nullable().optional(),
});

export type ConversationModelOverrideInput = z.infer<typeof conversationModelOverrideSchema>;

export const capabilityOverrideSchema = z.object({
  provider: aiProviderEnum,
  model: z.string().trim().min(1).max(256),
  kind: capabilityKindSchema,
  evidence: evidenceLevelSchema,
  note: z.string().trim().max(500).nullable().optional(),
  connectionId: z.string().min(1).max(64).nullable().optional(),
});

export const upsertCapabilityOverridesSchema = z.object({
  overrides: z.array(capabilityOverrideSchema).max(200),
});

// ── Usage / health query ────────────────────────────────────────────────────

export const usageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
  conversationId: z.string().min(1).max(64).optional(),
});

export const healthQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
