import { prisma } from "@/utils/prisma";
import { config } from "@/config";
import { decryptForUser, CredentialDecryptionError } from "@/utils/encryption";
import {
  AiProvider,
  AiProviderNotConfiguredError,
  AiConnectionUnreadableError,
  buildDefaultAiProvider,
  defaultEndpointFor,
  parseProviderCredentials,
  resolveAiProvider,
  resolveModel,
  type AiProviderName,
} from "@/services/ai/provider";
import {
  catalogSupports,
  catalogIsFree,
  lookupCatalogModel,
  strongerEvidence,
  isCapabilityTrusted,
  capabilityEvidence,
  type CapabilityKind,
  type EvidenceLevel,
} from "./capability-catalog";
import { getPolicy, listPreferences, listEffectivePreferences, listCapabilityOverrides } from "./policy-repository";
import { getWindowSpendCents } from "./telemetry";
import { checkPrivacy, isLocalDestination, type ExecutionDestination } from "./privacy";
import type { AiRoutingPolicy, AiModelPreference } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Unified routing engine
// ─────────────────────────────────────────────────────────────────────────────
//
// One place decides which provider+model answers any AI request, so no feature
// can bypass the policy. The precedence is fixed and explicit:
//
//   1. A per-conversation override (saved preference) — if present, it wins.
//   2. The feature's own default (e.g. the structured/vision requirement).
//   3. The user's global default (FIXED pinned model, or the AUTO allow-list).
//   4. AUTO selection, and only when the policy says Auto may run at all
//      (`allowAutoFallback`). When Auto is not permitted and no candidate is
//      authorised, this returns an *unavailable* decision — it never silently
//      substitutes a different model.
//
// A `RoutingDecision` is always transparent: it names the candidate chosen, why
// it was chosen, and every candidate it rejected with a reason the UI can show.

export interface RoutingCandidate {
  provider: AiProviderName;
  model: string;
  connectionId: string | null;
  /** True when this candidate is the deployment-default provider. */
  isDefault: boolean;
  endpoint: string | null;
  /**
   * Built lazily so a rejected candidate never decrypts credentials.
   *
   * `modelOverride` asks for a different model on the same connection. A
   * connection saved with one model can serve another of the same provider, so
   * a model the student pinned for one conversation does not have to be the one
   * the connection was created with.
   */
  build: (modelOverride?: string) => AiProvider;
}

export interface RejectedCandidate {
  provider: string;
  model: string | null;
  reason: string;
}

export type RoutingReason =
  | "conversation-override"
  | "fixed"
  | "feature-default"
  | "auto-selected"
  | "fallback";

/**
 * Which policy rule made a decision unavailable. The caller needs this to
 * answer with the *right* refusal: a privacy block is a 403 the student can
 * fix by choosing a local model, not a generic "no provider configured".
 */
export type RoutingBlock = "privacy" | "budget" | "allow_deny" | "free_only" | "capability";

export interface RoutingDecision {
  available: boolean;
  provider: AiProviderName | null;
  model: string | null;
  connectionId: string | null;
  isDefault: boolean;
  reason: RoutingReason | null;
  /** Plain, user-safe sentence describing what was chosen and why. */
  explanation: string;
  rejected: RejectedCandidate[];
  strategy: AiRoutingPolicy["strategy"];
  /** Set when the decision is unavailable because a policy rule blocked it. */
  blockedBy: RoutingBlock | null;
}

/** What a caller needs from a turn, used to filter candidates. */
export interface RoutingRequirements {
  /** A capability the chosen model must have trusted evidence for. */
  requires?: CapabilityKind;
  /** Named feature, recorded on usage rows and used in error messages. */
  feature: string;
  /** Optional per-conversation override, resolved by the caller. */
  conversationId?: string | null;
}

const CLOSED_STRATEGY_EXPLANATION =
  "No model is available under your current routing rules, and automatic " +
  "selection is turned off. Choose a model in Settings, or allow Auto to pick one.";

// ── Candidate construction ──────────────────────────────────────────────────

/**
 * Whether a model supports a capability, merging the static catalog with the
 * student's own assertions. A user's claim can *raise* evidence up to
 * USER_CONFIGURED, and a VERIFIED claim from an earlier exercise counts, but a
 * user assertion never downgrades catalog evidence and never fabricates
 * trust we did not have — so the gate uses the stronger of the two.
 */
