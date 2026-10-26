// ─────────────────────────────────────────────────────────────────────
// Editing a question and regenerating an answer.
//
// Rewriting history is a truncation: everything after the point being
// rewritten is removed, and a fresh reply is generated. These tests cover the
// happy path, the ownership/role guards, and that no stale turn reaches the
// provider as history.
// ─────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

import { registerAndLogin, authRequestJson } from "./helpers";
import { getActiveUserConnection } from "@/services/ai-connections";
import { confirmationStore } from "@/services/ai/confirmations";

const BASE = "/api/v1";

let user: { token: string; id: string };
let seedCounter = 0;

function useFakeConnection() {
  vi.mocked(getActiveUserConnection).mockImplementation(async () => ({
    provider: "openai" as const,
    decryptedCredentials: { apiKey: "sk-test" },
    endpoint: "https://p.test",
    model: "test-model",
  }));
}

function textTurn(content: string) {
  return { choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
}

function scriptedFetch(turns: Array<Record<string, unknown>>) {
  let call = 0;
  const bodies: Array<Record<string, unknown>> = [];
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>);
    const turn = turns[Math.min(call, turns.length - 1)];
    call += 1;
    return { ok: true, status: 200, json: async () => turn, text: async () => "" };
  });
  vi.stubGlobal("fetch", mock);
  return { mock, bodies };
}

type TurnMessage = { role: string; content: string | Array<{ type: string; text?: string }> };
function messagesOf(body: Record<string, unknown>): TurnMessage[] {
  return (body.messages as TurnMessage[]) ?? [];
}

async function newConversation(): Promise<string> {
  const res = await authRequestJson("post", `${BASE}/ai/conversations`, user.token, { title: "Edit" });
  return res.body.data.id as string;
}

async function send(conversationId: string, content: string) {
  const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, user.token, { content });
  expect(res.status).toBe(201);
  return res.body.data as { message: { id: string; content: string }; reply: { id: string; content: string } };
}

async function listMessages(conversationId: string) {
  const res = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/messages`, user.token);
  return res.body.data as Array<{ id: string; role: string; content: string }>;
}

async function seedStudent() {
  seedCounter += 1;
  const auth = await registerAndLogin(`edit-${seedCounter}@test.com`, "Pass123!");
  return { token: auth.token, id: auth.user.id };
}

beforeEach(async () => {
  confirmationStore.reset();
  const seeded = await seedStudent();
  user = { token: seeded.token, id: seeded.id };
  useFakeConnection();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("editing a question rewrites the thread", () => {
  it("updates the question, drops everything after it, and regenerates a reply", async () => {
    const script = scriptedFetch([
      textTurn("First answer"),
      textTurn("Second answer"),
      textTurn("Edited answer"),
    ]);
    const conversationId = await newConversation();
    const first = await send(conversationId, "First question");
    await send(conversationId, "Second question");

    const res = await authRequestJson(
      "patch",
      `${BASE}/ai/conversations/${conversationId}/messages/${first.message.id}`,
      user.token,
      { content: "Edited first question" },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.reply.content).toBe("Edited answer");

    const after = await listMessages(conversationId);
    // Only the edited question and its fresh answer remain.
    expect(after.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(after[0].content).toBe("Edited first question");
    expect(after[1].content).toBe("Edited answer");

    // The provider saw the edit, and none of the discarded turns as history.
    const providerBody = JSON.stringify(messagesOf(script.bodies[2]));
    expect(providerBody).toContain("Edited first question");
    expect(providerBody).not.toContain("Second question");
    expect(providerBody).not.toContain("First answer");
  });

  it("refuses to edit an assistant message", async () => {
    scriptedFetch([textTurn("An answer")]);
    const conversationId = await newConversation();
    const turn = await send(conversationId, "A question");

    const res = await authRequestJson(
      "patch",
      `${BASE}/ai/conversations/${conversationId}/messages/${turn.reply.id}`,
      user.token,
      { content: "Rewrite your own words" },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not let another account edit the message", async () => {
    scriptedFetch([textTurn("An answer")]);
    const conversationId = await newConversation();
    const turn = await send(conversationId, "A question");

    const other = await seedStudent();
    const res = await authRequestJson(
      "patch",
      `${BASE}/ai/conversations/${conversationId}/messages/${turn.message.id}`,
      other.token,
      { content: "Hijacked" },
    );
    expect(res.status).toBe(404);
  });
});

describe("regenerating an answer replaces it in place", () => {
  it("regenerates the reply anchored to an assistant message", async () => {
    scriptedFetch([
      textTurn("First answer"),
      textTurn("Second answer"),
      textTurn("Regenerated second answer"),
    ]);
    const conversationId = await newConversation();
    await send(conversationId, "First question");
    const second = await send(conversationId, "Second question");

    const res = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/messages/${second.reply.id}/regenerate`,
      user.token,
      {},
    );
    expect(res.status).toBe(200);
    expect(res.body.data.reply.content).toBe("Regenerated second answer");

    const after = await listMessages(conversationId);
    expect(after.map((m) => m.role)).toEqual(["USER", "ASSISTANT", "USER", "ASSISTANT"]);
    expect(after[1].content).toBe("First answer");
    expect(after[3].content).toBe("Regenerated second answer");
    // The regenerated message is a new row, not an edit of the old one.
    expect(after[3].id).not.toBe(second.reply.id);
  });

  it("regenerating from a user message drops the stale reply", async () => {
    scriptedFetch([textTurn("Old answer"), textTurn("New answer")]);
    const conversationId = await newConversation();
    const turn = await send(conversationId, "Only question");

    const res = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/messages/${turn.message.id}/regenerate`,
      user.token,
      {},
    );
    expect(res.status).toBe(200);
    expect(res.body.data.reply.content).toBe("New answer");

    const after = await listMessages(conversationId);
    expect(after.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(after[0].content).toBe("Only question");
    expect(after[1].content).toBe("New answer");
  });

  it("does not let another account regenerate", async () => {
    scriptedFetch([textTurn("An answer")]);
    const conversationId = await newConversation();
    const turn = await send(conversationId, "A question");

    const other = await seedStudent();
    const res = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/messages/${turn.reply.id}/regenerate`,
      other.token,
      {},
    );
    expect(res.status).toBe(404);
  });
});
