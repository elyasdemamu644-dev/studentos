import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import request from "supertest";

// The route-level tests hand the service a *real* provider (real resolution
// logic) whose connection is faked, so only the credentials lookup is stubbed
// (same harness as ai-tools.test.ts).
vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

import { app } from "@/app";
import { prisma, registerAndLogin, authRequestJson } from "./helpers";
import { getActiveUserConnection } from "@/services/ai-connections";

const BASE = "/api/v1";

// A typical client-supplied schema: extract a short study suggestion.
const SCHEMA = {
  type: "object",
  properties: {
    topic: { type: "string" },
    minutes: { type: "integer" },
  },
  required: ["topic", "minutes"],
  additionalProperties: false,
} as const;

/** Point provider resolution at a fake external OpenAI-compatible server. */
function useFakeConnection() {
  vi.mocked(getActiveUserConnection).mockImplementation(async (_userId) => ({
    provider: "openai" as const,
    decryptedCredentials: { apiKey: "sk-test" },
    endpoint: "https://provider.test.local",
    model: "test-model",
  }));
}

/** An OpenAI-compatible assistant turn that just speaks. */
function textTurn(content: string) {
  return { choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
}

/** A fetch stub that walks a script of provider turns and records bodies. */
function scriptedChat(turns: Array<Record<string, unknown>>) {
  let call = 0;
  const bodies: Array<Record<string, unknown>> = [];
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>);
    const turn = turns[Math.min(call, turns.length - 1)];
    call += 1;
    return {
      ok: true,
      status: 200,
      json: async () => turn,
      text: async () => "",
    };
  });
  vi.stubGlobal("fetch", mock);
  return { bodies, get callCount() { return call; } };
}

function wireMessages(body: Record<string, unknown>): Array<{ role: string; content: string | null }> {
  return body.messages as Array<{ role: string; content: string | null }>;
}