export function resolveCapabilityEvidence(
  provider: AiProviderName,
  model: string,
  kind: CapabilityKind,
  overrides: Array<{ provider: string; model: string; kind: string; evidence: string }>,
): EvidenceLevel {
  const base = capabilityEvidence(provider, model, kind).evidence;
  const override = overrides.find(
    (o) => o.provider === provider && o.model === model && o.kind === kind,
  );
  if (!override) return base;
  return strongerEvidence(base, override.evidence as EvidenceLevel);
}

/**
 * Every connection this user could route to, plus the deployment default. A
 * connection that cannot be decrypted is rejected here (never silently dropped:
 * the caller sees why), because acting on it would fail deeper in the turn.
 */
async function buildCandidates(userId: string): Promise<{
  candidates: RoutingCandidate[];
  rejected: RejectedCandidate[];
}> {
  const candidates: RoutingCandidate[] = [];
  const rejected: RejectedCandidate[] = [];

  const rows = await prisma.aiConnection.findMany({
    where: { userId, enabled: true },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });

  for (const row of rows) {
    const provider = row.provider as AiProviderName;
    let decrypted: string;
    try {
      decrypted = decryptForUser(userId, row.credentialsEncrypted);
    } catch (error) {
      if (error instanceof CredentialDecryptionError) {
        rejected.push({
          provider,
          model: row.model,
          reason: "Stored credentials could not be read for this connection.",
        });
        continue;
      }
      throw error;
    }
    const credentials = parseProviderCredentials(decrypted);
    const model = resolveModel(provider, row.model);
    candidates.push({
      provider,
      model,
      connectionId: row.id,
      isDefault: false,
      endpoint: row.endpoint,
      build: (modelOverride) =>
        new AiProvider(
          resolveAiProvider(provider),
          credentials,
          row.endpoint ?? undefined,
          modelOverride ?? row.model ?? undefined,
        ),
    });
  }

  const defaultProvider = buildDefaultAiProvider(config);
  if (defaultProvider) {
    candidates.push({
      provider: defaultProvider.providerName,
      model: defaultProvider.model,
      connectionId: null,
      isDefault: true,
      // The default provider's real endpoint, so the privacy gate classifies it
      // by where it actually posts: a local Ollama default stays available when
      // external processing is disabled, a hosted one does not.
      endpoint: defaultEndpointFor(defaultProvider.providerName, config) ?? null,
      build: (modelOverride) =>
        modelOverride
          ? (buildDefaultAiProvider(config, modelOverride) ?? defaultProvider)
          : defaultProvider,
    });
  } else {
    rejected.push({
      provider: config.aiProvider,
      model: null,
      reason: "Tutor Walle Default AI is not configured on this server.",
    });
  }

  return { candidates, rejected };
}

// ── Policy application ──────────────────────────────────────────────────────

/**
 * A preset is a starting preference that nudges ordering when no explicit
 * priority is set. It never overrides an explicit priority or fallback order, so
 * a student who pins a model always wins over the preset's opinion.
 */
function presetRank(provider: AiProviderName, model: string, preset: string | null): number {
  if (!preset) return 0;
  const entry = lookupCatalogModel(provider, model);
  if (!entry) return 0;
  const { inputCostPerMTokCents, outputCostPerMTokCents, contextTokens } = entry;
  const hasTools = catalogSupports(provider, model, "TOOLS");
  const hasReasoning = catalogSupports(provider, model, "REASONING");
  const isFree = catalogIsFree(provider, model);
  const cost = (inputCostPerMTokCents ?? Number.MAX_SAFE_INTEGER) + (outputCostPerMTokCents ?? Number.MAX_SAFE_INTEGER);

  switch (preset) {
    case "quality":
      return (hasReasoning ? 0 : 1000) + (hasTools ? 0 : 500) - contextTokens! / 1_000_000;
    case "speed":
      // Prefer smaller/faster model families.
      return cost / 100 + (/mini|flash|haiku|lite|3\.2|1\b/.test(model) ? -50 : 0);
    case "cost":
      return cost;
    case "local-first":
      return entry.provider === "ollama" ? -10_000 : cost;
    case "balanced":
    default:
      return (hasTools ? 0 : 100) + cost / 10;
  }
}

