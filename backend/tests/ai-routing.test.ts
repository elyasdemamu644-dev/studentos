import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The routing engine reads real connections + policy from the database, so the
// HTTP-independent tests below use the real DB. Only the credentials lookup is
// stubbed where a test needs an "active personal connection" without a live key.
vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

import { prisma, cleanupDb, registerAndLogin, authRequestJson } from "./helpers";
import { encryptForUser } from "@/utils/encryption";
import { resolveRouting } from "@/services/ai/routing/engine";
import { getPolicy, upsertPolicy, replacePreferences } from "@/services/ai/routing/policy-repository";
import {
  isLocalDestination,
  checkPrivacy,
} from "@/services/ai/routing/privacy";
import {
  withBoundedRetry,
  withAuthorizedFallback,
} from "@/services/ai/routing/retry";
import { AiProviderError, AiProviderCancelledError, resolveAiProviderForUser, type AiProvider } from "@/services/ai/provider";
import { CAPABILITY_KINDS, catalogSupports } from "@/services/ai/routing/capability-catalog";
import { prisma as prismaClient } from "@/utils/prisma";

const BASE = "/api/v1";

// ─────────────────────────────────────────────────────────────────────────────
// Unified routing — engine, privacy, retry
//
// The engine is the single choke point every AI feature shares, so these tests
// pin the invariants the directive calls out: fixed vs auto precedence, no
// silent substitution, capability gating with evidence, external-processing
// refusal by execution destination, free-only, spend ceiling, and side-effect-
// safe retry/fallback.
// ─────────────────────────────────────────────────────────────────────────────

async function makeConnection(
  userId: string,
  provider: string,
  model: string,
  opts: { active?: boolean; endpoint?: string | null } = {},
) {
  const creds = JSON.stringify({ apiKey: `sk-test-${provider}` });
  return prisma.aiConnection.create({
    data: {
      userId,
      provider,
      model,
      endpoint: opts.endpoint ?? null,
      credentialsEncrypted: encryptForUser(userId, creds),
      enabled: true,
      isActive: opts.active ?? false,
    },
  });
}

let userId: string;
let token: string;

