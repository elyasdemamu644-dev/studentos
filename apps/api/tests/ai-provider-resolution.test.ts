import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/modules/ai-connections/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/ai-connections/service")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

import {
  AiProvider,
  AiProviderNotConfiguredError,
  AiProviderError,
  buildDefaultAiProvider,
  getAIProvider,
  resolveAiProvider,
  type DefaultAiProviderConfig,
} from "@/modules/ai/provider";

const OPENROUTER_CONFIG: DefaultAiProviderConfig = {
  aiEnabled: true,
  aiProvider: "openrouter",
  aiModel: "inclusionai/ling-3.0-flash-sante:free",
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
    messages: Array<{ role: string; content: string }>;
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

  it("treats a credential-free ollama default as configured with no key", () => {
    const provider = buildDefaultAiProvider({
      aiEnabled: true,
      aiProvider: "ollama",
      ollamaBaseUrl: "http://localhost:11434",
    });
    expect(provider?.isConfigured()).toBe(true);
  });

  it("chats against the OpenRouter URL with the env model and a grounding system message", async () => {
    const fetchMock = stubFetch();
    const context = JSON.stringify({ studentos: { courses: [{ name: "Database Systems" }], tasks: [] } });

    const provider = buildDefaultAiProvider(OPENROUTER_CONFIG)!;
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
    expect(body.messages[1].content).toBe("How is my progress going?");
  });
});

describe("getAIProvider resolution (active connection → env default)", () => {
  beforeEach(async () => {
    vi.mocked(
      (await import("@/modules/ai-connections/service")).getActiveUserConnection
    ).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("gives the personal active connection precedence over the env default", async () => {
    const { getActiveUserConnection } = await import("@/modules/ai-connections/service");
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
    const { getActiveUserConnection } = await import("@/modules/ai-connections/service");
    vi.mocked(getActiveUserConnection).mockResolvedValue(null);

    // In the test worker AI is disabled (`AI_ENABLED=false` in vitest env), so
    // the env-default provider is unusable → getAIProvider must 503, not hang.
    await expect(getAIProvider("user-nothing")).rejects.toBeInstanceOf(AiProviderNotConfiguredError);
    await expect(getAIProvider("user-nothing")).rejects.toMatchObject({
      statusCode: 503,
      code: "AI_PROVIDER_NOT_CONFIGURED",
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

    const providerMod = await import("@/modules/ai/provider");
    const serviceMod = await import("@/modules/ai-connections/service");
    vi.mocked(serviceMod.getActiveUserConnection).mockResolvedValue(null);

    const provider = await providerMod.getAIProvider("user-no-connection");
    expect(provider.isConfigured()).toBe(true);

    const context = JSON.stringify({ studentos: { courses: [{ name: "Database Systems" }], tasks: [] } });
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
    expect((err as AiProviderError).message).toContain("[REDACTED]");
    expect((err as AiProviderError).message).not.toContain(key);
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