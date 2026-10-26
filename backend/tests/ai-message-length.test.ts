// ─────────────────────────────────────────────────────────────────────
// Regression: a chat message accepted by the API must reach the provider
// whole — the tool-capable execution path must not silently clip the tail.
//
// The API accepts up to `MAX_MESSAGE_CONTENT_LENGTH` characters; the agent
// used to send only the first 4,000. These tests prove the full, persisted
// message is what the provider actually receives.
// ─────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// Give the service a *real* provider (real resolution) with only the
// credentials lookup faked, exactly as the other AI HTTP tests do.
vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

import { prisma, registerAndLogin, authRequestJson } from "./helpers";
import { getActiveUserConnection } from "@/services/ai-connections";
import { confirmationStore } from "@/services/ai/confirmations";
import { MAX_MESSAGE_CONTENT_LENGTH } from "@/schemas/ai";

const BASE = "/api/v1";

let user: { token: string; id: string };
let seedCounter = 0;

async function seedStudent() {
  seedCounter += 1;
  const auth = await registerAndLogin(`msg-length-${seedCounter}@test.com`, "Pass123!");
  return { token: auth.token, id: auth.user.id };
}

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

function toolCallTurn(name: string, args: Record<string, unknown>) {
  return {
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

/** A fetch stub that walks a script of provider turns and records the bodies. */
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
  return { mock, bodies, get callCount() { return call; } };
}

type WireMessage = { role: string; content: string | Array<{ type: string; text?: string }> };

function messagesOf(body: Record<string, unknown>): WireMessage[] {
  return (body.messages as WireMessage[]) ?? [];
}

function lastUserMessage(body: Record<string, unknown>): WireMessage {
  const users = messagesOf(body).filter((m) => m.role === "user");
  return users[users.length - 1];
}

async function newConversation() {
  const res = await authRequestJson("post", `${BASE}/ai/conversations`, user.token, { title: "Length" });
  return res.body.data.id as string;
}

/** A message of exactly `length` characters ending in a distinctive marker. */
function longMessage(marker: string, length: number): string {
  return `${"x".repeat(length - marker.length - 1)} ${marker}`;
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

describe("chat message length is not silently truncated", () => {
  it("delivers a message longer than 4,000 characters to the provider in full", async () => {
    const script = scriptedFetch([textTurn("OK")]);
    const conversationId = await newConversation();
    const content = longMessage("END_OF_MESSAGE", 5000);
    expect(content.length).toBe(5000);

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, user.token, {
      content,
    });
    expect(res.status).toBe(201);

    const sent = lastUserMessage(script.bodies[0]);
    // The whole message reaches the model, tail included.
    expect(sent.content).toBe(content);
    expect(String(sent.content)).toContain("END_OF_MESSAGE");
  });

  it("persists the complete message, not a clipped copy", async () => {
    scriptedFetch([textTurn("OK")]);
    const conversationId = await newConversation();
    const content = longMessage("PERSISTED_TAIL", 6000);

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, user.token, {
      content,
    });
    expect(res.status).toBe(201);

    const stored = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/messages`, user.token);
    const mine = stored.body.data.find((m: { role: string }) => m.role === "USER");
    expect(mine.content).toBe(content);
    expect(mine.content.length).toBe(content.length);
  });

  it("applies the same rule when an attachment is present", async () => {
    const script = scriptedFetch([textTurn("OK")]);
    const conversationId = await newConversation();
    const resource = await prisma.resource.create({
      data: {
        userId: user.id,
        title: "notes.zip",
        storageType: "UPLOAD",
        fileKey: "resources/notes.zip",
        fileName: "notes.zip",
        fileSize: 10,
        mimeType: "application/zip",
        resourceType: "OTHER",
      },
    });
    const content = longMessage("ATTACHMENT_MARKER", 5000);

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, user.token, {
      content,
      attachmentIds: [resource.id],
    });
    expect(res.status).toBe(201);

    const sent = lastUserMessage(script.bodies[0]);
    expect(Array.isArray(sent.content)).toBe(true);
    const textPart = (sent.content as Array<{ type: string; text?: string }>).find((p) => p.type === "text");
    // The user's own words survive untouched, and the file note rides along.
    expect(textPart?.text).toContain(content);
    expect(textPart?.text).toContain("not readable");
  });

  it("accepts a message exactly at the supported maximum and sends it whole", async () => {
    const script = scriptedFetch([textTurn("OK")]);
    const conversationId = await newConversation();
    const content = "m".repeat(MAX_MESSAGE_CONTENT_LENGTH);

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, user.token, {
      content,
    });
    expect(res.status).toBe(201);
    expect(lastUserMessage(script.bodies[0]).content).toBe(content);
  });

  it("rejects a message beyond the supported maximum with a clear error and stores nothing", async () => {
    scriptedFetch([textTurn("OK")]);
    const conversationId = await newConversation();
    const content = "m".repeat(MAX_MESSAGE_CONTENT_LENGTH + 1);

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, user.token, {
      content,
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    const stored = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/messages`, user.token);
    expect(stored.body.data).toHaveLength(0);
  });

  it("keeps a prior long turn intact when replaying conversation history", async () => {
    const conversationId = await newConversation();
    const prior = longMessage("PRIOR_TURN_MARKER", 5000);
    await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, user.token, {
      content: prior,
      generateReply: false,
    });

    const script = scriptedFetch([textTurn("OK")]);
    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, user.token, {
      content: "And now a short follow-up?",
    });
    expect(res.status).toBe(201);

    const transcript = messagesOf(script.bodies[0]).map((m) => String(m.content)).join("\n");
    expect(transcript).toContain("PRIOR_TURN_MARKER");
  });

  it("still runs tools and returns a reply for a long message", async () => {
    const script = scriptedFetch([
      toolCallTurn("get_active_courses", { limit: 5 }),
      textTurn("Here are your active courses."),
    ]);
    const conversationId = await newConversation();
    const content = longMessage("TOOL_MARKER", 5000);

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, user.token, {
      content,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.toolActivity[0]).toMatchObject({ tool: "get_active_courses", status: "success" });
    expect(String(lastUserMessage(script.bodies[0]).content)).toContain("TOOL_MARKER");
  });
});
