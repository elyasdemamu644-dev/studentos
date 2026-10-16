import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

vi.mock("@/services/settings", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/settings")>();
  return { ...mod, settingsService: { ...mod.settingsService, get: vi.fn() } };
});

import {
  AiConnectionUnreadableError,
  AiProvider,
  AiProviderNotConfiguredError,
  AiProviderError,
  buildDefaultAiProvider,
  getAIProvider,
  resolveAiProvider,
  type DefaultAiProviderConfig,
} from "@/services/ai/provider";

const OPENROUTER_CONFIG: DefaultAiProviderConfig = {
  aiEnabled: true,
  aiProvider: "openrouter",
  aiBaseUrl: "https://openrouter.ai/api/v1",
  openRouterApiKey: "sk-or-test-openrouter-key-12345",
};

function stubFetch() {
  // Respond with both provider shapes so the same stub works for the OpenAI-
  // style adapters (`choices[*].message.content`) and the Ollama adapter
  // (`message.content`).
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ index: 0, message: { role: "assistant", content: "grounded reply", finishReason: "stop" } }],
      message: { role: "assistant", content: "grounded reply" },
    }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function bodyOf(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as {
    model: string;
    messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
  };
}

describe("buildDefaultAiProvider (env default/fallback)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("builds a configured OpenRouter provider from AI_* env", () => {
    const provider = buildDefaultAiProvider(OPENROUTER_CONFIG);
    expect(provider).toBeInstanceOf(AiProvider);
    expect(provider!.isConfigured()).toBe(true);
  });

  it("returns null when AI is disabled", () => {
    expect(buildDefaultAiProvider({ ...OPENROUTER_CONFIG, aiEnabled: false })).toBeNull();
  });

  it("returns null when the configured provider's key is missing", () => {
    expect(
      buildDefaultAiProvider({ ...OPENROUTER_CONFIG, openRouterApiKey: undefined })
    ).toBeNull();
  });

  it("uses OpenRouter's capability-aware free router when no model is specified", () => {
    const provider = buildDefaultAiProvider(OPENROUTER_CONFIG);
    expect(provider?.model).toBe("openrouter/free");
    expect(provider?.supportsTools()).toBe(true);
  });

  it("uses an owner-supplied OpenAI key and that provider's default model", () => {
    const provider = buildDefaultAiProvider({
      aiEnabled: true,
      aiProvider: "openai",
      openAiApiKey: "sk-test-owner-openai-key",
    });
    expect(provider?.isConfigured()).toBe(true);
    expect(provider?.model).toBe("gpt-4o");
  });

  it("uses an explicitly configured owner provider model without changing code", async () => {
    const fetchMock = stubFetch();
    const provider = buildDefaultAiProvider({
      aiEnabled: true,
      aiProvider: "openai",
      aiModel: "owner-selected-model",
      openAiApiKey: "sk-test-owner-openai-key",
      openAiBaseUrl: "https://owner-provider.example/v1",
    })!;
    await provider.chat({ messages: [{ role: "user", content: "hello" }] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://owner-provider.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-owner-openai-key");
    expect(JSON.parse(init.body as string).model).toBe("owner-selected-model");
  });

  it("keeps Default AI unavailable for a blank key or unknown provider", () => {
    expect(buildDefaultAiProvider({
      ...OPENROUTER_CONFIG,
      openRouterApiKey: "   ",
    })).toBeNull();
    expect(buildDefaultAiProvider({
      aiEnabled: true,
      aiProvider: "typo-provider",
      aiModel: "some-model",
    })).toBeNull();
  });

  it("treats a credential-free ollama default as configured with no key", () => {
    const provider = buildDefaultAiProvider({
      aiEnabled: true,
      aiProvider: "ollama",
      ollamaBaseUrl: "http://localhost:11434",
    });
    expect(provider?.isConfigured()).toBe(true);
  });

  it("does not mark local/custom defaults ready without valid endpoints", () => {
    expect(buildDefaultAiProvider({
      aiEnabled: true,
      aiProvider: "ollama",
      ollamaBaseUrl: "not a URL",
    })).toBeNull();
    expect(buildDefaultAiProvider({
      aiEnabled: true,
      aiProvider: "custom",
      customAiApiKey: "owner-key",
    })).toBeNull();
  });

  it("chats against the OpenRouter URL with the env model and a grounding system message", async () => {
    const fetchMock = stubFetch();
    const context = JSON.stringify({ tutorWalle: { courses: [{ name: "Database Systems" }], tasks: [] } });

    const provider = buildDefaultAiProvider(OPENROUTER_CONFIG)!;
    const result = await provider.chat({
      messages: [{ role: "user", content: "How is my progress going?" }],
      context,
    });

    expect(result.content).toBe("grounded reply");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = await bodyOf(fetchMock);
    expect(body.model).toBe("openrouter/free");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain(context);
    expect(body.messages[1].content).toBe("How is my progress going?");
  });

  it("sends image content parts through the OpenRouter-compatible chat API", async () => {
    const fetchMock = stubFetch();
    const provider = buildDefaultAiProvider(OPENROUTER_CONFIG)!;

    await provider.chat({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=", detail: "auto" } },
        ],
      }],
    });

    const body = await bodyOf(fetchMock);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "What is in this image?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=", detail: "auto" } },
    ]);
  });

  it("passes tool calls to OpenRouter's feature-aware free router", async () => {
    const fetchMock = stubFetch();
    const provider = buildDefaultAiProvider(OPENROUTER_CONFIG)!;
    await provider.chatWithTools({
      messages: [{ role: "user", content: "Find my next task" }],
      tools: [{
        type: "function",
        function: {
          name: "find_task",
          description: "Find a task",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      }],
      toolChoice: "auto",
    });

    const body = await bodyOf(fetchMock);
    expect(body.model).toBe("openrouter/free");
    expect((body as typeof body & { tools?: unknown[] }).tools).toHaveLength(1);
  });
});