/**
 * Index the preferences by provider+model.
 *
 * A per-conversation row always wins over a global row for the same model, so
 * an override pinned inside one chat is what that chat uses — and a global row
 * can never be silently redefined by the order the rows happened to be read in.
 */
function preferenceIndex(prefs: AiModelPreference[]): Map<string, AiModelPreference> {
  const index = new Map<string, AiModelPreference>();
  const ordered = [...prefs].sort(
    (a, b) => scopeRank(a) - scopeRank(b),
  );
  for (const pref of ordered) {
    index.set(`${pref.provider}:${pref.model}`, pref);
  }
  return index;
}

/** Global rows are applied first, conversation rows last (so they win). */
function scopeRank(pref: AiModelPreference): number {
  return pref.scope === "CONVERSATION" ? 1 : 0;
}

/**
 * The policy rules that decide whether a candidate may run at all.
 *
 * These are the *hard* rules: an explicit deny, the privacy switch and the
 * spend ceiling. They apply to every strategy — a pinned model, a
 * per-conversation override and automatic selection alike — because each of
 * them is something the student (or their budget) said must not be bypassed.
 * The only rule that is *not* universal is free-only, which by its own
 * description restricts automatic selection.
 *
 * Every rejection is returned with the reason, so the UI can explain exactly
 * which rule removed which model.
 */
export function applyPolicyFilters(
  candidates: RoutingCandidate[],
  policy: AiRoutingPolicy,
  prefs: AiModelPreference[],
  windowSpendCents: number,
  options: { freeOnly: boolean },
): { allowed: RoutingCandidate[]; rejected: RejectedCandidate[]; blockedBy: RoutingBlock | null } {
  const rejected: RejectedCandidate[] = [];
  const blocked = new Set<RoutingBlock>();
  const prefByKey = preferenceIndex(prefs);

  let pool = candidates;

  // Allow/deny: an explicit `allowed: false` row removes a model outright.
  pool = pool.filter((candidate) => {
    const pref = prefByKey.get(`${candidate.provider}:${candidate.model}`);
    if (pref && !pref.allowed) {
      blocked.add("allow_deny");
      rejected.push({
        provider: candidate.provider,
        model: candidate.model,
        reason: "Excluded by your allow/deny preferences.",
      });
      return false;
    }
    return true;
  });

  // Privacy: an external destination is removed when external processing is off.
  if (policy.externalProcessingDisabled) {
    pool = pool.filter((candidate) => {
      const destination: ExecutionDestination = { provider: candidate.provider, endpoint: candidate.endpoint };
      const decision = checkPrivacy(destination, true);
      if (!decision.allowed) {
        blocked.add("privacy");
        rejected.push({
          provider: candidate.provider,
          model: candidate.model,
          reason: decision.reason ?? "Blocked by the privacy policy.",
        });
      }
      return decision.allowed;
    });
  }

  // Spend ceiling: once the rolling window has reached the ceiling, only free
  // models remain eligible. A paid model is never selected past the cap - the
  // student is shown the unavailable state instead.
  if (policy.spendCeilingCents !== null && windowSpendCents >= policy.spendCeilingCents) {
    pool = pool.filter((candidate) => {
      const free = catalogIsFree(candidate.provider, candidate.model);
      if (!free) {
        blocked.add("budget");
        rejected.push({
          provider: candidate.provider,
          model: candidate.model,
          reason: "Excluded because the spend ceiling for this window has been reached.",
        });
      }
      return free;
    });
  }

  // Free-only: only models the catalog marks free (zero cost on both sides).
  if (options.freeOnly) {
    pool = pool.filter((candidate) => {
      const free = catalogIsFree(candidate.provider, candidate.model);
      if (!free) {
        blocked.add("free_only");
        rejected.push({
          provider: candidate.provider,
          model: candidate.model,
          reason: "Excluded because free-only routing is on.",
        });
      }
      return free;
    });
  }

  // When everything was filtered out, the *hardest* rule explains it best: a
  // privacy refusal matters more than a free-only preference.
  const blockedBy: RoutingBlock | null =
    blocked.has("privacy")
      ? "privacy"
      : blocked.has("budget")
        ? "budget"
        : blocked.has("allow_deny")
          ? "allow_deny"
          : blocked.has("free_only")
            ? "free_only"
            : null;

  return { allowed: pool, rejected, blockedBy };
}