describe("AI structured extraction endpoint", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("structured@test.com", "Pass123!");
    token = auth.token;
    userId = auth.user.id;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns schema-validated JSON grounded in the student's own data", async () => {
    useFakeConnection();
    const script = scriptedChat([textTurn('{"topic":"Database design","minutes":45}')]);

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study next and for how long?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.result).toEqual({ topic: "Database design", minutes: 45 });
    expect(res.body.data.repaired).toBe(false);
    expect(res.body.data.provider).toBe("openai");
    expect(res.body.data.model).toBe("test-model");
    expect(script.callCount).toBe(1);

    // Grounding snapshot inlined as the first `system` message (no-tools path),
    // and the schema + task reach the model in the user turn.
    const messages = wireMessages(script.bodies[0]);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toMatch(/StudentOS data/);
    const user = messages.find((m) => m.role === "user");
    expect(user?.content).toMatch(/Required output schema/);
    expect(user?.content).toMatch(/What should I study next/);
  });

  it("makes one corrective retry when the first reply is not JSON", async () => {
    useFakeConnection();
    const script = scriptedChat([
      textTurn("Here is my recommendation: study databases."),
      textTurn('{"topic":"Database design","minutes":45}'),
    ]);

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study next and for how long?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.result).toEqual({ topic: "Database design", minutes: 45 });
    expect(res.body.data.repaired).toBe(true);
    expect(script.callCount).toBe(2);

    // The retry re-sends the task, the model's own bad reply, and a correction
    // that asks for ONLY JSON.
    const repairUser = wireMessages(script.bodies[1]).find((m) =>
      m.content?.includes("Your previous reply"),
    );
    expect(repairUser?.content).toMatch(/Reply again with ONLY a valid JSON/);
    expect(wireMessages(script.bodies[1]).some((m) => m.role === "assistant")).toBe(true);
  });

  it("accepts a reply wrapped in a markdown code fence on the first try", async () => {
    useFakeConnection();
    const script = scriptedChat([textTurn('```json\n{"topic":"Algebra","minutes":20}\n```')]);

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.result).toEqual({ topic: "Algebra", minutes: 20 });
    expect(res.body.data.repaired).toBe(false);
    expect(script.callCount).toBe(1);
  });

  it("answers 502 AI_STRUCTURED_OUTPUT_INVALID when the reply is never valid JSON", async () => {
    useFakeConnection();
    const script = scriptedChat([
      textTurn("I love studying databases!"),
      textTurn("Studying is the most fun thing!"),
    ]);

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study next and for how long?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_STRUCTURED_OUTPUT_INVALID");
    expect(script.callCount).toBe(2);
    // The fixed, controlled message never echoes the model's raw prose.
    expect(res.body.error.message).not.toMatch(/I love studying/);
    expect(res.body.error.message).not.toMatch(/<root>|field/);
  });

  it("answers 502 when valid JSON never matches the schema", async () => {
    useFakeConnection();
    scriptedChat([
      textTurn('{"title":"something else"}'),
      textTurn('{"title":"still wrong"}'),
    ]);

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study next and for how long?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_STRUCTURED_OUTPUT_INVALID");
  });

  it("omits the grounding snapshot when ground:false is sent", async () => {
    useFakeConnection();
    const script = scriptedChat([textTurn('{"topic":"DB revision","minutes":30}')]);

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: SCHEMA,
      ground: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.result).toEqual({ topic: "DB revision", minutes: 30 });
    const messages = wireMessages(script.bodies[0]);
    expect(messages.some((m) => m.role === "system")).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it("answers 503 AI_PROVIDER_NOT_CONFIGURED without a usable connection", async () => {
    vi.mocked(getActiveUserConnection).mockResolvedValue(null);

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_PROVIDER_NOT_CONFIGURED");
  });

  it("maps a non-2xx provider response to 502 AI_PROVIDER_ERROR without leaking keys", async () => {
    useFakeConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "server_error sk-test=secret: upstream refused",
        json: async () => ({}),
      })),
    );

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_PROVIDER_ERROR");
    expect(res.body.error.message).not.toMatch(/sk-test/);
    expect(res.body.error.message).not.toMatch(/at Object|Error:/);
  });

  it("maps an unusable provider completion to 502 AI_PROVIDER_ERROR", async () => {
    useFakeConnection();
    scriptedChat([{ choices: [] }]);

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("rejects a blank prompt", async () => {
    useFakeConnection();
    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "   ",
      schema: SCHEMA,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a schema that smuggles $ref or other unhandled keys", async () => {
    useFakeConnection();
    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: { ...SCHEMA, $ref: "#/definitions/thing" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a field that declares neither a type, enum nor anyOf", async () => {
    useFakeConnection();
    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: { type: "object", properties: { a: { description: "mystery" } } },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects schemas nested deeper than the supported depth", async () => {
    useFakeConnection();
    let deeplyNested: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 8; i += 1) {
      deeplyNested = { type: "object", properties: { a: deeplyNested }, required: ["a"] };
    }

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: deeplyNested,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post(`${BASE}/ai/structured`)
      .send({ prompt: "What should I study?", schema: SCHEMA });

    expect(res.status).toBe(401);
  });

  it("never writes data — a pure read path", async () => {
    useFakeConnection();
    const before = {
      tasks: await prisma.task.count({ where: { userId } }),
      courses: await prisma.course.count({ where: { userId } }),
      notes: await prisma.note.count({ where: { userId } }),
      goals: await prisma.goal.count({ where: { userId } }),
    };

    scriptedChat([textTurn('{"topic":"DB revision","minutes":30}')]);
    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(200);
    expect({
      tasks: await prisma.task.count({ where: { userId } }),
      courses: await prisma.course.count({ where: { userId } }),
      notes: await prisma.note.count({ where: { userId } }),
      goals: await prisma.goal.count({ where: { userId } }),
    }).toEqual(before);
  });

  it("resolves the provider for the authenticated student's account", async () => {
    useFakeConnection();
    scriptedChat([textTurn('{"topic":"DB revision","minutes":30}')]);

    const res = await authRequestJson("post", `${BASE}/ai/structured`, token, {
      prompt: "What should I study?",
      schema: SCHEMA,
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(getActiveUserConnection).mock.calls[0][0]).toBe(userId);
  });
});