describe("getAIProvider resolution (active connection → env default)", () => {
  beforeEach(async () => {
    vi.mocked(
      (await import("@/services/ai-connections")).getActiveUserConnection
    ).mockReset();
    vi.mocked((await import("@/services/settings")).settingsService.get)
      .mockReset()
      .mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("gives the personal active connection precedence over the env default", async () => {
    const { getActiveUserConnection } = await import("@/services/ai-connections");
    vi.mocked(getActiveUserConnection).mockResolvedValue({
      provider: "ollama",
      decryptedCredentials: {},
      endpoint: "http://localhost:11434",
      model: "qwen3:4b",
    });
    const fetchMock = stubFetch();

    const provider = await getAIProvider("user-with-ollama");
    expect(provider.isConfigured()).toBe(true);
    await provider.chat({ messages: [{ role: "user", content: "hi" }] });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = await bodyOf(fetchMock);
    expect(body.model).toBe("qwen3:4b");
  });

  it("throws a controlled 503 when there is no connection and no usable default", async () => {
    const { getActiveUserConnection } = await import("@/services/ai-connections");
    vi.mocked(getActiveUserConnection).mockResolvedValue(null);

    // In the test worker AI is disabled (`AI_ENABLED=false` in vitest env), so
    // the env-default provider is unusable → getAIProvider must 503, not hang.
    await expect(getAIProvider("user-nothing")).rejects.toBeInstanceOf(AiProviderNotConfiguredError);
    await expect(getAIProvider("user-nothing")).rejects.toMatchObject({
      statusCode: 503,
      code: "AI_PROVIDER_NOT_CONFIGURED",
    });
  });

  it("uses the environment default when the user explicitly selects Tutor Walle Default AI", async () => {
    const { getActiveUserConnection } = await import("@/services/ai-connections");
    vi.mocked(getActiveUserConnection).mockResolvedValue({
      provider: "ollama",
      decryptedCredentials: {},
      endpoint: "http://localhost:11434",
      model: "qwen3:4b",
    });
    vi.mocked((await import("@/services/settings")).settingsService.get)
      .mockResolvedValue({ "ai.providerMode": "default" });

    await expect(getAIProvider("user-default-mode")).rejects.toMatchObject({
      statusCode: 503,
      code: "AI_PROVIDER_NOT_CONFIGURED",
      message: "Tutor Walle Default AI is not configured. Please contact the administrator.",
    });
    expect(getActiveUserConnection).not.toHaveBeenCalled();
  });

  it("does not silently fall back to the shared provider when personal mode has no active connection", async () => {
    const { getActiveUserConnection } = await import("@/services/ai-connections");
    vi.mocked(getActiveUserConnection).mockResolvedValue(null);
    vi.mocked((await import("@/services/settings")).settingsService.get)
      .mockResolvedValue({ "ai.providerMode": "personal" });

    await expect(getAIProvider("user-personal-mode")).rejects.toMatchObject({
      statusCode: 503,
      code: "AI_PROVIDER_NOT_CONFIGURED",
      message: "No active personal AI connection. Activate a connection in Settings or select Tutor Walle Default AI.",
    });
  });

  it("propagates an unreadable-connection error instead of falling back to the env default", async () => {
    // The user has an active connection, but its stored credentials could not be
    // decrypted. Resolution must surface that typed error rather than silently
    // answering with a different (environment-default) provider.
    vi.stubEnv("AI_ENABLED", "true");
    vi.stubEnv("AI_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-openrouter-key-12345");

    const { getActiveUserConnection } = await import("@/services/ai-connections");
    vi.mocked(getActiveUserConnection).mockRejectedValue(new AiConnectionUnreadableError());

    await expect(getAIProvider("user-unreadable")).rejects.toBeInstanceOf(AiConnectionUnreadableError);
    await expect(getAIProvider("user-unreadable")).rejects.toMatchObject({
      statusCode: 409,
      code: "AI_CONNECTION_UNREADABLE",
    });
  });

  it("falls back to the configured env default when the user has no active connection", async () => {
    // Full end-to-end resolution through the real config module: point the
    // process env at OpenRouter, reload the modules, and let getAIProvider use
    // the default provider for a user with no personal connection.
    vi.stubEnv("AI_ENABLED", "true");
    vi.stubEnv("AI_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-openrouter-key-12345");
    vi.stubEnv("AI_MODEL", "inclusionai/ling-3.0-flash-sante:free");
    vi.stubEnv("AI_BASE_URL", "https://openrouter.ai/api/v1");
    const fetchMock = stubFetch();
    vi.resetModules();

    const providerMod = await import("@/services/ai/provider");
    const serviceMod = await import("@/services/ai-connections");
    vi.mocked(serviceMod.getActiveUserConnection).mockResolvedValue(null);

    const provider = await providerMod.getAIProvider("user-no-connection");
    expect(provider.isConfigured()).toBe(true);

    const context = JSON.stringify({ tutorWalle: { courses: [{ name: "Database Systems" }], tasks: [] } });
    const result = await provider.chat({
      messages: [{ role: "user", content: "How is my progress going?" }],
      context,
    });
    expect(result.content).toBe("grounded reply");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = await bodyOf(fetchMock);
    expect(body.model).toBe("inclusionai/ling-3.0-flash-sante:free");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain(context);
  });
});

describe("AiProvider.chat provider-error sanitization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps a provider failure in AiProviderError without leaking the key", async () => {
    const key = "sk-or-test-openrouter-key-12345";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => `{"error":{"message":"Invalid API key ${key}"}}`,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AiProvider(
      resolveAiProvider("openai"),
      { apiKey: key },
      "https://provider.test.local"
    );

    const err = await provider
      .chat({ messages: [{ role: "user", content: "hi" }] })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).statusCode).toBe(502);
    expect((err as AiProviderError).message).toContain("credentials were rejected");
    expect((err as AiProviderError).message).not.toContain(key);
  });

  it.each([
    [429, "AI_PROVIDER_RATE_LIMITED", 429],
    [402, "AI_PROVIDER_QUOTA_EXHAUSTED", 402],
    [401, "AI_PROVIDER_AUTH_FAILED", 502],
    [404, "AI_MODEL_UNAVAILABLE", 422],
    [503, "AI_PROVIDER_UNAVAILABLE", 503],
  ])("maps upstream HTTP %i into a safe actionable failure", async (upstreamStatus, code, appStatus) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: upstreamStatus,
      text: async () => `{"error":{"message":"upstream detail"}}`,
    }));
    const provider = new AiProvider(
      resolveAiProvider("openrouter"),
      { apiKey: "sk-or-test-openrouter-key-12345" },
      "https://openrouter.test.local",
    );

    const error = await provider.chat({ messages: [{ role: "user", content: "hello" }] })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({ statusCode: appStatus, code });
    expect((error as Error).message).not.toContain("upstream detail");
  });

  it("recognizes OpenRouter's HTTP 200 in-body rate-limit error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: { message: "Provider rate limit exceeded" } }),
    }));
    const provider = new AiProvider(
      resolveAiProvider("openrouter"),
      { apiKey: "sk-or-test-openrouter-key-12345" },
      "https://openrouter.test.local",
    );

    await expect(provider.chat({ messages: [{ role: "user", content: "hello" }] }))
      .rejects.toMatchObject({ statusCode: 429, code: "AI_PROVIDER_RATE_LIMITED" });
  });

  it("maps a model capability mismatch to a clear unavailable-model error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: { message: "The selected model does not support tools" } }),
    }));
    const provider = buildDefaultAiProvider(OPENROUTER_CONFIG)!;

    await expect(provider.chat({ messages: [{ role: "user", content: "hello" }] }))
      .rejects.toMatchObject({ statusCode: 422, code: "AI_MODEL_UNAVAILABLE" });
  });

  // OpenRouter answers **HTTP 200** with an in-body `error` and no `choices`
  // when a route fails upstream (reproduced live with a `:free` model whose
  // provider was overloaded). That body must surface as the provider's own
  // reason, never as a TypeError from `response.choices[0]`.
  it("surfaces an in-body 200 error payload instead of crashing on choices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          id: "gen-1791469283",
          error: {
            message: "Upstream error from Nvidia: Service temporarily overloaded",
            code: 503,
            metadata: { error_type: "provider_overloaded" },
          },
        }),
      }),
    );

    const provider = new AiProvider(
      resolveAiProvider("openrouter"),
      { apiKey: "sk-or-test-openrouter-key-12345" },
      "https://openrouter.test.local"
    );

    const err = await provider
      .chat({ messages: [{ role: "user", content: "hi" }] })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).statusCode).toBe(503);
    expect((err as AiProviderError).code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect((err as AiProviderError).message).toContain("temporarily unavailable");
    expect((err as AiProviderError).message).not.toContain("Cannot read properties");
  });

  it("reports a 200 response with neither error nor choices as unusable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ id: "gen-2" }),
      }),
    );

    const provider = new AiProvider(
      resolveAiProvider("openrouter"),
      { apiKey: "sk-or-test-openrouter-key-12345" },
      "https://openrouter.test.local"
    );

    const err = await provider
      .chat({ messages: [{ role: "user", content: "hi" }] })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).statusCode).toBe(502);
    expect((err as AiProviderError).message).toContain("no choices");
  });

  it("still returns the content on a successful provider call", async () => {
    const fetchMock = stubFetch();
    const provider = new AiProvider(
      resolveAiProvider("openai"),
      { apiKey: "sk-test-key-a1b2c3" },
      "https://provider.test.local"
    );

    await expect(provider.chat({ messages: [{ role: "user", content: "hi" }] })).resolves.toEqual({
      content: "grounded reply",
    });
    expect((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://provider.test.local/chat/completions"
    );
  });
});

