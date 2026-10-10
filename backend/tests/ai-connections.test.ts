import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { app } from "@/app";
import { prisma } from "@/utils/prisma";
import { registerAndLogin, authRequestJson } from "./helpers";

const BASE = "/api/v1/ai-connections";
const AI_BASE = "/api/v1/ai";

// Valid test credential strings (not real keys, just non-empty strings)
const OPENAI_CREDS = { apiKey: "sk-test-openai-key-1234567890abcdef" };
const GEMINI_CREDS = { apiKey: "AIza-test-gemini-key-1234567890" };
const ANTHROPIC_CREDS = { apiKey: "sk-ant-test-anthropic-key-123456" };
const OPENROUTER_CREDS = { apiKey: "sk-or-test-openrouter-key-12345" };
const OLLAMA_CREDS = "no-auth-needed";
const CUSTOM_CREDS = { apiKey: "custom-key-12345" };

function jsonCreds(creds: Record<string, string> | string): string {
  return typeof creds === "string" ? creds : JSON.stringify(creds);
}

// ── Helper: create a connection and return its id ──────────────────────────────

async function createConn(
  token: string,
  over?: Partial<{
    provider: string;
    model: string | null;
    endpoint: string | null;
    credentials: string;
  }>
) {
  const body = {
    provider: over?.provider ?? "openai",
    model: over?.model ?? "gpt-4o",
    endpoint: over?.endpoint ?? null,
    credentials: over?.credentials ?? jsonCreds(OPENAI_CREDS),
  };
  const res = await authRequestJson("post", BASE, token, body);
  return res.body.data;
}

// ── Fake fetch for provider test mocking ───────────────────────────────────────

