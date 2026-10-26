import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { prisma, registerAndLogin } from "./helpers";
import { AiProvider, resolveAiProvider } from "@/services/ai/provider";
import { runAgent } from "@/services/ai/agent";
import { confirmationStore } from "@/services/ai/confirmations";
import {
  appendWriteIntentNotice,
  hasWriteIntent,
  WRITE_INTENT_NOTICE,
} from "@/services/ai/write-intent";

// ─────────────────────────────────────────────────────────────────────────────
// Gap #33 — a write request that produces no proposal
// ─────────────────────────────────────────────────────────────────────────────
//
// A tool-capable model can narrate a change ("Shall I go ahead and create it?")
// while calling only read tools (or no tools at all). Nothing is written and no
// confirmation card exists, so the student is stranded. The agent now says so
// explicitly and reports `write_intent_unfulfilled` instead of a plain answer.

let user: { token: string; id: string };
let seedCounter = 0;

function scriptedFetch(turns: Array<Record<string, unknown>>) {
  let call = 0;
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const turn = turns[Math.min(call, turns.length - 1)];
    call += 1;
    return {
      ok: true,
      status: 200,
      json: async () => turn,
      text: async () => "",
    };
  });
  return { mock, get callCount() { return call; } };
}

function textTurn(content: string) {
  return { choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
}

function toolCallTurn(name: string, args: Record<string, unknown>, id = "call_1") {
  return {
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function openAiProvider(turns: Array<Record<string, unknown>>) {
  const script = scriptedFetch(turns);
  vi.stubGlobal("fetch", script.mock);
  return {
    provider: new AiProvider(resolveAiProvider("openai"), { apiKey: "sk-test" }, "https://provider.test.local", "test-model"),
    get callCount() { return script.callCount; },
  };
}

beforeEach(async () => {
  confirmationStore.reset();
  seedCounter += 1;
  const auth = await registerAndLogin(`write-intent-${seedCounter}@test.com`, "Pass123!");
  user = { token: auth.token, id: auth.user.id };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("hasWriteIntent", () => {
  it.each([
    "Add a task to finish my essay tomorrow",
    "please create a note called Lab 3",
    "Can you add a study session for Friday?",
    "Could you please delete the old task?",
    "I want you to update the due date",
    "I need to log a study session",
    "Let's schedule an exam reminder",
    "mark it complete",
    "set up a reminder for the midterm",
  ])("treats %j as a write request", (message) => {
    expect(hasWriteIntent(message)).toBe(true);
  });

  it.each([
    "How do I add a course?",
    "What tasks do I have this week?",
    "I added a task yesterday",
    "You should add a task for the essay",
    "Please don't delete my notes",
    "Is there a way to create a goal?",
    "Show me my schedule",
  ])("does not treat %j as a write request", (message) => {
    expect(hasWriteIntent(message)).toBe(false);
  });
});

describe("appendWriteIntentNotice", () => {
  it("appends once and never repeats the notice", () => {
    expect(appendWriteIntentNotice("Shall I?")).toBe(`Shall I?\n\n${WRITE_INTENT_NOTICE}`);
    expect(appendWriteIntentNotice(`Shall I?\n\n${WRITE_INTENT_NOTICE}`)).toBe(
      `Shall I?\n\n${WRITE_INTENT_NOTICE}`,
    );
    expect(appendWriteIntentNotice("   ")).toBe(WRITE_INTENT_NOTICE);
  });
});

describe("a write request that produced no proposal", () => {
  it("says nothing was prepared, reports the honest finish, and writes nothing", async () => {
    const before = await prisma.task.count({ where: { userId: user.id } });
    const harness = openAiProvider([textTurn("Shall I go ahead and create it?")]);

    const run = await runAgent({
      provider: harness.provider,
      userId: user.id,
      conversationId: "c-stranded",
      history: [],
      userMessage: "Add a task to finish my essay tomorrow",
    });

    expect(run.proposedActions).toEqual([]);
    expect(run.finish).toBe("write_intent_unfulfilled");
    expect(run.content).toContain("Shall I go ahead and create it?");
    expect(run.content).toContain(WRITE_INTENT_NOTICE);
    expect(await prisma.task.count({ where: { userId: user.id } })).toBe(before);
  });

  it("does not add the notice to a read-only question", async () => {
    const harness = openAiProvider([textTurn("You have one task due tomorrow.")]);

    const run = await runAgent({
      provider: harness.provider,
      userId: user.id,
      conversationId: "c-read",
      history: [],
      userMessage: "What tasks do I have this week?",
    });

    expect(run.finish).toBe("answered");
    expect(run.content).toBe("You have one task due tomorrow.");
  });

  it("does not add the notice in a mode that cannot write", async () => {
    const harness = openAiProvider([
      textTurn("This mode only reads your data. Switch to Auto or Agent to make changes."),
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: user.id,
      conversationId: "c-study",
      history: [],
      userMessage: "Add a task to finish my essay tomorrow",
      mode: "STUDY",
    });

    expect(run.finish).toBe("answered");
    expect(run.content).not.toContain(WRITE_INTENT_NOTICE);
  });

  it("does not add the notice when a proposal was actually prepared", async () => {
    const harness = openAiProvider([
      toolCallTurn("create_task", { title: "Finish my essay" }),
      textTurn("I've prepared that task for you."),
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: user.id,
      conversationId: "c-proposed",
      history: [],
      userMessage: "Add a task to finish my essay tomorrow",
    });

    expect(run.proposedActions).toHaveLength(1);
    expect(run.finish).toBe("confirmation_pending");
    expect(run.content).not.toContain(WRITE_INTENT_NOTICE);
  });
});