/**
 * Order the surviving candidates by the policy. AUTO orders by explicit
 * fallback order, then explicit priority, then preset, then free/secrets/
 * default tie-breakers.
 */
function orderCandidates(
  pool: RoutingCandidate[],
  policy: AiRoutingPolicy,
  prefs: AiModelPreference[],
): RoutingCandidate[] {
  const prefByKey = preferenceIndex(prefs);

  const fallbackIndex = new Map<string, number>();
  policy.fallbackOrder.forEach((id, index) => fallbackIndex.set(id, index));

  const priorityOf = (candidate: RoutingCandidate): number => {
    const pref = prefByKey.get(`${candidate.provider}:${candidate.model}`);
    if (pref?.priority !== null && pref?.priority !== undefined) return pref.priority;
    return Number.MAX_SAFE_INTEGER;
  };

  return [...pool].sort((a, b) => {
    // 1. Explicit connection fallback order wins.
    const aFallback = a.connectionId ? fallbackIndex.get(a.connectionId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const bFallback = b.connectionId ? fallbackIndex.get(b.connectionId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    if (aFallback !== bFallback) return aFallback - bFallback;
    // 2. Explicit per-model priority.
    const aPriority = priorityOf(a);
    const bPriority = priorityOf(b);
    if (aPriority !== bPriority) return aPriority - bPriority;
    // 3. The policy preset, when no explicit priority was set.
    if (aPriority === Number.MAX_SAFE_INTEGER && bPriority === Number.MAX_SAFE_INTEGER) {
      const aPreset = presetRank(a.provider, a.model, policy.preset);
      const bPreset = presetRank(b.provider, b.model, policy.preset);
      if (aPreset !== bPreset) return aPreset - bPreset;
    }
    // 4. A free model before a paid one, all else equal.
    const aFree = catalogIsFree(a.provider, a.model);
    const bFree = catalogIsFree(b.provider, b.model);
    if (aFree !== bFree) return aFree ? -1 : 1;
    // 5. The user's active connection first, then the deployment default.
    if (a.isDefault !== b.isDefault) return a.isDefault ? 1 : -1;
    return 0;
  });
}

/**
 * Apply a fixed model to the pool. Returns null for the chosen candidate when
 * the pinned model is not among the usable candidates — a fixed choice is never
 * silently swapped for another model.
 */
function applyFixed(
  candidates: RoutingCandidate[],
  policy: AiRoutingPolicy,
): { chosen: RoutingCandidate | null; rejected: RejectedCandidate[] } {
  const rejected: RejectedCandidate[] = [];
  const match = candidates.find((candidate) => {
    const connectionMatches =
      !policy.fixedConnectionId || candidate.connectionId === policy.fixedConnectionId;
    const modelMatches = !policy.fixedModel || candidate.model === policy.fixedModel;
    return connectionMatches && modelMatches;
  });
  if (!match) {
    rejected.push({
      provider: policy.fixedModel ? "fixed" : (candidates[0]?.provider ?? "unknown"),
      model: policy.fixedModel,
      reason: "Your pinned model is unavailable or excluded by policy.",
    });
  }
  return { chosen: match ?? null, rejected };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * A candidate the policy has authorised for this request.
 *
 * The provider is built lazily: a candidate that is never tried must never
 * have its credentials decrypted.
 */
export interface AuthorizedCandidate {
  provider: AiProviderName;
  model: string;
  connectionId: string | null;
  isDefault: boolean;
  build: () => AiProvider;
}

function toAuthorized(candidate: RoutingCandidate): AuthorizedCandidate {
  return {
    provider: candidate.provider,
    model: candidate.model,
    connectionId: candidate.connectionId,
    isDefault: candidate.isDefault,
    build: () => {
      const provider = candidate.build(candidate.model);
      // Carry the routing metadata on the provider so usage and health rows
      // can point at the connection that actually served the turn.
      provider.setConnectionId(candidate.connectionId);
      return provider;
    },
  };
}

/**
 * The same connection, asked for a different model.
 *
 * The candidate keeps its provider, endpoint and connection — only the model
 * changes — so every rule that depends on where the request is sent (privacy)
 * or what it costs (spend ceiling) is still evaluated against the connection
 * that will actually serve it.
 */
function withModel(candidate: RoutingCandidate, model: string): RoutingCandidate {
  if (candidate.model === model) return candidate;
  return {
    ...candidate,
    model,
    build: (modelOverride) => candidate.build(modelOverride ?? model),
  };
}

/**
 * Resolve which provider+model answers a request, and which authorised
 * candidates may be tried if that one fails.
 *
 * Never throws for a merely unavailable choice — it returns `available: false`
 * so the caller can surface an honest unavailable state and offer a
 * reassignment, rather than substituting a model the student did not
 * authorise.
 *
 * The candidate list is the *fallback order*, not a licence to substitute: it
 * only ever contains candidates the policy already approved, and it is empty
 * whenever the student's policy forbids automatic selection.
 */
export async function resolveAuthorizedCandidates(
  userId: string,
  requirements: RoutingRequirements,
): Promise<{ decision: RoutingDecision; candidates: AuthorizedCandidate[] }> {
  const policy = await getPolicy(userId);

  const { candidates, rejected: buildRejected } = await buildCandidates(userId);

  const rejected: RejectedCandidate[] = [...buildRejected];

  // Capability filter: a requirement with no trusted support removes a model,
  // so an image is never sent to a model we cannot vouch has vision. User
  // overrides are merged so a capability the student verified counts too.
  const overrides = requirements.requires ? await listCapabilityOverrides(userId) : [];
  const capable = requirements.requires
    ? candidates.filter((candidate) => {
        const evidence = resolveCapabilityEvidence(
          candidate.provider,
          candidate.model,
          requirements.requires!,
          overrides,
        );
        const ok = isCapabilityTrusted(evidence);
        if (!ok) {
          rejected.push({
            provider: candidate.provider,
            model: candidate.model,
            reason: `This request needs ${requirements.requires} support, which is not verified for this model.`,
          });
        }
        return ok;
      })
    : candidates;

  // The preferences that apply to *this* request, and the spend already made
  // in the policy's window. The spend is only read when a ceiling exists.
  const [prefs, windowSpendCents] = await Promise.all([
    listEffectivePreferences(userId, requirements.conversationId ?? null),
    policy.spendCeilingCents !== null
      ? getWindowSpendCents(userId, policy.spendWindowDays)
      : Promise.resolve(0),
  ]);

  // Precedence step 1: a per-conversation override wins over everything else,
  // as long as its model is still a usable candidate under policy. A stale
  // override (connection removed, model no longer offered) falls through to the
  // normal paths rather than quoting a model that cannot run.
  if (requirements.conversationId) {
    const convoPrefs = await listPreferences(userId, requirements.conversationId);
    const override = convoPrefs.find((pref) => pref.scope === "CONVERSATION" && pref.allowed);
    if (override) {
      // The pinned model is served on the connection that can run it. A
      // connection saved with one model can serve another of the same provider,
      // so pinning a model inside a chat does not require the chat's
      // connection to have been created with exactly that model.
      const exact = capable.find(
        (candidate) =>
          candidate.provider === override.provider &&
          candidate.model === override.model &&
          (!override.connectionId || candidate.connectionId === override.connectionId),
      );
      const sameProvider =
        exact ??
        capable.find(
          (candidate) =>
            candidate.provider === override.provider &&
            (!override.connectionId || candidate.connectionId === override.connectionId),
        );
      const match = sameProvider ? withModel(sameProvider, override.model) : null;
      if (match) {
        // The capability gate is about the model that will answer, so it is
        // checked against the pinned model — not against the model the
        // connection happens to be saved with.
        if (requirements.requires) {
          const evidence = resolveCapabilityEvidence(
            match.provider,
            match.model,
            requirements.requires,
            overrides,
          );
          if (!isCapabilityTrusted(evidence)) {
            rejected.push({
              provider: match.provider,
              model: match.model,
              reason: `This request needs ${requirements.requires} support, which is not verified for this model.`,
            });
            return {
              decision: unavailableDecision({
                policy,
                rejected,
                blockedBy: "capability",
                explanation: blockedExplanation("capability", match.model),
              }),
              candidates: [],
            };
          }
        }
        // An explicit choice is still subject to the hard rules: an explicit
        // deny, the privacy switch and the spend ceiling. It is *not* subject
        // to free-only, which only restricts automatic selection.
        const filtered = applyPolicyFilters([match], policy, prefs, windowSpendCents, {
          freeOnly: false,
        });
        rejected.push(...filtered.rejected);
        if (filtered.allowed.length > 0) {
          return {
            decision: {
              available: true,
              provider: match.provider,
              model: match.model,
              connectionId: match.connectionId,
              isDefault: match.isDefault,
              reason: "conversation-override",
              explanation: `Using the model saved for this conversation (${match.model}).`,
              rejected,
              strategy: policy.strategy,
              blockedBy: null,
            },
            // An explicitly pinned model is never swapped for another one.
            candidates: [toAuthorized(match)],
          };
        }
        return {
          decision: unavailableDecision({
            policy,
            rejected,
            blockedBy: filtered.blockedBy,
            explanation: blockedExplanation(filtered.blockedBy, match.model),
          }),
          candidates: [],
        };
      }
      rejected.push({
        provider: override.provider,
        model: override.model,
        reason: "The model saved for this conversation is no longer available.",
      });
    }
  }

  // Precedence step 2+3: a FIXED policy pins the answer.
  if (policy.strategy === "FIXED") {
    // The pinned model still has to pass the hard rules — privacy and the spend
    // ceiling are not bypassed by pinning — but free-only does not apply: the
    // student chose this model explicitly.
    const filtered = applyPolicyFilters(capable, policy, prefs, windowSpendCents, {
      freeOnly: false,
    });
    rejected.push(...filtered.rejected);

    const { chosen, rejected: fixedRejected } = applyFixed(filtered.allowed, policy);
    rejected.push(...fixedRejected);
    if (!chosen) {
      return {
        decision: unavailableDecision({
          policy,
          rejected,
          blockedBy: filtered.blockedBy,
          explanation: policy.fixedModel
            ? `Your pinned model "${policy.fixedModel}" is not available right now.`
            : "No model is pinned yet. Choose one in Settings.",
        }),
        candidates: [],
      };
    }
    return {
      decision: {
        available: true,
        provider: chosen.provider,
        model: chosen.model,
        connectionId: chosen.connectionId,
        isDefault: chosen.isDefault,
        reason: "fixed",
        explanation: `Using your fixed model ${chosen.model}.`,
        rejected,
        strategy: policy.strategy,
        blockedBy: null,
      },
      // A pinned model is never swapped for another one.
      candidates: [toAuthorized(chosen)],
    };
  }

  // Precedence step 4: AUTO. Free-only applies here — it restricts automatic
  // selection, which is exactly what this strategy is.
  const filtered = applyPolicyFilters(capable, policy, prefs, windowSpendCents, {
    freeOnly: policy.freeOnly,
  });
  rejected.push(...filtered.rejected);

  const ordered = orderCandidates(filtered.allowed, policy, prefs);

  if (ordered.length === 0) {
    // No silent substitution: report the unavailable state.
    return {
      decision: unavailableDecision({
        policy,
        rejected,
        blockedBy: filtered.blockedBy,
        explanation: policy.allowAutoFallback
          ? "No model is available under your current routing rules."
          : CLOSED_STRATEGY_EXPLANATION,
      }),
      candidates: [],
    };
  }

  // AUTO may only choose when the policy permits it. When it may not and there
  // is no explicit global default, report unavailable rather than substitute.
  const explicitDefault = ordered.find(
    (candidate) => prefs.some((p) => p.provider === candidate.provider && p.model === candidate.model && p.allowed),
  );

  if (!explicitDefault && !policy.allowAutoFallback) {
    return {
      decision: unavailableDecision({
        policy,
        rejected,
        blockedBy: filtered.blockedBy,
        explanation: CLOSED_STRATEGY_EXPLANATION,
      }),
      candidates: [],
    };
  }

  const chosen = explicitDefault ?? ordered[0];
  // The fallback order: the chosen model first, then the other authorised
  // candidates. Automatic fallback only exists when the policy allows it.
  const fallbackOrder = policy.allowAutoFallback
    ? [chosen, ...ordered.filter((c) => c !== chosen)]
    : [chosen];

  return {
    decision: {
      available: true,
      provider: chosen.provider,
      model: chosen.model,
      connectionId: chosen.connectionId,
      isDefault: chosen.isDefault,
      reason: explicitDefault ? "feature-default" : "auto-selected",
      explanation: explicitDefault
        ? `Using your preferred model ${chosen.model}.`
        : `Auto selected ${chosen.model} for this request.`,
      rejected,
      strategy: policy.strategy,
      blockedBy: null,
    },
    candidates: fallbackOrder.map(toAuthorized),
  };
}

/** The unavailable decision, with the rule that caused it. */
function unavailableDecision(args: {
  policy: AiRoutingPolicy;
  rejected: RejectedCandidate[];
  blockedBy: RoutingBlock | null;
  explanation: string;
}): RoutingDecision {
  return {
    available: false,
    provider: null,
    model: null,
    connectionId: null,
    isDefault: false,
    reason: null,
    explanation: args.explanation,
    rejected: args.rejected,
    strategy: args.policy.strategy,
    blockedBy: args.blockedBy,
  };
}

/** A refusal that names the rule the student can actually change. */
function blockedExplanation(blockedBy: RoutingBlock | null, model?: string): string {
  switch (blockedBy) {
    case "privacy":
      return (
        "External processing is disabled, so this request cannot be sent to an external AI provider. " +
        "Enable a local (on-device or on-network) model, or turn external processing back on in Settings."
      );
    case "budget":
      return "The spend ceiling for this window has been reached, so paid models are not available.";
    case "allow_deny":
      return "That model is excluded by your allow/deny preferences.";
    case "free_only":
      return "Only free models are available under your current routing rules.";
    case "capability":
      return model
        ? `${model} cannot be used for this request.`
        : "No model can be used for this request.";
    default:
      return CLOSED_STRATEGY_EXPLANATION;
  }
}

/**
 * Resolve the provider+model for a request. Never throws for a merely
 * unavailable choice — it returns `available: false` so the caller can surface
 * an honest unavailable state and offer a reassignment, rather than substituting
 * a model the student did not authorise.
 */
export async function resolveRouting(
  userId: string,
  requirements: RoutingRequirements,
): Promise<RoutingDecision> {
  const { decision } = await resolveAuthorizedCandidates(userId, requirements);
  return decision;
}

/**
 * Build a live provider for an already-resolved decision. Rebuilds candidates
 * and matches the chosen one so credentials are decrypted exactly once, at the
 * moment of use. Throws the documented 503 when the chosen candidate vanished
 * between resolution and build (a connection edited mid-turn), rather than
 * quietly answering from a different model.
 */
export async function buildRoutedProvider(
  userId: string,
  decision: RoutingDecision,
): Promise<AiProvider> {
  const { candidates } = await buildCandidates(userId);
  // The decision's model can differ from the model the connection was saved
  // with — a model pinned for one conversation is served on the connection that
  // can run it — so the connection identifies the candidate and the decision's
  // model is what the provider is asked for.
  const candidate =
    candidates.find(
      (c) => c.provider === decision.provider && c.connectionId === decision.connectionId,
    ) ?? candidates.find((c) => c.provider === decision.provider && c.model === decision.model);
  if (!candidate) {
    throw new AiProviderNotConfiguredError(
      "The selected model is no longer available. Please choose another in Settings.",
    );
  }
  const provider = candidate.build(decision.model ?? undefined);
  // Carry the routing metadata on the provider so usage and health rows can
  // point at the connection that actually served the turn.
  provider.setConnectionId(candidate.connectionId);
  return provider;
}

/**
 * Resolve the routing decision and build the provider for it. Throws the
 * documented 503 when nothing is available, so every AI path reports the same
 * controlled error instead of inventing its own.
 */
export async function resolveRoutedProvider(
  userId: string,
  requirements: RoutingRequirements,
): Promise<{ provider: AiProvider; decision: RoutingDecision }> {
  const decision = await resolveRouting(userId, requirements);
  if (!decision.available) {
    throw new AiProviderNotConfiguredError(decision.explanation);
  }
  return { provider: await buildRoutedProvider(userId, decision), decision };
}

/** The human-readable capabilities of a model, for the settings UI. */
export function describeCapabilities(provider: AiProviderName, model: string): CapabilityKind[] {
  const kinds: CapabilityKind[] = ["TEXT", "VISION", "TOOLS", "STRUCTURED_OUTPUT", "LONG_CONTEXT", "REASONING"];
  return kinds.filter((kind) => catalogSupports(provider, model, kind));
}

export { AiConnectionUnreadableError, isLocalDestination };
