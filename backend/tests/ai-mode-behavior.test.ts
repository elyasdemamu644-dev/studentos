import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { prisma, registerAndLogin } from "./helpers";
import { AiProvider, resolveAiProvider } from "@/services/ai/provider";
import { runAgent, MAX_TOOL_ROUNDS } from "@/services/ai/agent";
import { confirmationStore } from "@/services/ai/confirmations";
import { AI_MODE_EXECUTION, executionForMode, modeAllowsWrites } from "@/services/ai/mode-execution";
import { listTools, toolNeedsApproval } from "@/services/ai/tools/registry";

// ─────────────────────────────────────────────────────────────────────────────
// What a mode actually changes
// ─────────────────────────────────────────────────────────────────────────────
//
// The behaviour modes are not decoration: each one is enforced in the agent
// loop. These tests compare modes on the *same* request and assert the
// differences are real — the provider sees a different tool set, the loop gets a
// different budget, and a read-only mode cannot prepare a change — while the
// confirmation gate stays intact for every mode that can.

let user: { token: string; id: string };
let seedCounter = 0;

function scriptedFetch(turns: Array<Record<string, unknown>>) {
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
  return { mock, bodies, get callCount() { return call; } };
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

function openAiProvider(turns: Array<Record<string, unknown>>, model = "test-model") {
  const script = scriptedFetch(turns);
  vi.stubGlobal("fetch", script.mock);
  return {
    provider: new AiProvider(resolveAiProvider("openai"), { apiKey: "sk-test" }, "https://provider.test.local", model),
    bodies: script.bodies,
    get callCount() { return script.callCount; },
  };
}

function toolNamesIn(body: Record<string, unknown>): string[] {
  const tools = (body.tools as Array<{ function: { name: string } }> | undefined) ?? [];
  return tools.map((t) => t.function.name);
}

function systemPromptIn(body: Record<string, unknown>): string {
  const system = (body.messages as Array<{ role: string; content: string }>).find((m) => m.role === "system");
  return system?.content ?? "";
}

beforeEach(async () => {
  confirmationStore.reset();
  seedCounter += 1;
  const auth = await registerAndLogin(`mode-behavior-${seedCounter}@test.com`, "Pass123!");
  user = { token: auth.token, id: auth.user.id };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("mode execution profiles", () => {
  it("gives every selectable mode except AUTO a profile", () => {
    for (const mode of ["QUICK", "THINK", "BUILDER", "AGENT", "RESEARCH", "STUDY"] as const) {
      expect(executionForMode(mode), mode).toBeTruthy();
    }
    expect(executionForMode("AUTO")).toBeNull();
    expect(executionForMode(null)).toBeNull();
    expect(executionForMode(undefined)).toBeNull();
  });

  it("marks only the read-oriented modes as no-write", () => {
    const readOnly = (["QUICK", "THINK", "BUILDER", "AGENT", "RESEARCH", "STUDY"] as const)
      .filter((mode) => !modeAllowsWrites(mode));
    expect(readOnly.sort()).toEqual(["RESEARCH", "STUDY", "THINK"]);
    // AUTO may always write.
    expect(modeAllowsWrites("AUTO")).toBe(true);
  });

  it("keeps a read-only tool set free of WRITE tools (confirm excepted)", () => {
    const profile = AI_MODE_EXECUTION.STUDY;
    expect(profile.toolKinds).not.toContain("WRITE");
    for (const tool of listTools("WRITE")) {
      if (tool.name === "confirm_pending_actions") continue;
      expect(profile.toolKinds.includes(tool.kind)).toBe(false);
    }
  });
});

describe("autonomous execution boundary", () => {
  // This is the safety boundary: exactly these tools may change the student's
  // data without a click once they enable autonomous execution. Adding a tool
  // to it is a deliberate product decision, so the test fails until the list is
  // updated here too — and the list lives on the tool definitions, not beside
  // the gate, so it cannot drift away from what the tool actually does.
  const AUTONOMOUS_TOOLS = [
    "add_study_plan_entry",
    "create_artifact",
    "create_goal",
    "create_milestone",
    "create_note",
    "create_study_plan",
    "create_study_session",
    "create_subtask",
    "create_task",
    "create_task_tag",
    "save_memory",
  ];

  it("pins exactly which tools may run without approval", () => {
    const autonomous = listTools()
      .filter((tool) => tool.confirmation === "autonomous")
      .map((tool) => tool.name)
      .sort();
    expect(autonomous).toEqual(AUTONOMOUS_TOOLS);
  });

  it("only offers autonomous execution to WRITE tools", () => {
    for (const tool of listTools()) {
      if (tool.confirmation !== "autonomous") continue;
      expect(tool.kind, tool.name).toBe("WRITE");
    }
  });

  it("applies the same rule the catalog reports", () => {
    for (const tool of listTools()) {
      const shipsUnapproved = tool.kind === "WRITE" && tool.confirmation !== "self";
      expect(toolNeedsApproval(tool, false), `${tool.name} manual`).toBe(shipsUnapproved);
      expect(toolNeedsApproval(tool, true), `${tool.name} autonomous`).toBe(
        tool.kind === "WRITE" && (tool.confirmation ?? "required") === "required",
      );
    }
  });
});

describe("a mode changes the provider request", () => {
  it("hides WRITE tools in a read-only mode but keeps them in an acting mode", async () => {
    const acting = openAiProvider([textTurn("Done.")]);
    await runAgent({
      provider: acting.provider,
      userId: user.id,
      conversationId: "conv-agent",
      history: [],
      userMessage: "Add a task called Read chapter 4",
      mode: "AGENT",
    });
    expect(toolNamesIn(acting.bodies[0])).toContain("create_task");

    const studying = openAiProvider([textTurn("Here is how to study.")]);
    await runAgent({
      provider: studying.provider,
      userId: user.id,
      conversationId: "conv-study",
      history: [],
      userMessage: "Explain eigenvalues",
      mode: "STUDY",
    });
    const names = toolNamesIn(studying.bodies[0]);
    expect(names).not.toContain("create_task");
    expect(names).toContain("get_tasks");
    // The approval tool survives so a proposal made before the switch can be applied.
    expect(names).toContain("confirm_pending_actions");
  });

  it("adds the mode block for a non-AUTO mode and none for AUTO/unset", async () => {
    const quick = openAiProvider([textTurn("Ok.")]);
    await runAgent({ provider: quick.provider, userId: user.id, conversationId: "c-quick", history: [], userMessage: "hi", mode: "QUICK" });
    expect(systemPromptIn(quick.bodies[0])).toMatch(/MODE — QUICK/);

    const auto = openAiProvider([textTurn("Ok.")]);
    await runAgent({ provider: auto.provider, userId: user.id, conversationId: "c-auto", history: [], userMessage: "hi", mode: "AUTO" });
    expect(systemPromptIn(auto.bodies[0])).not.toContain("MODE —");

    const unset = openAiProvider([textTurn("Ok.")]);
    await runAgent({ provider: unset.provider, userId: user.id, conversationId: "c-none", history: [], userMessage: "hi" });
    expect(systemPromptIn(unset.bodies[0])).not.toContain("MODE —");
  });
});

describe("a mode changes the loop's budget", () => {
  it("caps QUICK at one round while the default runs to the ceiling", async () => {
    // The model only ever calls a tool, so the loop is stopped by its budget.
    const quick = openAiProvider([toolCallTurn("get_tasks", { status: "TODO" })]);
    const quickRun = await runAgent({
      provider: quick.provider,
      userId: user.id,
      conversationId: "c-quick-loop",
      history: [],
      userMessage: "Loop",
      mode: "QUICK",
    });
    expect(quickRun.finish).toBe("tool_limit");
    expect(quickRun.rounds).toBe(1);

    const auto = openAiProvider([toolCallTurn("get_tasks", { status: "TODO" })]);
    const autoRun = await runAgent({
      provider: auto.provider,
      userId: user.id,
      conversationId: "c-auto-loop",
      history: [],
      userMessage: "Loop",
    });
    expect(autoRun.finish).toBe("tool_limit");
    expect(autoRun.rounds).toBe(MAX_TOOL_ROUNDS);
    expect(autoRun.rounds).toBeGreaterThan(quickRun.rounds);
  });
});

describe("a read-only mode cannot prepare a change", () => {
  it("refuses a write the model calls anyway and writes nothing", async () => {
    // Even if a model ignores the hidden tool set and calls `create_task`, the
    // loop refuses it — the model is told to obey, not trusted to.
    const harness = openAiProvider([
      toolCallTurn("create_task", { title: "Sneaky task" }),
      textTurn("This mode is read-only."),
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: user.id,
      conversationId: "c-study-write",
      history: [],
      userMessage: "Add a task called Sneaky task",
      mode: "STUDY",
    });

    expect(run.proposedActions).toHaveLength(0);
    expect(run.finish).not.toBe("confirmation_pending");
    const refusal = run.toolActivity.find((a) => a.tool === "create_task");
    expect(refusal?.status).toBe("error");
    expect(refusal?.summary).toMatch(/does not change/i);
    expect(await prisma.task.count({ where: { userId: user.id, title: "Sneaky task" } })).toBe(0);
  });

  it("drops proposals from an ANALYZE tool in a read-only mode", async () => {
    // `build_study_plan` is ANALYZE but yields proposals; a read-only mode must
    // not surface them.
    const harness = openAiProvider([
      toolCallTurn("build_study_plan", { days: 7, sessionsPerDay: 1 }),
      textTurn("This mode is read-only."),
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: user.id,
      conversationId: "c-research-plan",
      history: [],
      userMessage: "Plan my week",
      mode: "RESEARCH",
    });

    expect(run.proposedActions).toHaveLength(0);
    const entry = run.toolActivity.find((a) => a.tool === "build_study_plan");
    expect(entry?.status).toBe("error");
  });

  it("still acts in an acting mode on the same request", async () => {
    const harness = openAiProvider([
      toolCallTurn("create_task", { title: "Sneaky task" }),
      textTurn("Shall I add that task?"),
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: user.id,
      conversationId: "c-agent-write",
      history: [],
      userMessage: "Add a task called Sneaky task",
      mode: "AGENT",
    });

    // The confirmation gate is untouched: it is proposed, never written.
    expect(run.finish).toBe("confirmation_pending");
    expect(run.proposedActions).toHaveLength(1);
    expect(await prisma.task.count({ where: { userId: user.id, title: "Sneaky task" } })).toBe(0);
  });
});