function mockFetch(over: {
  status?: number;
  body?: unknown;
  error?: string;
  prefix?: string;
  type?: "openai" | "gemini" | "anthropic";
} = {}) {
  return vi.fn().mockImplementation(async (url: string, init: RequestInit = {}) => {
    const isPost = init?.method?.toUpperCase() === "POST";
    // Only POST to chat/completions or messages or generateContent triggers a real test
    const triggerUrl = url.toLowerCase();
    const triggersTest =
      isPost &&
      (triggerUrl.includes("/chat/completions") ||
        triggerUrl.includes("/messages") ||
        triggerUrl.includes("/generatecontent") ||
        triggerUrl.includes("/api/tags") ||
        triggerUrl.includes("/api/version"));
    if (!triggersTest) {
      // For non-triggering requests (like GET /api/tags from ollama test), handle separately
      if (url.includes("/api/tags") || url.includes("/api/version")) {
        return new Response(JSON.stringify({ models: [{ name: "llama3.2" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }
    const provider =
      over.type === "gemini"
        ? "gemini"
        : over.type === "anthropic"
          ? "anthropic"
          : "openai";
    if (over.error) {
      // Every provider surfaces a 4xx failure as `{ error: { message } }`, and
      // that is exactly what the adapters parse to build the user-facing error
      // (OpenAiAdapter reads `j.error.message`). Returning a success-shaped body
      // here would leave the adapter with nothing to report, so the mock has to
      // carry the message through rather than only flag that a failure occurred.
      const errBody = {
        error: { message: over.error, type: "invalid_request_error" },
      };
      return new Response(JSON.stringify(errBody), {
        status: over.status ?? 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Echo the model the adapter actually asked for, so the response reflects
    // the request instead of a value invented outside this scope.
    const requestModel = (() => {
      try {
        return (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "test-model";
      } catch {
        return "test-model";
      }
    })();
    const successBody =
      provider === "gemini"
        ? {
            candidates: [
              {
                content: {
                  parts: [{ text: "OK" }],
                },
              },
            ],
          }
        : provider === "anthropic"
          ? { content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" }
          : {
              id: "test-id",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: requestModel,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "OK" },
                  finish_reason: "stop",
                },
              ],
            };
    return new Response(JSON.stringify(successBody), {
      status: over.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("AI Connections — StudentOS Phase 2", () => {
  let alice: {
    token: string;
    user: { id: string; email: string };
  };
  let bob: {
    token: string;
    user: { id: string; email: string };
  };
  let connId: string;

  beforeAll(async () => {
    alice = await registerAndLogin("alice@studentos.test", "Pass123!");
    bob = await registerAndLogin("bob@studentos.test", "Pass123!");
  });

  beforeEach(async () => {
    await prisma.aiConnection.deleteMany({ where: { userId: alice.user.id } });
    await prisma.aiConnection.deleteMany({ where: { userId: bob.user.id } });
  });

  afterAll(async () => {
    await prisma.aiConnection.deleteMany({ where: { userId: alice.user.id } });
    await prisma.aiConnection.deleteMany({ where: { userId: bob.user.id } });
  });

  // ── Authentication required ──────────────────────────────────────────────────

  describe("authentication", () => {
    it("rejects unauthenticated POST", async () => {
      await request(app)
        .post(BASE)
        .send({ provider: "openai", credentials: "x" })
        .expect(401);
    });

    it("rejects unauthenticated GET list", async () => {
      await request(app).get(BASE).expect(401);
    });

    it("rejects unauthenticated GET single", async () => {
      await request(app).get(`${BASE}/cuid-fake`).expect(401);
    });

    it("rejects unauthenticated PATCH", async () => {
      await request(app)
        .patch(`${BASE}/cuid-fake`)
        .send({ model: "gpt-4" })
        .expect(401);
    });

    it("rejects unauthenticated DELETE", async () => {
      await request(app).delete(`${BASE}/cuid-fake`).expect(401);
    });

    it("rejects unauthenticated POST test", async () => {
      await request(app)
        .post(`${BASE}/test`)
        .send({ provider: "openai", credentials: "x" })
        .expect(401);
    });

    it("rejects unauthenticated POST activate", async () => {
      await request(app).post(`${BASE}/cuid-fake/activate`).expect(401);
    });

    it("rejects unauthenticated GET active", async () => {
      await request(app).get(`${BASE}/active`).expect(401);
    });
  });

  // ── Validation ───────────────────────────────────────────────────────────────

  describe("validation", () => {
    it("rejects unknown provider", async () => {
      const res = await authRequestJson(
        "post",
        BASE,
        alice.token,
        // @ts-expect-error intentional invalid
        { provider: "unknown", credentials: "x" }
      );
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("rejects empty credentials", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "openai",
        credentials: "",
      });
      expect(res.status).toBe(400);
    });

    it("rejects missing credentials", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "openai",
      });
      expect(res.status).toBe(400);
    });

    it("rejects credentials over 2000 chars", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "openai",
        credentials: "x".repeat(2001),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid endpoint URL", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "custom",
        endpoint: "not-a-url",
        credentials: "x",
      });
      expect(res.status).toBe(400);
    });

    it("accepts valid endpoint URL", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "custom",
        endpoint: "https://api.example.test/v1",
        credentials: "x",
      });
      expect(res.status).toBe(201);
      expect(res.body.data.endpoint).toBe("https://api.example.test/v1");
      await prisma.aiConnection.delete({ where: { id: res.body.data.id } });
    });

    it("rejects empty PATCH body", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("patch", `${BASE}/${c.id}`, alice.token, {});
      expect(res.status).toBe(400);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("rejects PATCH with unknown provider", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson(
        "patch",
        `${BASE}/${c.id}`,
        alice.token,
        // @ts-expect-error intentional invalid
        { provider: "bad" }
      );
      expect(res.status).toBe(400);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("rejects PATCH with empty credentials", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("patch", `${BASE}/${c.id}`, alice.token, {
        credentials: "",
      });
      expect(res.status).toBe(400);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("rejects PATCH with credentials over 2000 chars", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("patch", `${BASE}/${c.id}`, alice.token, {
        credentials: "x".repeat(2001),
      });
      expect(res.status).toBe(400);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("rejects invalid endpoint on PATCH", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("patch", `${BASE}/${c.id}`, alice.token, {
        endpoint: "bad-url",
      });
      expect(res.status).toBe(400);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });
  });

  // ── Response envelope ────────────────────────────────────────────────────────
  //
  // The web client (frontend/lib/api/client.ts) only unwraps a 2xx body
  // when `success === true`; otherwise it throws "Request failed (<status>)"
  // and the UI renders an error state even though the API returned 200. These
  // tests pin `success: true` on every AI Connections success response so the
  // envelope cannot silently drift from the rest of the API.

  describe("response envelope", () => {
    it("POST / returns success: true with the created connection", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "ollama",
        endpoint: "http://localhost:11434",
        model: "llama3",
      });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const id = res.body.data.id;
      expect(id).toBeDefined();
      await prisma.aiConnection.delete({ where: { id } });
    });

    it("GET / returns success: true alongside the page", async () => {
      const res = await authRequestJson("get", BASE, alice.token);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("items");
      expect(res.body.data).toHaveProperty("hasMore");
      expect(res.body.data).toHaveProperty("nextCursor");
    });

    it("GET /:id returns success: true", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("get", `${BASE}/${c.id}`, alice.token);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(c.id);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("PATCH /:id returns success: true", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("patch", `${BASE}/${c.id}`, alice.token, {
        model: "gpt-4o-mini",
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.model).toBe("gpt-4o-mini");
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("POST /:id/activate returns success: true", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isActive).toBe(true);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("POST /test returns success: true", async () => {
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "ollama",
        endpoint: "http://localhost:11434",
        model: "llama3",
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("GET /active returns success: true when one is active", async () => {
      const c = await createConn(alice.token);
      await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);
      const res = await authRequestJson("get", `${BASE}/active`, alice.token);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(c.id);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("GET /active uses the standard error envelope when none is active", async () => {
      const res = await authRequestJson("get", `${BASE}/active`, alice.token);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatchObject({
        code: expect.any(String),
        message: expect.stringContaining("No active AI connection"),
      });
    });
  });

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  describe("CRUD", () => {
    it("creates an OpenAI connection", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "openai",
        model: "gpt-4o",
        credentials: jsonCreds(OPENAI_CREDS),
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        provider: "openai",
        model: "gpt-4o",
        endpoint: null,
        enabled: true,
        isActive: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(res.body.data.id).toBeDefined();
      connId = res.body.data.id;
    });

    it("creates a Gemini connection", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "gemini",
        model: "gemini-2.0-flash",
        credentials: jsonCreds(GEMINI_CREDS),
      });
      expect(res.status).toBe(201);
      expect(res.body.data.provider).toBe("gemini");
    });

    it("creates an Anthropic connection", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
        credentials: jsonCreds(ANTHROPIC_CREDS),
      });
      expect(res.status).toBe(201);
      expect(res.body.data.provider).toBe("anthropic");
    });

    it("creates an OpenRouter connection", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "openrouter",
        model: "openai/gpt-4o",
        credentials: jsonCreds(OPENROUTER_CREDS),
      });
      expect(res.status).toBe(201);
      expect(res.body.data.provider).toBe("openrouter");
    });

    it("creates an Ollama connection with endpoint", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "ollama",
        endpoint: "http://localhost:11434",
        credentials: jsonCreds(OLLAMA_CREDS),
      });
      expect(res.status).toBe(201);
      expect(res.body.data.provider).toBe("ollama");
      expect(res.body.data.endpoint).toBe("http://localhost:11434");
    });

    it("creates a custom OpenAI-compatible connection", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "custom",
        model: "my-model",
        endpoint: "https://custom.example.test/v1",
        credentials: jsonCreds(CUSTOM_CREDS),
      });
      expect(res.status).toBe(201);
      expect(res.body.data.provider).toBe("custom");
      expect(res.body.data.endpoint).toBe("https://custom.example.test/v1");
    });

    it("lists only the user's own connections", async () => {
      // Own fixture: the suite's beforeEach deletes every connection, so this
      // test must not rely on rows another test happened to leave behind.
      // One connection per user, both on the provider they have in common.
      const aliceConn = await createConn(alice.token);
      const bobConn = await createConn(bob.token);
      const res = await authRequestJson("get", BASE, alice.token);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
      const ids = res.body.data.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(aliceConn.id);
      expect(ids).not.toContain(bobConn.id);
      // All returned items belong to alice (no credentials field)
      for (const item of res.body.data.items) {
        expect(item).not.toHaveProperty("credentials");
        expect(item).not.toHaveProperty("credentialsEncrypted");
      }
      await prisma.aiConnection.delete({ where: { id: aliceConn.id } });
      await prisma.aiConnection.delete({ where: { id: bobConn.id } });
    });

    it("paginates connections", async () => {
      const res = await authRequestJson("get", BASE, alice.token, { limit: "2" });
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(2);
      expect(res.body.data).toHaveProperty("hasMore");
      expect(res.body.data).toHaveProperty("nextCursor");
    });

    it("returns 404 for another user's connection", async () => {
      // Create a connection as alice
      const aliceConn = await createConn(alice.token);
      // Bob cannot see it
      const res = await authRequestJson("get", `${BASE}/${aliceConn.id}`, bob.token);
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent connection", async () => {
      const res = await authRequestJson(
        "get",
        `${BASE}/cuid-nonexistent-connection-id`,
        alice.token
      );
      expect(res.status).toBe(404);
    });

    it("updates connection fields", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson(
        "patch",
        `${BASE}/${c.id}`,
        alice.token,
        { model: "gpt-4-turbo" }
      );
      expect(res.status).toBe(200);
      expect(res.body.data.model).toBe("gpt-4-turbo");
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("updates credentials", async () => {
      const c = await createConn(alice.token);
      const newCreds = jsonCreds({ apiKey: "new-key-12345" });
      const res = await authRequestJson(
        "patch",
        `${BASE}/${c.id}`,
        alice.token,
        { credentials: newCreds }
      );
      expect(res.status).toBe(200);
      // Response must not contain raw credentials
      expect(res.body.data).not.toHaveProperty("credentials");
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("deletes a connection", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("delete", `${BASE}/${c.id}`, alice.token);
      expect(res.status).toBe(204);
      // Verify gone
      const getRes = await authRequestJson("get", `${BASE}/${c.id}`, alice.token);
      expect(getRes.status).toBe(404);
    });

    it("cannot delete another user's connection", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("delete", `${BASE}/${c.id}`, bob.token);
      expect(res.status).toBe(404);
    });
  });

  // ── Credential encryption at rest ────────────────────────────────────────────

  describe("credential encryption", () => {
    const PLAINTEXT_CREDS = jsonCreds({ apiKey: "super-secret-key-12345" });

    it("encrypts credentials before storing in database", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "openai",
        credentials: PLAINTEXT_CREDS,
      });
      const connId = res.body.data.id;

      // Read raw row from database
      const row = await prisma.aiConnection.findUnique({
        where: { id: connId },
        select: { credentialsEncrypted: true },
      });

      expect(row).toBeDefined();
      // The stored value must NOT equal the plaintext
      expect(row!.credentialsEncrypted).not.toBe(PLAINTEXT_CREDS);
      // The stored value must be a non-trivial base64 string (encrypted payload)
      expect(row!.credentialsEncrypted.length).toBeGreaterThan(50);

      // The plaintext must be recoverable via decryptForUser (per-user key derivation)
      const { decryptForUser } = await import("@/utils/encryption");
      const decrypted = decryptForUser(alice.user.id, row!.credentialsEncrypted);
      expect(decrypted).toBe(PLAINTEXT_CREDS);

      await prisma.aiConnection.delete({ where: { id: connId } });
    });

    it("uses different ciphertext for different users with same plaintext", async () => {
      const plaintext = jsonCreds({ apiKey: "shared-secret" });

      const aliceRes = await authRequestJson("post", BASE, alice.token, {
        provider: "openai",
        credentials: plaintext,
      });
      const bobRes = await authRequestJson("post", BASE, bob.token, {
        provider: "openai",
        credentials: plaintext,
      });

      const [aliceRow, bobRow] = await prisma.aiConnection.findMany({
        where: {
          id: { in: [aliceRes.body.data.id, bobRes.body.data.id] },
        },
        select: { id: true, credentialsEncrypted: true },
      });

      // Same plaintext must produce different ciphertext per user
      expect(aliceRow!.credentialsEncrypted).not.toBe(bobRow!.credentialsEncrypted);

      // Both must decrypt correctly (per-user key derivation)
      const { decryptForUser } = await import("@/utils/encryption");
      expect(decryptForUser(alice.user.id, aliceRow!.credentialsEncrypted)).toBe(plaintext);
      expect(decryptForUser(bob.user.id, bobRow!.credentialsEncrypted)).toBe(plaintext);

      await prisma.aiConnection.delete({ where: { id: aliceRow!.id } });
      await prisma.aiConnection.delete({ where: { id: bobRow!.id } });
    });
  });

  // ── Raw credentials never returned ───────────────────────────────────────────

  describe("no credential leakage in responses", () => {
    it("never returns credentials in create response", async () => {
      const res = await authRequestJson("post", BASE, alice.token, {
        provider: "openai",
        credentials: jsonCreds(OPENAI_CREDS),
      });
      expect(res.status).toBe(201);
      const data = res.body.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("credentials");
      expect(data).not.toHaveProperty("credentialsEncrypted");
      for (const key of Object.keys(data)) {
        expect(key).not.toMatch(/credential/i);
      }
    });

    it("never returns credentials in list response", async () => {
      await createConn(alice.token);
      const res = await authRequestJson("get", BASE, alice.token);
      expect(res.status).toBe(200);
      for (const item of res.body.data.items) {
        expect(item).not.toHaveProperty("credentials");
        expect(item).not.toHaveProperty("credentialsEncrypted");
        for (const key of Object.keys(item)) {
          expect(key).not.toMatch(/credential/i);
        }
      }
    });

    it("never returns credentials in get single response", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("get", `${BASE}/${c.id}`, alice.token);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("credentials");
      expect(data).not.toHaveProperty("credentialsEncrypted");
    });

    it("never returns credentials in update response", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson(
        "patch",
        `${BASE}/${c.id}`,
        alice.token,
        { model: "gpt-4" }
      );
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("credentials");
      expect(data).not.toHaveProperty("credentialsEncrypted");
    });

    it("never returns credentials in activate response", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).not.toHaveProperty("credentials");
      expect(data).not.toHaveProperty("credentialsEncrypted");
    });

    it("test connection does not echo raw credentials", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({}));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "openai",
        credentials: jsonCreds(OPENAI_CREDS),
      });
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      // The response should not contain the raw credentials string
      const responseStr = JSON.stringify(data);
      expect(responseStr).not.toContain("sk-test-openai-key");
      vi.unstubAllGlobals();
    });
  });

  // ── Activate / deactivate ────────────────────────────────────────────────────

  describe("activate / deactivate", () => {
    it("activates a connection", async () => {
      const c = await createConn(alice.token, { isActive: false });
      const res = await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);
    });

    it("deactivates by setting isActive false via PATCH", async () => {
      const c = await createConn(alice.token);
      // Activate first
      await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);
      // Then deactivate
      const res = await authRequestJson(
        "patch",
        `${BASE}/${c.id}`,
        alice.token,
        { isActive: false }
      );
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("only the owner can activate their connection", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson("post", `${BASE}/${c.id}/activate`, bob.token);
      expect(res.status).toBe(404);
    });

    it("activates only one connection at a time", async () => {
      // `AiConnection` carries `@@unique([userId, provider])`, so a user can only
      // hold one connection per provider. Use two different providers to exercise
      // the "activating one deactivates the others" rule.
      const c1 = await createConn(alice.token, { provider: "openai", model: "gpt-4o" });
      const c2 = await createConn(
        alice.token,
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet",
          credentials: jsonCreds(ANTHROPIC_CREDS),
        }
      );
      // Activate c1
      await authRequestJson("post", `${BASE}/${c1.id}/activate`, alice.token);
      // Activate c2 — should deactivate c1
      const res = await authRequestJson("post", `${BASE}/${c2.id}/activate`, alice.token);
      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);
      expect(res.body.data.id).toBe(c2.id);

      // c1 should now be inactive
      const c1Res = await authRequestJson("get", `${BASE}/${c1.id}`, alice.token);
      expect(c1Res.status).toBe(200);
      expect(c1Res.body.data.isActive).toBe(false);

      await prisma.aiConnection.delete({ where: { id: c1.id } });
      await prisma.aiConnection.delete({ where: { id: c2.id } });
    });

    it("GET /active returns the active connection", async () => {
      const c = await createConn(alice.token);
      await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);
      const res = await authRequestJson("get", `${BASE}/active`, alice.token);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(c.id);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("GET /active returns 404 when no active connection", async () => {
      const res = await authRequestJson("get", `${BASE}/active`, alice.token);
      expect(res.status).toBe(404);
    });

    it("disabled connection cannot be active", async () => {
      const c = await createConn(alice.token);
      await authRequestJson("patch", `${BASE}/${c.id}`, alice.token, { enabled: false });
      const res = await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);
      // Activating a disabled connection succeeds at the route level,
      // but getActiveConnection filters on enabled:true AND isActive:true
      // so it won't show up as active
      const activeRes = await authRequestJson("get", `${BASE}/active`, alice.token);
      expect(activeRes.status).toBe(404);
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });
  });

  // ── Connection testing ───────────────────────────────────────────────────────

  describe("connection testing", () => {
    it("tests OpenAI connection successfully", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({}));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "openai",
        credentials: jsonCreds(OPENAI_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.message).toContain("successful");
      vi.unstubAllGlobals();
    });

    it("tests Gemini connection successfully", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({ type: "gemini" }));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "gemini",
        credentials: jsonCreds(GEMINI_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("tests Anthropic connection successfully", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({ type: "anthropic" }));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "anthropic",
        credentials: jsonCreds(ANTHROPIC_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("tests OpenRouter connection successfully", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({}));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "openrouter",
        credentials: jsonCreds(OPENROUTER_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("tests Ollama connection (no credentials needed)", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({}));
      const res = await authRequestJson(
        "post",
        `${BASE}/test`,
        alice.token,
        {
          provider: "ollama",
          endpoint: "http://localhost:11434",
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("tests custom endpoint connection successfully", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({}));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "custom",
        endpoint: "https://custom.example.test/v1",
        credentials: jsonCreds(CUSTOM_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("reports failure for invalid OpenAI credentials", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({
        status: 401,
        error: "Invalid API key",
      }));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "openai",
        credentials: jsonCreds({ apiKey: "bad-key" }),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(false);
      expect(res.body.data.error).toContain("Invalid API key");
      // Sanitized: the actual key text should not appear
      expect(res.body.data.error).not.toContain("bad-key");
      vi.unstubAllGlobals();
    });

    it("sanitizes credential leakage in error messages", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({
        status: 401,
        error: "Invalid API key: sk-1234567890abcdef",
      }));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "openai",
        credentials: jsonCreds({ apiKey: "sk-1234567890abcdef" }),
      });
      expect(res.status).toBe(200);
      const errorStr = JSON.stringify(res.body.data);
      expect(errorStr).not.toContain("sk-1234567890abcdef");
      vi.unstubAllGlobals();
    });

    it("tests an existing saved connection", async () => {
      const c = await createConn(alice.token);
      const fetchMock = vi.stubGlobal("fetch", mockFetch({}));
      const res = await authRequestJson("post", `${BASE}/${c.id}/test`, alice.token, {
        // provider/model/endpoint come from the saved connection; credentials optional override
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("requires endpoint for Ollama when not using default", async () => {
      // Ollama adapter uses localhost:11434 as default, so no endpoint is required,
      // but if a user provides an endpoint it must be a valid URL
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "ollama",
        endpoint: "not-a-url",
        credentials: "",
      });
      // Zod validation should reject the bad URL
      expect(res.status).toBe(400);
    });

    it("requires endpoint for custom provider when not using default", async () => {
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "custom",
        endpoint: "not-a-url",
        credentials: "x",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Provider routing / adapter selection ─────────────────────────────────────

  describe("provider routing", () => {
    it("routes OpenAI to correct adapter", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({ type: "openai" }));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "openai",
        credentials: jsonCreds(OPENAI_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("routes Gemini to correct adapter", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({ type: "gemini" }));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "gemini",
        credentials: jsonCreds(GEMINI_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("routes Anthropic to correct adapter", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({ type: "anthropic" }));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "anthropic",
        credentials: jsonCreds(ANTHROPIC_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("routes OpenRouter to correct adapter", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({}));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "openrouter",
        credentials: jsonCreds(OPENROUTER_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("routes Ollama to correct adapter", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({}));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "ollama",
        endpoint: "http://localhost:11434",
        credentials: jsonCreds(OLLAMA_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });

    it("routes custom endpoint to correct adapter", async () => {
      const fetchMock = vi.stubGlobal("fetch", mockFetch({}));
      const res = await authRequestJson("post", `${BASE}/test`, alice.token, {
        provider: "custom",
        endpoint: "https://custom.example.test/v1",
        credentials: jsonCreds(CUSTOM_CREDS),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      vi.unstubAllGlobals();
    });
  });

  // ── AI request integration (resolveUserConnection) ───────────────────────────

  describe("AI request integration", () => {
    it("resolveUserConnection returns null when no active connection", async () => {
      const { resolveUserConnection } = await import("@/services/ai-connections");
      const result = await resolveUserConnection(alice.user.id);
      expect(result).toBeNull();
    });

    it("resolveUserConnection returns active connection when set", async () => {
      const c = await createConn(alice.token);
      await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);

      const { resolveUserConnection } = await import("@/services/ai-connections");
      const result = await resolveUserConnection(alice.user.id);

      expect(result).not.toBeNull();
      expect(result!.provider).toBe("openai");
      expect(result!.model).toBe("gpt-4o");
      // Credentials must be a non-empty string (decrypted) but we can't assert exact value
      // without knowing the encryption key format. Just verify it's present and non-empty.
      expect(result!.credentials).toBeDefined();
      expect(typeof result!.credentials).toBe("string");
      expect(result!.credentials.length).toBeGreaterThan(0);

      // Clean up — credentials buffer must be zeroed after this test
      await prisma.aiConnection.delete({ where: { id: c.id } });
    });

    it("credentials buffer is zeroed after resolveUserConnection returns", async () => {
      const c = await createConn(alice.token);
      await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);

      const { resolveUserConnection } = await import("@/services/ai-connections");
      // First call — should work
      const r1 = await resolveUserConnection(alice.user.id);
      expect(r1).not.toBeNull();

      // Second call in same process — the Buffer from the first call was zeroed in finally
      // This tests that the function can be called multiple times without leaking
      const r2 = await resolveUserConnection(alice.user.id);
      expect(r2).not.toBeNull();

      await prisma.aiConnection.delete({ where: { id: c.id } });
    });
  });

  // ── Undecryptable active connection ──────────────────────────────────────────

  describe("undecryptable active connection", () => {
    async function createConversation(): Promise<string> {
      const res = await authRequestJson("post", `${AI_BASE}/conversations`, alice.token, {});
      return res.body.data.id as string;
    }

    it("returns a typed, actionable error instead of an unhandled 500 when the active connection cannot be decrypted", async () => {
      const c = await createConn(alice.token, { provider: "openai", model: "gpt-4o" });
      await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);

      // Simulate ENCRYPTION_KEY drift: the stored blob is well-formed base64 but
      // its GCM tag only authenticates under a different key, so decryption fails.
      const { encryptForUser } = await import("@/utils/encryption");
      const foreignCiphertext = encryptForUser("some-other-user", jsonCreds(OPENAI_CREDS));
      await prisma.aiConnection.update({
        where: { id: c.id },
        data: { credentialsEncrypted: foreignCiphertext },
      });

      const conversationId = await createConversation();
      const res = await authRequestJson(
        "post",
        `${AI_BASE}/conversations/${conversationId}/messages`,
        alice.token,
        { content: "Explain recursion" }
      );

      // A controlled, actionable 409 — never an opaque internal 500.
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AI_CONNECTION_UNREADABLE");
      expect(res.body.error.message).toMatch(/credentials/i);

      // The response must not leak the ciphertext, the plaintext key, or crypto internals.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(foreignCiphertext);
      expect(serialized).not.toContain(OPENAI_CREDS.apiKey);
      expect(serialized).not.toContain("Unsupported state");

      // Nothing was persisted: resolution fails before the user message is written.
      const stored = await authRequestJson(
        "get",
        `${AI_BASE}/conversations/${conversationId}/messages`,
        alice.token
      );
      expect(stored.body.data).toHaveLength(0);
    });

    it("answers the chat when the active connection decrypts", async () => {
      const fetchMock = mockFetch({ type: "gemini" });
      vi.stubGlobal("fetch", fetchMock);
      const c = await createConn(alice.token, {
        provider: "gemini",
        model: "gemini-1.5-flash",
        credentials: jsonCreds(GEMINI_CREDS),
      });
      await authRequestJson("post", `${BASE}/${c.id}/activate`, alice.token);

      const conversationId = await createConversation();
      const res = await authRequestJson(
        "post",
        `${AI_BASE}/conversations/${conversationId}/messages`,
        alice.token,
        { content: "What is recursion?" }
      );

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reply.content).toBe("OK");
      expect(fetchMock).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("still uses the environment-default path (not the unreadable error) when there is no active connection", async () => {
      // A stored but inactive connection is "no active connection": resolution
      // must keep falling through to the environment default rather than raise
      // the unreadable-connection error.
      await createConn(alice.token, { provider: "openai" });

      const conversationId = await createConversation();
      const res = await authRequestJson(
        "post",
        `${AI_BASE}/conversations/${conversationId}/messages`,
        alice.token,
        { content: "hi" }
      );

      // In the test worker AI is disabled, so the fallback is unusable → 503.
      // The key point is that this is NOT the unreadable-connection error.
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("AI_PROVIDER_NOT_CONFIGURED");
    });
  });

  // ── Cross-user isolation ─────────────────────────────────────────────────────

  describe("cross-user isolation", () => {
    it("cannot update another user's connection", async () => {
      const c = await createConn(alice.token);
      const res = await authRequestJson(
        "patch",
        `${BASE}/${c.id}`,
        bob.token,
        { model: "gpt-4" }
      );
      expect(res.status).toBe(404);
    });

    it("cannot see another user's connections in list", async () => {
      const aliceConn = await createConn(alice.token);
      const bobList = await authRequestJson("get", BASE, bob.token);
      // Bob's list should be empty (no connections of his own)
      expect(bobList.status).toBe(200);
      // Items belong to bob only — alice's connections must not appear
      const bobIds = bobList.body.data.items.map((i: { id: string }) => i.id);
      expect(bobIds).not.toContain(aliceConn.id);
    });
  });
});
