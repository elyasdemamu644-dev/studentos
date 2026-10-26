import { AiProviderName } from "@/services/ai/provider";
import {
  CAPABILITY_KINDS,
  catalogForProvider,
  lookupCatalogModel,
  capabilityEvidence,
  isCapabilityTrusted,
  type CapabilityKind,
  type EvidenceLevel,
} from "./capability-catalog";
import { listCapabilityOverrides } from "./policy-repository";
import { resolveCapabilityEvidence } from "./engine";

// ─────────────────────────────────────────────────────────────────────────────
// Effective catalog view (for the settings UI)
// ─────────────────────────────────────────────────────────────────────────────
//
// The UI must be able to show, honestly, what a model is known to do and *how*
// we know it. This merges the static catalog with the student's own capability
// assertions, keeps the stronger evidence, and marks whether each capability is
// trusted (usable to gate a request) or merely claimed.

export interface CatalogCapabilityView {
  kind: CapabilityKind;
  evidence: EvidenceLevel;
  /** True only for VERIFIED / PROVIDER_REPORTED — safe to gate a turn on. */
  trusted: boolean;
  note?: string;
}

export interface CatalogModelView {
  provider: AiProviderName;
  id: string;
  label: string;
  capabilities: CatalogCapabilityView[];
  contextTokens: number | null;
  inputCostPerMTokCents: number | null;
  outputCostPerMTokCents: number | null;
  free: boolean;
}

export interface CatalogProviderView {
  provider: AiProviderName;
  models: CatalogModelView[];
}

const PROVIDERS: AiProviderName[] = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "ollama",
  "custom",
];

function capabilitiesFor(
  provider: AiProviderName,
  model: string,
  overrides: Array<{ provider: string; model: string; kind: string; evidence: string; note: string | null }>,
): CatalogCapabilityView[] {
  return CAPABILITY_KINDS.map((kind) => {
    const catalogClaim = capabilityEvidence(provider, model, kind);
    const evidence = resolveCapabilityEvidence(provider, model, kind, overrides);
    const override = overrides.find(
      (o) => o.provider === provider && o.model === model && o.kind === kind,
    );
    return {
      kind,
      evidence,
      trusted: isCapabilityTrusted(evidence),
      // Prefer the override's note when the override is what raised the claim.
      note: override?.note ?? catalogClaim.note,
    };
  });
}

/** The full catalog for a user, with their overrides merged in. */
export async function describeEffectiveCatalog(
  userId: string,
): Promise<CatalogProviderView[]> {
  const overrides = await listCapabilityOverrides(userId);
  return PROVIDERS.map((provider) => ({
    provider,
    models: catalogForProvider(provider).map((entry) => ({
      provider,
      id: entry.id,
      label: entry.label,
      capabilities: capabilitiesFor(provider, entry.id, overrides),
      contextTokens: entry.contextTokens ?? null,
      inputCostPerMTokCents: entry.inputCostPerMTokCents,
      outputCostPerMTokCents: entry.outputCostPerMTokCents,
      free:
        entry.inputCostPerMTokCents === 0 && entry.outputCostPerMTokCents === 0,
    })),
  }));
}

/** Capabilities of one model, merged with the user's overrides (own path). */
export async function describeModelForUser(
  userId: string,
  provider: AiProviderName,
  model: string,
): Promise<CatalogModelView | null> {
  const entry = lookupCatalogModel(provider, model);
  if (!entry) return null;
  const overrides = await listCapabilityOverrides(userId);
  return {
    provider,
    id: entry.id,
    label: entry.label,
    capabilities: capabilitiesFor(provider, entry.id, overrides),
    contextTokens: entry.contextTokens ?? null,
    inputCostPerMTokCents: entry.inputCostPerMTokCents,
    outputCostPerMTokCents: entry.outputCostPerMTokCents,
    free: entry.inputCostPerMTokCents === 0 && entry.outputCostPerMTokCents === 0,
  };
}
