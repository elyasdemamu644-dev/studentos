import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionFormSchema } from "@/features/ai-connections/connection-form";
import {
  listDefaultAiModels,
  setAiMode,
  setDefaultModel,
} from "@/features/ai-connections/ai-connections-api";
import { api } from "@/lib/api/client";
import { ApiClientError } from "@/lib/api/errors";
import {
  AI_PROVIDER_LABELS,
  CREDENTIAL_FREE_PROVIDERS,
  ENDPOINT_REQUIRED_PROVIDERS,
  isCredentialFreeProvider,
  isEndpointRequiredProvider,
} from "@/lib/labels";
import type { AiProviderName } from "@/types/api-types";

const ALL_PROVIDERS: AiProviderName[] = [
  "openai",
  "gemini",
  "anthropic",
  "openrouter",
  "ollama",
  "custom",
];

const validOpenAi = {
  provider: "openai" as const,
  model: "gpt-4o-mini",
  endpoint: "",
  credentials: "sk-test-key",
};

describe("ai connection provider labels", () => {
  it("labels every provider the API accepts", () => {
    for (const provider of ALL_PROVIDERS) {
      expect(AI_PROVIDER_LABELS[provider]).toBeTruthy();
    }
  });

  it("treats ollama as the only credential-free provider", () => {
    expect(CREDENTIAL_FREE_PROVIDERS).toEqual(["ollama"]);
    expect(isCredentialFreeProvider("ollama")).toBe(true);
    for (const provider of ALL_PROVIDERS) {
      if (provider === "ollama") continue;
      expect(isCredentialFreeProvider(provider)).toBe(false);
    }
  });

  it("requires an endpoint for ollama and custom only", () => {
    expect([...ENDPOINT_REQUIRED_PROVIDERS].sort()).toEqual(["custom", "ollama"]);
    expect(isEndpointRequiredProvider("ollama")).toBe(true);
    expect(isEndpointRequiredProvider("custom")).toBe(true);
    expect(isEndpointRequiredProvider("openai")).toBe(false);
  });
});

describe("ai connection form schema", () => {
  it("accepts a well-formed keyed provider", () => {
    expect(connectionFormSchema.safeParse(validOpenAi).success).toBe(true);
  });

  it("requires a key for every provider that uses one", () => {
    for (const provider of ALL_PROVIDERS) {
      if (isCredentialFreeProvider(provider)) continue;
      const result = connectionFormSchema.safeParse({
        ...validOpenAi,
        provider,
        endpoint: isEndpointRequiredProvider(provider) ? "http://localhost:11434" : "",
        credentials: "   ",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path)).toContainEqual(["credentials"]);
      }
    }
  });

  it("accepts ollama with an endpoint and no key", () => {
    const result = connectionFormSchema.safeParse({
      provider: "ollama",
      model: "llama3",
      endpoint: "http://localhost:11434",
      credentials: "",
    });
    expect(result.success).toBe(true);
  });

  it("still requires an endpoint for ollama", () => {
    const result = connectionFormSchema.safeParse({
      provider: "ollama",
      model: "",
      endpoint: "  ",
      credentials: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path)).toContainEqual(["endpoint"]);
    }
  });

  it("still requires an endpoint for a custom endpoint", () => {
    const result = connectionFormSchema.safeParse({
      provider: "custom",
      model: "",
      endpoint: "",
      credentials: "some-key",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path)).toContainEqual(["endpoint"]);
    }
  });

  it("treats a blank model and endpoint as absent", () => {
    const result = connectionFormSchema.safeParse({
      provider: "openai",
      model: "   ",
      endpoint: "",
      credentials: "sk-test-key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("");
    }
  });
});

// ─────────────────────────────────────────────
// Connection-test transport (root-cause regression)
// ─────────────────────────────────────────────
//
// Symptom this pins down: "Connection error: Unexpected token ... "<!DOCTYPE"
// "... is not valid JSON". That happens when the API base URL points at the web
// origin (`:3000`), so the request hits a Next.js HTML 404 instead of the
// Express API. The client must never try to parse that HTML as JSON, and must
// report the misroute as a clear, actionable error.

describe("ai connection test transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never produces a raw JSON parse error when the API returns an HTML page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!DOCTYPE html><html><body>Not Found</body></html>", {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      })),
    );

    const error = await api
      .post("/ai-connections/test", { provider: "openrouter", credentials: "sk-test" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    const apiError = error as ApiClientError;
    // The bug: this used to surface as `Unexpected token '<'`.
    expect(apiError.message).not.toMatch(/Unexpected token/i);
    expect(apiError.message).not.toContain("<!DOCTYPE");
    expect(apiError.message).toMatch(/HTML/i);
    expect(apiError.code).toBe("API_BASE_URL_MISCONFIGURED");
    expect(apiError.message).toContain("NEXT_PUBLIC_API_URL");
  });

  it("preserves the backend's structured JSON error when the API returns JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "VALIDATION_ERROR", message: "Validation failed on: credentials" },
          }),
          { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
        ),
      ),
    );

    const error = await api
      .post("/ai-connections/test", { provider: "openrouter" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    const apiError = error as ApiClientError;
    expect(apiError.code).toBe("VALIDATION_ERROR");
    expect(apiError.message).toBe("Validation failed on: credentials");
    expect(apiError.status).toBe(400);
  });

  it("returns the success envelope for a well-formed connection test", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: { success: true, message: "Connection successful", model: "openai/gpt-4o" },
          }),
          { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
        ),
      ),
    );

    const result = await api.post<{ success: boolean; model: string | null }>(
      "/ai-connections/test",
      { provider: "openrouter", credentials: "sk-test" },
    );
    expect(result.success).toBe(true);
    expect(result.model).toBe("openai/gpt-4o");
  });

  it("treats an empty 204 body as success, not a misconfiguration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(api.delete("/ai-connections/some-id")).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// AI preference transport (mode + Default AI model)
// ─────────────────────────────────────────────

describe("ai preference transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Capture every request the api client makes and answer with an empty success. */
  function captureRequests() {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }),
    );
    return calls;
  }

  it("persists the AI mode as a namespaced setting", async () => {
    const calls = captureRequests();

    await setAiMode("STUDY");

    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/settings");
    expect(calls[0].body).toEqual({ settings: { "ai.mode": "STUDY" } });
  });

  it("trims a real model id and clears the preference with null", async () => {
    const calls = captureRequests();

    await setDefaultModel("  gpt-4o  ");
    await setDefaultModel("   ");

    expect(calls[0].body).toEqual({ settings: { "ai.model": "gpt-4o" } });
    expect(calls[1].body).toEqual({ settings: { "ai.model": null } });
  });

  it("reads the Default AI model catalog from the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              defaultProvider: "openai",
              defaultModel: "gpt-4o-mini",
              group: {
                provider: "openai",
                defaultModel: "gpt-4o-mini",
                models: [{ id: "gpt-4o", label: "GPT-4o" }],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
        ),
      ),
    );

    const result = await listDefaultAiModels();

    expect(result.group.provider).toBe("openai");
    expect(result.group.models[0]).toEqual({ id: "gpt-4o", label: "GPT-4o" });
  });
});
