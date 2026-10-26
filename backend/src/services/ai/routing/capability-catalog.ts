import type { AiProviderName } from "@/schemas/ai";

// ─────────────────────────────────────────────────────────────────────────────
// Model capability catalog + evidence taxonomy
// ─────────────────────────────────────────────────────────────────────────────
//
// Every claim about what a model can do is tagged with *how we know it*. A text
// round-trip never proves image, tool or structured-output support, so evidence
// is a first-class field, not an afterthought:
//
//   VERIFIED          — we exercised this exact capability and it worked.
//   PROVIDER_REPORTED — the provider's own model metadata declares it.
//   USER_CONFIGURED   — the student asserted it while configuring a connection.
//   UNKNOWN           — we do not know. Callers must treat UNKNOWN as *not*
//                       supported for gating decisions that would otherwise
//                       break a turn (e.g. sending an image to a text-only
//                       model), and surface it honestly in the UI.
//
// This is a static, curated catalog like `models.ts`: it does not call a
// provider. A deployment may still override any entry at runtime (see
// `capability-overrides`), and a user's own connection may narrow it.

export const CAPABILITY_KINDS = [
  "TEXT",
  "VISION",
  "TOOLS",
  "STRUCTURED_OUTPUT",
  "LONG_CONTEXT",
  "REASONING",
] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const EVIDENCE_LEVELS = [
  "VERIFIED",
  "PROVIDER_REPORTED",
  "USER_CONFIGURED",
  "UNKNOWN",
] as const;

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/**
 * Ordering from strongest to weakest. A merge of two claims about the same
 * capability keeps the stronger evidence, so a user's assertion never downgrades
 * something a provider reported or we verified.
 */
const EVIDENCE_RANK: Record<EvidenceLevel, number> = {
  VERIFIED: 3,
  PROVIDER_REPORTED: 2,
  USER_CONFIGURED: 1,
  UNKNOWN: 0,
};

export function strongerEvidence(a: EvidenceLevel, b: EvidenceLevel): EvidenceLevel {
  return EVIDENCE_RANK[a] >= EVIDENCE_RANK[b] ? a : b;
}

/** True when the evidence is strong enough to gate a turn on the capability. */
export function isCapabilityTrusted(evidence: EvidenceLevel): boolean {
  return evidence === "VERIFIED" || evidence === "PROVIDER_REPORTED";
}

export interface ModelCapabilityClaim {
  kind: CapabilityKind;
  evidence: EvidenceLevel;
  /** Optional short note explaining how the claim was established. */
  note?: string;
}

export interface CatalogModel {
  id: string;
  label: string;
  provider: AiProviderName;
  /** Capabilities this model is known to have, each with its evidence. */
  capabilities: ModelCapabilityClaim[];
  /** Context window in tokens, when known. */
  contextTokens?: number;
  /**
   * Cost per 1M tokens in US cents. Zero means free. `null` means pricing is
   * unknown (the router treats unknown pricing as "not free" for free-only
   * filtering and never auto-selects it under a spend ceiling).
   */
  inputCostPerMTokCents: number | null;
  outputCostPerMTokCents: number | null;
}