beforeEach(async () => {
  await cleanupDb();
  const account = await registerAndLogin(`routing-${Date.now()}@test.com`, "TestPass123!");
  userId = account.user.id;
  token = account.token;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Privacy (pure) ───────────────────────────────────────────────────────────

describe("privacy — execution-destination classification", () => {
  it("treats loopback and private endpoints as local", () => {
    expect(isLocalDestination({ provider: "ollama", endpoint: "http://localhost:11434" })).toBe(true);
    expect(isLocalDestination({ provider: "ollama", endpoint: "http://127.0.0.1:11434" })).toBe(true);
    expect(isLocalDestination({ provider: "custom", endpoint: "http://192.168.1.50:8080/v1" })).toBe(true);
    expect(isLocalDestination({ provider: "custom", endpoint: "http://10.0.0.9:8000" })).toBe(true);
  });

  it("treats hostname-based providers and public endpoints as external", () => {
    expect(isLocalDestination({ provider: "openai", endpoint: null })).toBe(false);
    expect(isLocalDestination({ provider: "custom", endpoint: "https://api.example.com/v1" })).toBe(false);
    expect(isLocalDestination({ provider: "custom", endpoint: "http://8.8.8.8" })).toBe(false);
  });

  it("refuses an external destination when external processing is disabled", () => {
    const decision = checkPrivacy({ provider: "openai", endpoint: null }, true);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/external/i);
  });

  it("allows a local destination when external processing is disabled", () => {
    const decision = checkPrivacy({ provider: "ollama", endpoint: "http://localhost:11434" }, true);
    expect(decision.allowed).toBe(true);
  });

  it("allows everything when external processing is enabled", () => {
    expect(checkPrivacy({ provider: "openai", endpoint: null }, false).allowed).toBe(true);
  });
});

// ── Retry / fallback (pure) ──────────────────────────────────────────────────

describe("retry — bounded and side-effect safe", () => {
  it("retries a retryable (5xx) failure up to the cap", async () => {
    let calls = 0;
    const result = await withBoundedRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new AiProviderError("upstream 500", 500, "AI_PROVIDER_ERROR");
        return "ok";
      },
      { hasSideEffects: false, maxAttempts: 3 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry a 4xx schema fault", async () => {
    let calls = 0;
    await expect(
      withBoundedRetry(
        async () => {
          calls += 1;
          throw new AiProviderError("bad request", 400, "AI_PROVIDER_ERROR");
        },
        { hasSideEffects: false },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("never retries a cancelled request", async () => {
    let calls = 0;
    await expect(
      withBoundedRetry(
        async () => {
          calls += 1;
          throw new AiProviderCancelledError();
        },
        { hasSideEffects: false },
      ),
    ).rejects.toBeInstanceOf(AiProviderCancelledError);
    expect(calls).toBe(1);
  });

  it("runs exactly one attempt when the operation has side effects", async () => {
    let calls = 0;
    await expect(
      withBoundedRetry(
        async () => {
          calls += 1;
          throw new AiProviderError("upstream 500", 500, "AI_PROVIDER_ERROR");
        },
        { hasSideEffects: true },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("falls back across authorised candidates only", async () => {
    const providers = ["a", "b", "c"].map((label) => ({
      label,
      provider: {} as AiProvider,
      run: async () => {
        if (label !== "c") throw new AiProviderError("down", 503, "AI_PROVIDER_ERROR");
        return `answered by ${label}`;
      },
    }));
    const result = await withAuthorizedFallback(providers, { hasSideEffects: false });
    expect(result.value).toBe("answered by c");
    expect(result.attempts).toBe(3);
    expect(result.failures).toHaveLength(2);
  });

  it("stops after the first candidate when side effects are possible", async () => {
    let secondRan = false;
    const providers = [
      {
        label: "a",
        provider: {} as AiProvider,
        run: async () => {
          throw new AiProviderError("down", 503, "AI_PROVIDER_ERROR");
        },
      },
      {
        label: "b",
        provider: {} as AiProvider,
        run: async () => {
          secondRan = true;
          return "b";
        },
      },
    ];
    await expect(withAuthorizedFallback(providers, { hasSideEffects: true })).rejects.toThrow();
    expect(secondRan).toBe(false);
  });

  it("retries a transient failure on the same candidate before trying the next", async () => {
    // A 503 is worth one more try on the model that is already warm; only
    // after that does another candidate get a turn.
    let firstCalls = 0;
    let secondRan = false;
    const providers = [
      {
        label: "a",
        provider: {} as AiProvider,
        run: async () => {
          firstCalls += 1;
          if (firstCalls === 1) throw new AiProviderError("flaky", 503, "AI_PROVIDER_ERROR");
          return "answered by a";
        },
      },
      {
        label: "b",
        provider: {} as AiProvider,
        run: async () => {
          secondRan = true;
          return "answered by b";
        },
      },
    ];
    const result = await withAuthorizedFallback(providers, { hasSideEffects: false });
    expect(result.value).toBe("answered by a");
    expect(result.attempts).toBe(1);
    expect(firstCalls).toBe(2);
    expect(secondRan).toBe(false);
  });

  it("does not retry the same candidate when the operation has side effects", async () => {
    // A turn that may have written something is never replayed: one attempt,
    // then the failure is reported.
    let firstCalls = 0;
    const providers = [
      {
        label: "a",
        provider: {} as AiProvider,
        run: async () => {
          firstCalls += 1;
          throw new AiProviderError("down", 503, "AI_PROVIDER_ERROR");
        },
      },
    ];
    await expect(withAuthorizedFallback(providers, { hasSideEffects: true })).rejects.toThrow();
    expect(firstCalls).toBe(1);
  });
});

// ── Engine (DB-backed) ───────────────────────────────────────────────────────

describe("routing engine — precedence and policy", () => {
  it("auto-selects an available connection", async () => {
    await makeConnection(userId, "openai", "gpt-4o");
    await upsertPolicy(userId, { strategy: "AUTO" });
    const decision = await resolveRouting(userId, { feature: "chat" });
    expect(decision.available).toBe(true);
    expect(decision.provider).toBe("openai");
    expect(decision.model).toBe("gpt-4o");
  });

  it("fixed strategy pins the chosen model and never substitutes", async () => {
    await makeConnection(userId, "openai", "gpt-4o");
    await upsertPolicy(userId, { strategy: "FIXED", fixedModel: "does-not-exist" });
    const decision = await resolveRouting(userId, { feature: "chat" });
    expect(decision.available).toBe(false);
    expect(decision.model).toBeNull();
  });

  it("reports unavailable instead of substituting when auto fallback is off", async () => {
    await makeConnection(userId, "openai", "gpt-4o");
    await upsertPolicy(userId, { strategy: "AUTO", allowAutoFallback: false });
    const decision = await resolveRouting(userId, { feature: "chat" });
    expect(decision.available).toBe(false);
  });

  it("honours an explicit global preference as the chosen model", async () => {
    await makeConnection(userId, "openai", "gpt-4o");
    await makeConnection(userId, "anthropic", "claude-3-5-haiku-20241022");
    await upsertPolicy(userId, { strategy: "AUTO" });
    await replacePreferences(userId, "GLOBAL", null, [
      { provider: "anthropic", model: "claude-3-5-haiku-20241022", allowed: true },
    ]);
    const decision = await resolveRouting(userId, { feature: "chat" });
    expect(decision.available).toBe(true);
    expect(decision.provider).toBe("anthropic");
    expect(decision.reason).toBe("feature-default");
  });

  it("excludes a denied model", async () => {
    await makeConnection(userId, "openai", "gpt-4o");
    await upsertPolicy(userId, { strategy: "AUTO" });
    await replacePreferences(userId, "GLOBAL", null, [
      { provider: "openai", model: "gpt-4o", allowed: false },
    ]);
    const decision = await resolveRouting(userId, { feature: "chat" });
    expect(decision.available).toBe(false);
    expect(decision.rejected.some((r) => /allow\/deny/i.test(r.reason))).toBe(true);
  });

  it("free-only excludes paid models", async () => {
    await makeConnection(userId, "openai", "gpt-4o");
    await makeConnection(userId, "openrouter", "openrouter/free");
    await upsertPolicy(userId, { strategy: "AUTO", freeOnly: true });
    const decision = await resolveRouting(userId, { feature: "chat" });
    expect(decision.available).toBe(true);
    expect(decision.provider).toBe("openrouter");
  });

  it("refuses all external candidates when external processing is disabled", async () => {
    await makeConnection(userId, "openai", "gpt-4o");
    await upsertPolicy(userId, { strategy: "AUTO", externalProcessingDisabled: true });
    const decision = await resolveRouting(userId, { feature: "chat" });
    expect(decision.available).toBe(false);
    expect(decision.rejected.some((r) => /external/i.test(r.reason))).toBe(true);
  });

  it("allows a local candidate when external processing is disabled", async () => {
    await makeConnection(userId, "ollama", "llama3.2", { endpoint: "http://localhost:11434" });
    await upsertPolicy(userId, { strategy: "AUTO", externalProcessingDisabled: true });
    const decision = await resolveRouting(userId, { feature: "chat" });
    expect(decision.available).toBe(true);
    expect(decision.provider).toBe("ollama");
  });

  it("gates a vision requirement to models with verified vision support", async () => {
    // A text-only model must not be chosen for an image request.
    await makeConnection(userId, "custom", "gpt-4o-mini", { endpoint: "https://api.example.com/v1" });
    await upsertPolicy(userId, { strategy: "AUTO" });
    const decision = await resolveRouting(userId, { feature: "chat", requires: "VISION" });
    expect(decision.available).toBe(false);
    expect(decision.rejected.some((r) => /VISION/.test(r.reason))).toBe(true);
  });

  it("prefers a per-conversation override above everything else", async () => {
    await makeConnection(userId, "openai", "gpt-4o");
    await makeConnection(userId, "anthropic", "claude-3-5-haiku-20241022");
    await upsertPolicy(userId, { strategy: "AUTO" });
    await replacePreferences(userId, "CONVERSATION", "convo-1", [
      { scope: "CONVERSATION", conversationId: "convo-1", provider: "anthropic", model: "claude-3-5-haiku-20241022", allowed: true },
    ]);
    const decision = await resolveRouting(userId, { feature: "chat", conversationId: "convo-1" });
    expect(decision.provider).toBe("anthropic");
    expect(decision.reason).toBe("conversation-override");
  });

  it("serves a pinned model on the connection that can run it", async () => {
    // The connection was created with one model, but the same provider serves
    // the model the student pinned for this conversation. The pinned model is
    // what answers — the connection is only how the request is authenticated.
    const connection = await makeConnection(userId, "openai", "gpt-4o-mini");
    await upsertPolicy(userId, { strategy: "AUTO" });
    await replacePreferences(userId, "CONVERSATION", "convo-1", [
      { scope: "CONVERSATION", conversationId: "convo-1", provider: "openai", model: "gpt-4o", allowed: true },
    ]);
    const decision = await resolveRouting(userId, { feature: "chat", conversationId: "convo-1" });
    expect(decision.available).toBe(true);
    expect(decision.reason).toBe("conversation-override");
    expect(decision.model).toBe("gpt-4o");
    expect(decision.provider).toBe("openai");
    expect(decision.connectionId).toBe(connection.id);
  });

  it("honours a conversation override when no routing policy was ever saved", async () => {
    // The per-conversation model selector must work for a student who never
    // opened the routing settings: the pinned model is an explicit
    // instruction, not a policy preference.
    await makeConnection(userId, "openai", "gpt-4o");
    await replacePreferences(userId, "CONVERSATION", "convo-1", [
      { scope: "CONVERSATION", conversationId: "convo-1", provider: "openai", model: "gpt-4o", allowed: true },
    ]);
    const policy = await getPolicy(userId);
    expect(policy.id).toBe("");

    const resolved = await resolveAiProviderForUser(userId, {
      feature: "chat",
      conversationId: "convo-1",
    });
    expect(resolved.decision?.reason).toBe("conversation-override");
    expect(resolved.decision?.model).toBe("gpt-4o");
    expect(resolved.provider.isConfigured()).toBe(true);
  });

  it("keeps the default provider when the conversation has no pinned model", async () => {
    // No override: the student who never touched routing settings still gets
    // the behaviour they had before — the active personal connection, and no
    // routing decision at all.
    const { getActiveUserConnection } = await import("@/services/ai-connections");
    vi.mocked(getActiveUserConnection).mockResolvedValue({
      provider: "openai",
      decryptedCredentials: { apiKey: "sk-test-openai" },
      endpoint: null,
      model: "gpt-4o",
    } as never);

    const resolved = await resolveAiProviderForUser(userId, {
      feature: "chat",
      conversationId: "convo-without-override",
    });
    expect(resolved.decision).toBeNull();
  });
});

describe("capability catalog — evidence taxonomy", () => {
  it("only claims VISION for models the provider reports it for", () => {
    expect(catalogSupports("openai", "gpt-4o", "VISION")).toBe(true);
    expect(catalogSupports("custom", "gpt-4o-mini", "VISION")).toBe(false);
  });

  it("does not claim TOOLS for the Anthropic adapter that uses the no-tools path", () => {
    expect(catalogSupports("anthropic", "claude-3-5-sonnet-20241022", "TOOLS")).toBe(false);
  });

  it("treats an unknown model as supporting nothing", () => {
    for (const kind of CAPABILITY_KINDS) {
      expect(catalogSupports("openai", "totally-made-up-model", kind)).toBe(false);
    }
  });
});

// ── REST ─────────────────────────────────────────────────────────────────────

describe("routing REST — ownership and validation", () => {
  it("returns the effective policy with transient defaults", async () => {
    const res = await authRequestJson("get", `${BASE}/ai/routing`, token);
    expect(res.status).toBe(200);
    expect(res.body.data.strategy).toBe("AUTO");
  });

  it("updates the policy", async () => {
    const res = await authRequestJson("patch", `${BASE}/ai/routing`, token, {
      strategy: "FIXED",
      fixedModel: "gpt-4o",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.strategy).toBe("FIXED");
    expect(res.body.data.fixedModel).toBe("gpt-4o");
  });

  it("rejects an empty policy patch", async () => {
    const res = await authRequestJson("patch", `${BASE}/ai/routing`, token, {});
    expect(res.status).toBe(400);
  });

  it("returns the evidence-aware catalog", async () => {
    const res = await authRequestJson("get", `${BASE}/ai/routing/catalog`, token);
    expect(res.status).toBe(200);
    const openai = res.body.data.find((p: any) => p.provider === "openai");
    const gpt4o = openai.models.find((m: any) => m.id === "gpt-4o");
    const vision = gpt4o.capabilities.find((c: any) => c.kind === "VISION");
    expect(vision.evidence).toBe("PROVIDER_REPORTED");
    expect(vision.trusted).toBe(true);
  });

  it("requires authentication", async () => {
    const res = await authRequestJson("get", `${BASE}/ai/routing`, "");
    expect(res.status).toBe(401);
  });

  it("keeps one user's policy and preferences isolated from another's", async () => {
    const other = await registerAndLogin(`routing-other-${Date.now()}@test.com`, "TestPass123!");
    await authRequestJson("patch", `${BASE}/ai/routing`, token, { strategy: "FIXED", fixedModel: "gpt-4o" });
    const otherRes = await authRequestJson("get", `${BASE}/ai/routing`, other.token);
    expect(otherRes.body.data.strategy).toBe("AUTO");
    expect(otherRes.body.data.fixedModel).toBeNull();
  });

  it("pins and clears a per-conversation override", async () => {
    const convo = await prisma.aiConversation.create({
      data: { userId, title: "Routing test" },
    });
    const pinned = await authRequestJson(
      "put",
      `${BASE}/ai/routing/conversations/${convo.id}/preference`,
      token,
      { provider: "openai", model: "gpt-4o" },
    );
    expect(pinned.status).toBe(200);
    expect(pinned.body.data.model).toBe("gpt-4o");

    const readBack = await authRequestJson(
      "get",
      `${BASE}/ai/routing/conversations/${convo.id}/preference`,
      token,
    );
    expect(readBack.body.data.model).toBe("gpt-4o");

    const cleared = await authRequestJson(
      "put",
      `${BASE}/ai/routing/conversations/${convo.id}/preference`,
      token,
      { provider: null, model: null },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toBeNull();
  });
});

afterEach(async () => {
  // Remove the routing rows created by tests so a later suite starts clean.
  await prismaClient.aiModelPreference.deleteMany({});
  await prismaClient.aiModelCapability.deleteMany({});
  await prismaClient.aiRoutingPolicy.deleteMany({});
});
