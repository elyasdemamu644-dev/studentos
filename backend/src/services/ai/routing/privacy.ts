import { prisma } from "@/utils/prisma";
import { AiProviderError } from "@/services/ai/provider";

// ─────────────────────────────────────────────────────────────────────────────
// Privacy enforcement
// ─────────────────────────────────────────────────────────────────────────────
//
// The directive is explicit: "external-processing-disabled" must be verified
// against the *actual execution destination*, not a UI hint, and there must be
// no external fallback, retry, attachment or tool path that could leak data
// off-box while the setting is on.
//
// This module is the single gate that answers "may this candidate be executed?"
// for a given privacy policy. It is deliberately a pure classification over the
// candidate's real properties, so the check cannot drift from what the router
// would actually do.

/**
 * A destination is local when the request never leaves the operator's own
 * network: a loopback/private-address endpoint (a local Ollama), or a custom
 * endpoint the deployment has explicitly classified as local.
 */
export interface ExecutionDestination {
  provider: string;
  /** The resolved endpoint the adapter would actually POST to, if any. */
  endpoint: string | null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Classify a destination as local or external by inspecting the endpoint the
 * adapter would really use. Providers with no endpoint are hostname-based
 * services (OpenAI, Gemini, …) and are always external.
 *
 * Private IPv4 ranges (10/8, 172.16/12, 192.168/16) and link-local (169.254/16)
 * count as local: a request to them stays inside the operator's network.
 */
export function isLocalDestination({ endpoint }: ExecutionDestination): boolean {
  if (!endpoint) return false;
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTS.has(host)) return true;
  // IPv6 loopback / unique-local
  if (host.startsWith("[") || host.includes(":")) {
    const bare = host.replace(/^\[|\]$/g, "");
    if (bare === "::1" || bare.startsWith("fe80:") || bare.startsWith("fc") || bare.startsWith("fd")) {
      return true;
    }
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export interface PrivacyDecision {
  allowed: boolean;
  /** Present when blocked: the reason, safe to surface to the student. */
  reason?: string;
}

/**
 * Decide whether a candidate may execute under a privacy policy. When external
 * processing is disabled, only a provably-local destination may run — and the
 * decision is made from the candidate's real endpoint, so a provider that
 * merely *looks* local in the UI but posts off-box is still blocked.
 */
export function checkPrivacy(
  destination: ExecutionDestination,
  externalProcessingDisabled: boolean,
): PrivacyDecision {
  if (!externalProcessingDisabled) return { allowed: true };
  if (isLocalDestination(destination)) return { allowed: true };
  return {
    allowed: false,
    reason:
      "External processing is disabled, so this request cannot be sent to an external AI provider. " +
      "Enable a local (on-device or on-network) model, or turn external processing back on in Settings.",
  };
}

/** Thrown when a turn is refused because it would leave the device. */
export class AiExternalProcessingBlockedError extends AiProviderError {
  constructor(message = "External processing is disabled for this account") {
    super(message, 403, "AI_EXTERNAL_PROCESSING_BLOCKED");
    this.name = "AiExternalProcessingBlockedError";
    Object.setPrototypeOf(this, AiExternalProcessingBlockedError.prototype);
  }
}

/**
 * Record a health/privacy audit of a blocked attempt. Kept best-effort and
 * non-throwing: a failure to audit must never mask the privacy refusal itself.
 */
export async function recordBlockedExternalAttempt(
  userId: string,
  provider: string,
  feature: string,
): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ai_provider_health (id, "userId", "connectionId", provider, status, message, code, "checkedAt")
       VALUES ($1, $2, $3, $4, 'UNHEALTHY', $5, $6, now())`,
      `prv_${Math.random().toString(36).slice(2)}`,
      userId,
      "",
      provider,
      `Blocked external attempt in feature '${feature}'`,
      "AI_EXTERNAL_PROCESSING_BLOCKED",
    );
  } catch {
    // Best-effort: never surface an audit-write failure to the caller.
  }
}