function textOnly(note: string): ModelCapabilityClaim[] {
  return [
    { kind: "TEXT", evidence: "PROVIDER_REPORTED", note },
    { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED", note },
  ];
}

// A curated catalog. Vision/tool support is only marked PROVIDER_REPORTED where
// the provider's own docs state it for the exact model id; anything else stays
// UNKNOWN so the router never sends an image to a model we cannot vouch for.
const CATALOG: CatalogModel[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "PROVIDER_REPORTED" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
      { kind: "LONG_CONTEXT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 128_000,
    inputCostPerMTokCents: 250,
    outputCostPerMTokCents: 1000,
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "PROVIDER_REPORTED" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 128_000,
    inputCostPerMTokCents: 15,
    outputCostPerMTokCents: 60,
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    provider: "openai",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "PROVIDER_REPORTED" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
      { kind: "LONG_CONTEXT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 1_000_000,
    inputCostPerMTokCents: 200,
    outputCostPerMTokCents: 800,
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    provider: "openai",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "PROVIDER_REPORTED" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 1_000_000,
    inputCostPerMTokCents: 40,
    outputCostPerMTokCents: 160,
  },
  {
    id: "o3-mini",
    label: "o3-mini",
    provider: "openai",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "PROVIDER_REPORTED" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
      { kind: "REASONING", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 200_000,
    inputCostPerMTokCents: 110,
    outputCostPerMTokCents: 440,
  },

  // ── Anthropic ─────────────────────────────────────────────────────────────
  {
    id: "claude-3-5-sonnet-20241022",
    label: "Claude 3.5 Sonnet",
    provider: "anthropic",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      // The app's Anthropic adapter uses the grounded single-shot path; native
      // tool calling is not wired, so TOOLS stays UNKNOWN here rather than
      // claiming a capability the adapter cannot actually exercise.
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Adapter uses the no-tools grounded path" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 200_000,
    inputCostPerMTokCents: 300,
    outputCostPerMTokCents: 1500,
  },
  {
    id: "claude-3-5-haiku-20241022",
    label: "Claude 3.5 Haiku",
    provider: "anthropic",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Adapter uses the no-tools grounded path" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 200_000,
    inputCostPerMTokCents: 80,
    outputCostPerMTokCents: 400,
  },
  {
    id: "claude-3-opus-20240229",
    label: "Claude 3 Opus",
    provider: "anthropic",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Adapter uses the no-tools grounded path" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 200_000,
    inputCostPerMTokCents: 1500,
    outputCostPerMTokCents: 7500,
  },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "gemini",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Adapter uses the no-tools grounded path" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 1_000_000,
    inputCostPerMTokCents: 10,
    outputCostPerMTokCents: 40,
  },
  {
    id: "gemini-2.0-flash-lite",
    label: "Gemini 2.0 Flash Lite",
    provider: "gemini",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Adapter uses the no-tools grounded path" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 1_000_000,
    inputCostPerMTokCents: 8,
    outputCostPerMTokCents: 30,
  },
  {
    id: "gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    provider: "gemini",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Adapter uses the no-tools grounded path" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
      { kind: "LONG_CONTEXT", evidence: "PROVIDER_REPORTED" },
    ],
    contextTokens: 2_000_000,
    inputCostPerMTokCents: 125,
    outputCostPerMTokCents: 500,
  },

  // ── OpenRouter (routed ids; pricing varies by upstream, so it is unknown) ──
  {
    id: "openrouter/free",
    label: "OpenRouter free router",
    provider: "openrouter",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "STRUCTURED_OUTPUT", evidence: "UNKNOWN" },
      // Free routed models frequently decline tools; do not claim it.
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Free routes often reject tool calls" },
    ],
    inputCostPerMTokCents: 0,
    outputCostPerMTokCents: 0,
  },
  {
    id: "openai/gpt-4o",
    label: "OpenAI GPT-4o",
    provider: "openrouter",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "PROVIDER_REPORTED" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    inputCostPerMTokCents: 250,
    outputCostPerMTokCents: 1000,
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    label: "Anthropic Claude 3.5 Sonnet",
    provider: "openrouter",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "PROVIDER_REPORTED" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    inputCostPerMTokCents: 300,
    outputCostPerMTokCents: 1500,
  },
  {
    id: "google/gemini-2.0-flash-001",
    label: "Google Gemini 2.0 Flash",
    provider: "openrouter",
    capabilities: [
      { kind: "TEXT", evidence: "PROVIDER_REPORTED" },
      { kind: "VISION", evidence: "PROVIDER_REPORTED" },
      { kind: "TOOLS", evidence: "PROVIDER_REPORTED" },
      { kind: "STRUCTURED_OUTPUT", evidence: "PROVIDER_REPORTED" },
    ],
    inputCostPerMTokCents: 10,
    outputCostPerMTokCents: 40,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    label: "Meta Llama 3.3 70B",
    provider: "openrouter",
    capabilities: textOnly("Text model"),
    inputCostPerMTokCents: 12,
    outputCostPerMTokCents: 30,
  },

  // ── Ollama (local) ────────────────────────────────────────────────────────
  {
    id: "llama3.2",
    label: "Llama 3.2",
    provider: "ollama",
    capabilities: [
      { kind: "TEXT", evidence: "USER_CONFIGURED", note: "Local Ollama model" },
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Depends on the pulled model" },
    ],
    inputCostPerMTokCents: 0,
    outputCostPerMTokCents: 0,
  },
  {
    id: "llama3.1",
    label: "Llama 3.1",
    provider: "ollama",
    capabilities: [
      { kind: "TEXT", evidence: "USER_CONFIGURED", note: "Local Ollama model" },
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Depends on the pulled model" },
    ],
    inputCostPerMTokCents: 0,
    outputCostPerMTokCents: 0,
  },
  {
    id: "qwen2.5",
    label: "Qwen 2.5",
    provider: "ollama",
    capabilities: [
      { kind: "TEXT", evidence: "USER_CONFIGURED", note: "Local Ollama model" },
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Depends on the pulled model" },
    ],
    inputCostPerMTokCents: 0,
    outputCostPerMTokCents: 0,
  },
  {
    id: "mistral",
    label: "Mistral",
    provider: "ollama",
    capabilities: [
      { kind: "TEXT", evidence: "USER_CONFIGURED", note: "Local Ollama model" },
      { kind: "TOOLS", evidence: "UNKNOWN", note: "Depends on the pulled model" },
    ],
    inputCostPerMTokCents: 0,
    outputCostPerMTokCents: 0,
  },

  // ── Custom endpoint (unknown by nature) ───────────────────────────────────
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "custom",
    capabilities: [
      { kind: "TEXT", evidence: "USER_CONFIGURED", note: "Custom endpoint; assume text only" },
    ],
    inputCostPerMTokCents: null,
    outputCostPerMTokCents: null,
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "custom",
    capabilities: [
      { kind: "TEXT", evidence: "USER_CONFIGURED", note: "Custom endpoint; assume text only" },
    ],
    inputCostPerMTokCents: null,
    outputCostPerMTokCents: null,
  },
];

