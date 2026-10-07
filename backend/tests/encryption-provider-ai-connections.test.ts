import { describe, it, expect, vi, afterEach } from "vitest";
import { encrypt, decrypt, encryptForUser, decryptForUser } from "@/utils/encryption";
import { AiProvider, resolveAiProvider } from "@/services/ai/provider";

describe("encryption empty-ciphertext round-trip (regression: credential-free AI connections)", () => {
  it("encrypts and decrypts an empty string back to empty", () => {
    // Credential-free providers (ollama) store `encryptForUser(userId, "")`.
    // A valid AES-256-GCM envelope for an empty payload is 12-byte IV + 16-byte
    // auth tag = 28 bytes, which the old guard (`< IV + AUTH_TAG + 1`) rejected.
    const shared = encrypt("");
    expect(decrypt(shared)).toBe("");

    const perUser = encryptForUser("user-1", "");
    expect(decryptForUser("user-1", perUser)).toBe("");
    expect(perUser).not.toBe(encryptForUser("user-2", "")); // per-user key derivation
  });

  it("still rejects byte strings shorter than a valid GCM envelope", () => {
    expect(() => decrypt("aGVsbG8=")).toThrow("Invalid ciphertext: too short");
  });
});

describe("AiProvider#isConfigured (regression: ollama chat was a 503)", () => {
  it("treats credential-free ollama as configured with no key", () => {
    const provider = new AiProvider(
      resolveAiProvider("ollama"),
      {},
      "http://localhost:11434"
    );
    expect(provider.isConfigured()).toBe(true);
  });

  it("treats key-based providers as unconfigured while no credentials are present", () => {
    const provider = new AiProvider(resolveAiProvider("openai"), {});
    expect(provider.isConfigured()).toBe(false);
  });
});

describe("AiProvider#chat grounds the model in StudentOS data (regression: context was built and stored but never sent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(reply: string) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finishReason: "stop" }],
      }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("prepends a grounding system message containing the context JSON", async () => {
    const fetchMock = stubFetch("grounded reply");

    const provider = new AiProvider(
      resolveAiProvider("openai"),
      { apiKey: "sk-test-key-123" },
      "https://provider.test.local",
      "test-model"
    );

    const context = JSON.stringify({
      studentos: {
        courses: [{ id: "c1", name: "Database Systems", code: "CS-345", status: "ACTIVE" }],
        tasks: [],
      },
    });

    const result = await provider.chat({
      messages: [{ role: "user", content: "How is my progress going?" }],
      context,
    });

    expect(result.content).toBe("grounded reply");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(url).toBe("https://provider.test.local/chat/completions");
    expect(body.model).toBe("test-model");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("StudentOS academic assistant");
    expect(body.messages[0].content).toContain(context);
    expect(body.messages[1]).toEqual({ role: "user", content: "How is my progress going?" });
  });

  it("does not add a system message when no context is provided", async () => {
    const fetchMock = stubFetch("ok");

    const provider = new AiProvider(resolveAiProvider("openai"), { apiKey: "sk-test-key-123" });
    await provider.chat({ messages: [{ role: "user", content: "hi" }] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: Array<{ role: string }> };
    expect(body.messages.map((m) => m.role)).toEqual(["user"]);
  });
});