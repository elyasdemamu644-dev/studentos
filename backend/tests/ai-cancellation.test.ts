// ─────────────────────────────────────────────────────────────────────
// Regression: "Stop" must cancel every upstream provider call a turn makes,
// including the final tool-free round the agent adds after the tool-call
// budget is spent — and a cancelled turn must never persist an assistant
// reply, while the student's own question is always kept.
// ─────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

import { prisma, registerAndLogin, authRequestJson } from "./helpers";
import { getActiveUserConnection } from "@/services/ai-connections";
import { aiService } from "@/services/ai/service";
import { runAgent } from "@/services/ai/agent";
import { AiProvider, resolveAiProvider } from "@/services/ai/provider";
import { confirmationStore } from "@/services/ai/confirmations";
import { createMessageSchema } from "@/schemas/ai";

const BASE = "/api/v1";

let user: { token: string; id: string };
let seedCounter = 0;

function abortError() {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
  } as unknown as Response;
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

/** Poll until `assertion` holds, or fail. Keeps tests free of fixed sleeps. */
async function waitFor(assertion: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!assertion()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function seedStudent() {
  seedCounter += 1;
  const auth = await registerAndLogin(`cancel-${seedCounter}@test.com`, "Pass123!");
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

async function newConversation() {
  const res = await authRequestJson("post", `${BASE}/ai/conversations`, user.token, { title: "Cancel" });
  return res.body.data.id as string;
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

describe("stopping generation cancels the whole turn", () => {
  it("passes the abort signal to the final tool-free round", async () => {
    // Turn 1 asks for a tool. With `maxRounds: 1` the loop then makes exactly
    // one final, tool-free turn — the round that used to drop the signal.
    let call = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      call += 1;
      if (call === 1) return Promise.resolve(jsonResponse(toolCallTurn("get_active_courses", { limit: 5 })));
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(jsonResponse(textTurn("a late reply that should never arrive"))), 200);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(abortError());
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AiProvider(
      resolveAiProvider("openai"),
      { apiKey: "sk-test-key" },
      "https://provider.test.local",
    );
    const controller = new AbortController();
    const conversationId = await newConversation();

    const run = runAgent({
      provider,
      userId: user.id,
      conversationId,
      history: [],
      userMessage: "What are my active courses?",
      maxRounds: 1,
      signal: controller.signal,
    });

    await waitFor(() => call >= 2);
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: "AiProviderCancelledError" });
  });

  it("keeps the question but stores no assistant reply when the first call is cancelled", async () => {
    let call = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      call += 1;
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(jsonResponse(textTurn("never in time"))), 200);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(abortError());
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const conversationId = await newConversation();
    const controller = new AbortController();
    const input = createMessageSchema.parse({ content: "A question I then cancel?" });

    const generation = aiService.addMessage(user.id, conversationId, input, controller.signal);

    await waitFor(() => call >= 1);
    controller.abort();

    await expect(generation).rejects.toMatchObject({ name: "AiProviderCancelledError" });

    const stored = await prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });
    expect(stored.filter((m) => m.role === "USER")).toHaveLength(1);
    expect(stored.filter((m) => m.role === "USER")[0].content).toBe("A question I then cancel?");
    expect(stored.filter((m) => m.role === "ASSISTANT")).toHaveLength(0);
  });
});