const BY_PROVIDER = new Map<AiProviderName, CatalogModel[]>();
for (const model of CATALOG) {
  const bucket = BY_PROVIDER.get(model.provider) ?? [];
  bucket.push(model);
  BY_PROVIDER.set(model.provider, bucket);
}

const BY_KEY = new Map<string, CatalogModel>();
for (const model of CATALOG) {
  BY_KEY.set(`${model.provider}:${model.id}`, model);
}

export function catalogForProvider(provider: AiProviderName): CatalogModel[] {
  return BY_PROVIDER.get(provider) ?? [];
}

export function lookupCatalogModel(
  provider: AiProviderName,
  model: string,
): CatalogModel | undefined {
  return BY_KEY.get(`${provider}:${model}`);
}

/**
 * The evidence for one capability of a model. A model that is not in the catalog
 * reports UNKNOWN for everything — which callers must treat as "not proven",
 * never as supported.
 */
export function capabilityEvidence(
  provider: AiProviderName,
  model: string,
  kind: CapabilityKind,
): ModelCapabilityClaim {
  const entry = lookupCatalogModel(provider, model);
  const claim = entry?.capabilities.find((c) => c.kind === kind);
  return claim ?? { kind, evidence: "UNKNOWN" };
}

/** Whether the catalog says this model can do `kind`, with trusted evidence. */
export function catalogSupports(
  provider: AiProviderName,
  model: string,
  kind: CapabilityKind,
): boolean {
  return isCapabilityTrusted(capabilityEvidence(provider, model, kind).evidence);
}

/**
 * Cost estimate in US cents for a turn, from the static catalog. Returns null
 * when pricing is unknown, so a spend ceiling never treats unknown pricing as
 * free.
 */
export function estimateCostCents(
  provider: AiProviderName,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const entry = lookupCatalogModel(provider, model);
  if (!entry || entry.inputCostPerMTokCents === null || entry.outputCostPerMTokCents === null) {
    return null;
  }
  const cost =
    (promptTokens / 1_000_000) * entry.inputCostPerMTokCents +
    (completionTokens / 1_000_000) * entry.outputCostPerMTokCents;
  return Math.round(cost);
}

/** Whether the catalog marks this model as free (zero cost on both sides). */
export function catalogIsFree(provider: AiProviderName, model: string): boolean {
  const entry = lookupCatalogModel(provider, model);
  return Boolean(
    entry && entry.inputCostPerMTokCents === 0 && entry.outputCostPerMTokCents === 0,
  );
}