describe("AiProvider request timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("aborts a hung provider call and surfaces a controlled 504", async () => {
    // Mirror real fetch: it never settles until the caller aborts.
    vi.stubEnv("AI_REQUEST_TIMEOUT_MS", "20");
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          });
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    // The config module reads AI_REQUEST_TIMEOUT_MS at import time, so the
    // provider must be re-imported after the env is set.
    vi.resetModules();

    const providerMod = await import("@/services/ai/provider");
    const provider = new providerMod.AiProvider(
      providerMod.resolveAiProvider("openai"),
      { apiKey: "sk-test-key-a1b2c3" },
      "https://provider.test.local"
    );

    const err = await provider
      .chat({ messages: [{ role: "user", content: "hi" }] })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(providerMod.AiProviderTimeoutError);
    expect((err as { statusCode?: number }).statusCode).toBe(504);
    expect((err as { code?: string }).code).toBe("AI_PROVIDER_TIMEOUT");
    expect((err as Error).message).toMatch(/did not respond within/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the upstream provider request when the student stops generation", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AiProvider(
      resolveAiProvider("openrouter"),
      { apiKey: "sk-or-test-openrouter-key-12345" },
      "https://openrouter.test.local",
    );
    const controller = new AbortController();
    const generation = provider.chat({
      messages: [{ role: "user", content: "hello" }],
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(generation).rejects.toMatchObject({ name: "AiProviderCancelledError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient fetch network failures before returning a provider response", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ index: 0, message: { role: "assistant", content: "recovered" } }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AiProvider(
      resolveAiProvider("openrouter"),
      { apiKey: "sk-or-test-openrouter-key-12345" },
      "https://openrouter.test.local",
    );
    await expect(provider.chat({ messages: [{ role: "user", content: "hello" }] }))
      .resolves.toEqual({ content: "recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
