import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The HTTP tests hand the service a *real* provider (real resolution logic)
// whose connection is faked, so only the credentials lookup is stubbed.
vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

import { prisma, registerAndLogin, authRequestJson } from "./helpers";
import { getActiveUserConnection } from "@/services/ai-connections";
import { AiProvider, resolveAiProvider } from "@/services/ai/provider";
import { runAgent, MAX_PROPOSED_ACTIONS, MAX_TOOL_CALLS, MAX_TOOL_ROUNDS } from "@/services/ai/agent";
import { confirmationStore, summarizeOutcomes, toPendingActionResponse } from "@/services/ai/confirmations";
import { executeProposalActions } from "@/services/ai/tools/confirm-tool";
import { verificationFields, verificationTools, verifyExecutedAction } from "@/services/ai/tools/verify";
import { eventsService } from "@/services/events";
import { tasksService } from "@/services/tasks";
import { zodToJsonSchema } from "@/services/ai/tools/json-schema";
import {
  executeTool,
  getProviderToolSchemas,
  getTool,
  getToolNames,
  listTools,
  registerTool,
} from "@/services/ai/tools/registry";
import type { AiToolDefinition, ProposedAction } from "@/services/ai/tools/types";

const BASE = "/api/v1";
const TOOLS_DIR = join(process.cwd(), "src", "services", "ai", "tools");

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

let userA: { token: string; id: string };
let userB: { token: string; id: string };
let courseA: string;
let courseB: string;

// The database is truncated once per file, so every seeded student needs its own
// address or a second `register` in the same file would collide.
let seedCounter = 0;

async function seedStudent(tag: string, courseCode: string, courseName: string) {
  seedCounter += 1;
  const email = `${tag}-${seedCounter}@test.com`;
  const auth = await registerAndLogin(email, "Pass123!");
  const year = await authRequestJson("post", `${BASE}/academics/years`, auth.token, {
    name: "2034-2035",
    startDate: "2034-09-01T00:00:00.000Z",
    endDate: "2035-06-30T00:00:00.000Z",
  });
  const sem = await authRequestJson("post", `${BASE}/academics/semesters`, auth.token, {
    name: "Fall 2034",
    academicYearId: year.body.data.id,
    startDate: "2034-09-01T00:00:00.000Z",
    endDate: "2034-12-15T00:00:00.000Z",
  });
  const course = await authRequestJson("post", `${BASE}/courses`, auth.token, {
    code: courseCode,
    name: courseName,
    credits: 3,
    semesterId: sem.body.data.id,
  });
  return { token: auth.token, id: auth.user.id, courseId: course.body.data.id as string };
}

/** Point provider resolution at a scripted fake for the authenticated student. */
function useFakeConnection() {
  vi.mocked(getActiveUserConnection).mockImplementation(async () => ({
    provider: "openai" as const,
    decryptedCredentials: { apiKey: "sk-test" },
    endpoint: "https://p.test",
    model: "test-model",
  }));
}

function ctxFor(user: { id: string }, conversationId = "conv-test", approvedActions: ProposedAction[] | null = null) {
  return { userId: user.id, conversationId, approvedActions };
}

/** A fetch stub that walks a script of provider turns. */
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
  return multiToolCallTurn([{ name, args, id }]);
}

/** One assistant turn that requests several tools at once. */
function multiToolCallTurn(calls: Array<{ name: string; args: Record<string, unknown>; id: string }>) {
  return {
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls.map(({ name, args, id }) => ({
            id,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          })),
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

beforeEach(async () => {
  confirmationStore.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Tool registry: registration and schemas", () => {
  it("registers a full, non-empty set of tools with unique names", () => {
    const names = getToolNames();
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses provider-safe snake_case names", () => {
    for (const name of getToolNames()) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("gives every tool a description, an activity label and a kind", () => {
    for (const tool of listTools()) {
      expect(tool.description.trim().length).toBeGreaterThan(10);
      expect(tool.activityLabel.trim().length).toBeGreaterThan(0);
      expect(["READ", "ANALYZE", "WRITE"]).toContain(tool.kind);
    }
  });

  it("marks every write tool as confirmation-gated", () => {
    for (const tool of listTools("WRITE")) {
      expect(tool.confirmation ?? "required").toMatch(/required|self/);
    }
  });

  it("exposes READ, ANALYZE and WRITE tools", () => {
    expect(listTools("READ").length).toBeGreaterThan(0);
    expect(listTools("ANALYZE").length).toBeGreaterThan(0);
    expect(listTools("WRITE").length).toBeGreaterThan(0);
  });

  it("converts every tool schema to valid provider JSON Schema", () => {
    const schemas = getProviderToolSchemas();
    expect(schemas.length).toBe(getToolNames().length);

    for (const schema of schemas) {
      expect(schema.type).toBe("function");
      expect(schema.function.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(schema.function.parameters.type).toBe("object");
      // The parse strips unknown keys, so the model is told up front.
      expect(schema.function.parameters.additionalProperties).toBe(false);
      expect(typeof schema.function.parameters.properties).toBe("object");
    }
  });

  it("lists only non-optional fields as required", () => {
    const schema = getProviderToolSchemas(["create_task"])[0];
    expect(schema.function.parameters.required).toContain("title");
    expect(schema.function.parameters.required ?? []).not.toContain("courseId");
  });

  it("refuses to register a duplicate or badly named tool", () => {
    expect(() =>
      registerTool({ ...(getTool("get_courses") as AiToolDefinition), name: "get_courses" }),
    ).toThrow(/already registered/);

    expect(() =>
      registerTool({ ...(getTool("get_courses") as AiToolDefinition), name: "Bad Name" }),
    ).toThrow(/Invalid AI tool name/);
  });

  it("never lets a tool accept a userId argument", () => {
    for (const tool of listTools()) {
      const properties = zodToJsonSchema(tool.parameters).properties ?? {};
      for (const key of Object.keys(properties)) {
        expect(key.toLowerCase()).not.toBe("userid");
        expect(key.toLowerCase()).not.toBe("studentid");
      }
    }
  });

  it("keeps Prisma out of the tool layer", () => {
    for (const file of readdirSync(TOOLS_DIR)) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(join(TOOLS_DIR, file), "utf8");
      expect(source).not.toMatch(/from\s+["']@\/lib\/prisma["']/);
      expect(source).not.toMatch(/from\s+["']@prisma\/client["']/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Tool registry: argument handling", () => {
  it("refuses an unknown tool with a readable message", async () => {
    const result = await executeTool({ name: "drop_database", arguments: {} }, ctxFor({ id: "u1" }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unknown_tool");
    expect(result.error?.message).toContain("get_courses");
  });

  it("refuses arguments that are not valid JSON", async () => {
    const result = await executeTool({ name: "get_courses", arguments: "{not json" }, ctxFor({ id: "u1" }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_arguments");
  });

  it("refuses a non-object argument payload", async () => {
    const result = await executeTool({ name: "get_courses", arguments: "[1,2,3]" }, ctxFor({ id: "u1" }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_arguments");
  });

  it("treats null/empty arguments as no arguments", async () => {
    const result = await executeTool({ name: "get_courses", arguments: null }, ctxFor({ id: "u1" }));
    // The call itself was well-formed; the student simply has no courses yet.
    expect(result.error).toBeUndefined();
  });

  it("reports schema violations with the offending field", async () => {
    const result = await executeTool(
      { name: "create_task", arguments: { priority: "SUPER_URGENT" } },
      ctxFor({ id: "u1" }),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_arguments");
    expect(result.error?.message).toContain("priority");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Tools against real data: scoping, reads and analysis", () => {
  beforeEach(async () => {
    const a = await seedStudent("tools-a", "DB301", "Database Systems");
    const b = await seedStudent("tools-b", "MATH201", "Linear Algebra");
    userA = { token: a.token, id: a.id };
    userB = { token: b.token, id: b.id };
    courseA = a.courseId;
    courseB = b.courseId;
  });

  it("scopes reads to the authenticated user", async () => {
    await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "A task", courseId: courseA });
    await authRequestJson("post", `${BASE}/tasks`, userB.token, { title: "B task", courseId: courseB });

    const result = await executeTool({ name: "get_tasks", arguments: { status: "TODO" } }, ctxFor(userA));
    expect(result.ok).toBe(true);
    const data = result.data as { items: Array<{ title: string }> };
    expect(data.items.map((t) => t.title)).toEqual(["A task"]);
  });

  it("strips a model-supplied userId so it cannot widen the scope", async () => {
    await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "A task" });
    await authRequestJson("post", `${BASE}/tasks`, userB.token, { title: "B secret task" });

    const result = await executeTool(
      { name: "get_tasks", arguments: { status: "TODO", userId: userB.id } },
      ctxFor(userA),
    );
    expect(result.ok).toBe(true);
    const data = result.data as { items: Array<{ title: string }> };
    expect(data.items.map((t) => t.title)).toEqual(["A task"]);
  });

  it("reads courses, dashboard and priorities for the student", async () => {
    await authRequestJson("post", `${BASE}/tasks`, userA.token, {
      title: "Lab report",
      courseId: courseA,
      dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    });

    const courses = await executeTool({ name: "get_courses", arguments: {} }, ctxFor(userA));
    expect(courses.ok).toBe(true);
    expect((courses.data as { items: unknown[] }).items).toHaveLength(1);

    const dashboard = await executeTool({ name: "get_academic_dashboard", arguments: {} }, ctxFor(userA));
    expect(dashboard.ok).toBe(true);

    const priorities = await executeTool({ name: "identify_upcoming_priorities", arguments: {} }, ctxFor(userA));
    expect(priorities.ok).toBe(true);
  });

  it("honours the limit a tool was given", async () => {
    for (let i = 0; i < 5; i += 1) {
      await authRequestJson("post", `${BASE}/notes`, userA.token, { title: `Note ${i}`, content: "x" });
    }
    const result = await executeTool({ name: "get_notes", arguments: { limit: 2 } }, ctxFor(userA));
    expect(result.ok).toBe(true);
    expect((result.data as { items: unknown[] }).items).toHaveLength(2);
  });

  it("builds a study plan without creating anything", async () => {
    const before = await prisma.studySession.count({ where: { userId: userA.id } });
    const tasksBefore = await prisma.task.count({ where: { userId: userA.id } });

    const result = await executeTool(
      { name: "build_study_plan", arguments: { courseId: courseA, days: 3, sessionsPerDay: 1, includeTasks: true } },
      ctxFor(userA),
    );

    expect(result.ok).toBe(true);
    expect(result.proposedActions?.length).toBeGreaterThan(0);
    expect(result.proposedActions?.every((a) => a.tool.startsWith("create_"))).toBe(true);

    expect(await prisma.studySession.count({ where: { userId: userA.id } })).toBe(before);
    expect(await prisma.task.count({ where: { userId: userA.id } })).toBe(tasksBefore);
  });

  it("analyses academic progress and study consistency", async () => {
    const progress = await executeTool({ name: "analyze_academic_progress", arguments: {} }, ctxFor(userA));
    expect(progress.ok).toBe(true);

    const consistency = await executeTool({ name: "analyze_study_consistency", arguments: {} }, ctxFor(userA));
    expect(consistency.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("WRITE tools and the confirmation gate", () => {
  beforeEach(async () => {
    const a = await seedStudent("write-a", "CS210", "Algorithms");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    const b = await seedStudent("write-b", "BIO100", "Biology");
    userB = { token: b.token, id: b.id };
    courseB = b.courseId;
  });

  it("refuses a write that was not approved and creates nothing", async () => {
    const result = await executeTool(
      { name: "create_task", arguments: { title: "Unapproved task" } },
      ctxFor(userA),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Unapproved task" } })).toBe(0);
  });

  it("returns the pending call so it can be proposed for approval", async () => {
    const result = await executeTool(
      { name: "create_task", arguments: { title: "Review chapter 4" } },
      ctxFor(userA),
    );
    expect(result.proposedActions).toHaveLength(1);
    expect(result.proposedActions?.[0].tool).toBe("create_task");
    expect(result.proposedActions?.[0].arguments).toEqual({ title: "Review chapter 4" });
  });

  it("runs an approved write and creates the record", async () => {
    const approved: ProposedAction[] = [
      { tool: "create_task", description: "create", arguments: { title: "Approved task" } },
    ];
    const result = await executeTool(
      { name: "create_task", arguments: { title: "Approved task" } },
      ctxFor(userA, "conv-1", approved),
    );

    expect(result.ok).toBe(true);
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Approved task" } })).toBe(1);
  });

  it("rejects an approved call whose arguments were widened", async () => {
    const approved: ProposedAction[] = [
      { tool: "create_task", description: "create", arguments: { title: "Safe title" } },
    ];
    const result = await executeTool(
      { name: "create_task", arguments: { title: "Different title" } },
      ctxFor(userA, "conv-1", approved),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Different title" } })).toBe(0);
  });

  it("will not let one approved action unlock a different tool", async () => {
    const approved: ProposedAction[] = [
      { tool: "create_task", description: "create", arguments: { title: "Only this one" } },
    ];
    const result = await executeTool(
      { name: "create_note", arguments: { title: "Sneaky", content: "x" } },
      ctxFor(userA, "conv-1", approved),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");
    expect(await prisma.note.count({ where: { userId: userA.id } })).toBe(0);
  });

  it("gates every write tool, not just create_task", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Existing" });
    const goal = await authRequestJson("post", `${BASE}/goals`, userA.token, { title: "Existing goal" });

    const attempts = [
      { name: "update_task", arguments: { taskId: task.body.data.id, title: "Renamed" } },
      { name: "complete_task", arguments: { taskId: task.body.data.id } },
      { name: "create_study_session", arguments: { startedAt: new Date().toISOString(), topic: "x" } },
      { name: "update_study_session", arguments: { sessionId: "x", topic: "y" } },
      { name: "create_goal", arguments: { title: "New goal" } },
      { name: "update_goal_progress", arguments: { goalId: goal.body.data.id, progress: 50 } },
      { name: "create_note", arguments: { title: "n", content: "c" } },
      { name: "create_resource", arguments: { title: "r", url: "https://example.com" } },
    ];

    for (const attempt of attempts) {
      const result = await executeTool(attempt, ctxFor(userA));
      expect(result.error?.code, `${attempt.name} must be gated`).toBe("confirmation_required");
    }

    expect(await prisma.goal.count({ where: { userId: userA.id } })).toBe(1);
    expect(await prisma.note.count({ where: { userId: userA.id } })).toBe(0);
    expect(await prisma.resource.count({ where: { userId: userA.id } })).toBe(0);
  });

  it("completes a task once approved", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Finish me" });
    const result = await executeTool(
      { name: "complete_task", arguments: { taskId: task.body.data.id } },
      ctxFor(userA, "conv-2", [{ tool: "complete_task", description: "c", arguments: { taskId: task.body.data.id } }]),
    );

    expect(result.ok).toBe(true);
    const stored = await prisma.task.findUnique({ where: { id: task.body.data.id } });
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.completedAt).not.toBeNull();
  });

  it("fails safely when an approved write targets another user's record", async () => {
    const otherTask = await authRequestJson("post", `${BASE}/tasks`, userB.token, { title: "Not yours" });
    const result = await executeTool(
      { name: "complete_task", arguments: { taskId: otherTask.body.data.id } },
      ctxFor(userA, "conv-3", [
        { tool: "complete_task", description: "c", arguments: { taskId: otherTask.body.data.id } },
      ]),
    );

    expect(result.ok).toBe(false);
    const stored = await prisma.task.findUnique({ where: { id: otherTask.body.data.id } });
    expect(stored?.status).toBe("TODO");
  });

  it("never leaks an internal error message on failure", async () => {
    const result = await executeTool(
      { name: "update_task", arguments: { taskId: "does-not-exist" } },
      ctxFor(userA, "conv-4", [
        { tool: "update_task", description: "u", arguments: { taskId: "does-not-exist" } },
      ]),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).not.toMatch(/prisma|SQL|stack|at Object/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Confirmation store", () => {
  const action: ProposedAction = { tool: "create_task", description: "d", arguments: { title: "t" } };

  it("creates, reads and consumes a proposal", () => {
    const created = confirmationStore.create({
      userId: "u1",
      conversationId: "c1",
      title: "Plan",
      actions: [action],
    });
    expect(confirmationStore.getPending("u1", "c1")?.id).toBe(created.id);
    expect(confirmationStore.consume("u1", "c1", created.id)).not.toBeNull();
    expect(confirmationStore.consume("u1", "c1", created.id)).toBeNull();
  });

  it("cannot be consumed from another user or conversation", () => {
    const created = confirmationStore.create({
      userId: "u1",
      conversationId: "c1",
      title: "Plan",
      actions: [action],
    });
    expect(confirmationStore.consume("u2", "c1", created.id)).toBeNull();
    expect(confirmationStore.consume("u1", "other", created.id)).toBeNull();
    expect(confirmationStore.getPending("u1", "c1")?.id).toBe(created.id);
  });

  it("supersedes an earlier pending proposal", () => {
    const first = confirmationStore.create({ userId: "u1", conversationId: "c1", title: "First", actions: [action] });
    const second = confirmationStore.create({ userId: "u1", conversationId: "c1", title: "Second", actions: [action] });

    expect(confirmationStore.get("u1", "c1", first.id)?.status).toBe("SUPERSEDED");
    expect(confirmationStore.getPending("u1", "c1")?.id).toBe(second.id);
  });

  it("cancels without executing, and cancel is idempotent", async () => {
    const created = confirmationStore.create({ userId: "u1", conversationId: "c1", title: "Plan", actions: [action] });
    expect(confirmationStore.cancel("u1", "c1", created.id)?.status).toBe("CANCELLED");
    expect(confirmationStore.cancel("u1", "c1", created.id)?.status).toBe("CANCELLED");
    expect(confirmationStore.getPending("u1", "c1")).toBeNull();
  });

  it("omits the internal userId from the wire shape", () => {
    const created = confirmationStore.create({ userId: "u1", conversationId: "c1", title: "Plan", actions: [action] });
    expect(JSON.stringify(toPendingActionResponse(created))).not.toContain("u1");
    expect(toPendingActionResponse(created)).not.toHaveProperty("userId");
  });

  it("returns null for no pending action", () => {
    expect(toPendingActionResponse(null)).toBeNull();
  });

  it("expires a proposal after the TTL so a stale confirm cannot fire", () => {
    const created = confirmationStore.create({
      userId: "u1",
      conversationId: "c1",
      title: "Plan",
      actions: [action],
    });

    // Simulate a proposal that is already past its TTL by backdating it.
    const past = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    created.createdAt = past;
    created.expiresAt = past;

    // getPending sweeps expired proposals, so it should return null.
    expect(confirmationStore.getPending("u1", "c1")).toBeNull();
    // The expired proposal is gone from the store entirely.
    expect(confirmationStore.get("u1", "c1", created.id)).toBeNull();
  });

  it("does not let a consumed proposal be consumed again", () => {
    const created = confirmationStore.create({
      userId: "u1",
      conversationId: "c1",
      title: "Plan",
      actions: [action],
    });

    const first = confirmationStore.consume("u1", "c1", created.id);
    expect(first?.status).toBe("EXECUTED");

    // Second consume returns null — the proposal is no longer PENDING.
    const second = confirmationStore.consume("u1", "c1", created.id);
    expect(second).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Agent loop", () => {
  beforeEach(async () => {
    const a = await seedStudent("agent", "HIST101", "World History");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    await authRequestJson("post", `${BASE}/tasks`, userA.token, {
      title: "Essay draft",
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    });
  });

  it("sends the tool schema and feeds the tool result back to the model", async () => {
    const harness = openAiProvider([
      toolCallTurn("get_tasks", { status: "TODO" }),
      textTurn("Your essay draft is due tomorrow."),
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: userA.id,
      conversationId: "conv-agent-1",
      history: [],
      userMessage: "What should I do today?",
    });

    expect(run.finish).toBe("answered");
    expect(run.usedTools).toBe(true);
    expect(run.toolActivity[0]).toMatchObject({ tool: "get_tasks", status: "success" });
    expect(run.content).toContain("essay draft");

    // First request advertised the tools.
    expect(Array.isArray(harness.bodies[0].tools)).toBe(true);
    // Second request carried the tool result back.
    const followUp = harness.bodies[1].messages as Array<{ role: string; content: string }>;
    const toolMessage = followUp.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("Essay draft");
  });

  it("stops at the round limit when the model only calls tools", async () => {
    const harness = openAiProvider([toolCallTurn("get_tasks", { status: "TODO" })]);

    const run = await runAgent({
      provider: harness.provider,
      userId: userA.id,
      conversationId: "conv-agent-2",
      history: [],
      userMessage: "Loop forever",
    });

    expect(run.finish).toBe("tool_limit");
    expect(run.rounds).toBe(MAX_TOOL_ROUNDS);
    // Bounded: at most one final tool-free turn beyond the loop.
    expect(harness.callCount).toBeLessThanOrEqual(MAX_TOOL_ROUNDS + 1);
  });

  it("drops the excess when one turn asks for more tool calls than the budget allows", async () => {
    // One round, 30 calls against a budget of 12. Running them all would let a
    // single turn fan out into hundreds of reads, so the surplus is dropped and
    // the model is told, rather than silently truncated to a set it believes
    // is complete.
    const many = Array.from({ length: 30 }, (_, i) =>
      toolCallTurn("get_tasks", { status: "TODO" }, `call_${i}`),
    );
    const harness = openAiProvider([
      multiToolCallTurn(
        Array.from({ length: 30 }, (_, i) => ({
          name: "get_tasks",
          args: { status: "TODO" },
          id: `call_${i}`,
        })),
      ),
      ...many,
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: userA.id,
      conversationId: "conv-agent-calls",
      history: [],
      userMessage: "Read everything",
      maxRounds: 1,
    });

    expect(run.toolActivity).toHaveLength(MAX_TOOL_CALLS);
    expect(run.content).toMatch(new RegExp(`${MAX_TOOL_CALLS} tool calls`));

    // Only the calls that fit were sent back to the provider as tool results;
    // the 18 dropped ones were never executed.
    const results = (harness.bodies[1].messages as Array<{ role: string }>).filter(
      (m) => m.role === "tool",
    );
    expect(results).toHaveLength(MAX_TOOL_CALLS);
  });

  it("refuses further writes once the proposal budget is spent", async () => {
    // A model that keeps writing must not be able to bury the student under an
    // unbounded confirmation list. After the limit the run stops and says so.
    const writes = Array.from({ length: 12 }, (_, i) =>
      toolCallTurn("create_task", { title: `Runaway ${i}` }, `call_${i}`),
    );
    const harness = openAiProvider([
      multiToolCallTurn(
        Array.from({ length: 12 }, (_, i) => ({
          name: "create_task",
          args: { title: `Runaway ${i}` },
          id: `call_${i}`,
        })),
      ),
      ...writes,
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: userA.id,
      conversationId: "conv-agent-writes",
      history: [],
      userMessage: "Create twelve tasks",
      maxRounds: 4,
    });

    expect(run.proposedActions.length).toBeLessThanOrEqual(MAX_PROPOSED_ACTIONS);
    expect(run.finish).toBe("confirmation_pending");
    expect(run.content).toMatch(/limit for one turn/i);

    // Nothing was written: the writes are still proposals, not records.
    expect(await prisma.task.count({ where: { userId: userA.id, title: { startsWith: "Runaway" } } })).toBe(0);
  });

  it("proposes a write instead of performing it, then stops calling tools", async () => {
    const harness = openAiProvider([
      toolCallTurn("create_task", { title: "Start revision tonight" }),
      textTurn("Shall I add that task?"),
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: userA.id,
      conversationId: "conv-agent-3",
      history: [],
      userMessage: "Add a task to start revising tonight",
    });

    expect(run.finish).toBe("confirmation_pending");
    expect(run.proposedActions[0].arguments).toEqual({ title: "Start revision tonight" });
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Start revision tonight" } })).toBe(0);
    expect(run.content.toLowerCase()).toContain("task");

    // The follow-up turn must be tool-free: `tool_choice: "none"`.
    expect(harness.bodies[1].tool_choice).toBe("none");
  });

  it("reports a failing tool to the model instead of throwing", async () => {
    const harness = openAiProvider([
      toolCallTurn("get_tasks", { priority: "NOPE" }),
      textTurn("I could not read your tasks with that filter."),
    ]);

    const run = await runAgent({
      provider: harness.provider,
      userId: userA.id,
      conversationId: "conv-agent-4",
      history: [],
      userMessage: "Show tasks",
    });

    expect(run.toolActivity[0].status).toBe("error");
    expect(run.content).toContain("could not read");
  });

  it("produces a real answer when a tool-calling model returns no prose", async () => {
    const harness = openAiProvider([toolCallTurn("get_courses", {})]);

    const run = await runAgent({
      provider: harness.provider,
      userId: userA.id,
      conversationId: "conv-agent-5",
      history: [],
      userMessage: "List my courses",
    });

    expect(run.content.length).toBeGreaterThan(0);
  });

  it("uses the grounded legacy path for a provider without tool support", async () => {
    // Gemini speaks its own shape: `candidates[].content.parts[].text`.
    const script = scriptedFetch([
      { candidates: [{ content: { role: "model", parts: [{ text: "Here is your grounded summary." }] } }] },
    ]);
    vi.stubGlobal("fetch", script.mock);
    const gemini = new AiProvider(
      resolveAiProvider("gemini"),
      { apiKey: "test" },
      "https://gemini.test.local",
      "gemini-2.0-flash",
    );

    const run = await runAgent({
      provider: gemini,
      userId: userA.id,
      conversationId: "conv-agent-6",
      history: [],
      userMessage: "How am I doing?",
      context: JSON.stringify({ studentos: { courses: [] } }),
    });

    expect(run.finish).toBe("no_tool_support");
    expect(run.usedTools).toBe(false);
    expect(run.toolActivity).toEqual([]);
    expect(run.content).toBe("Here is your grounded summary.");
    // The legacy path never advertises tools.
    expect(script.bodies[0]).not.toHaveProperty("tools");
  });

  it("never sends a model-invented userId to a tool", async () => {
    const harness = openAiProvider([
      toolCallTurn("get_tasks", { status: "TODO", userId: "someone-else" }),
      textTurn("Only your own tasks."),
    ]);

    await runAgent({
      provider: harness.provider,
      userId: userA.id,
      conversationId: "conv-agent-7",
      history: [],
      userMessage: "My tasks",
    });

    const followUp = harness.bodies[1].messages as Array<{ role: string; content: string }>;
    expect(followUp.find((m) => m.role === "tool")?.content).toContain("Essay draft");
    expect(followUp.find((m) => m.role === "tool")?.content).not.toContain("someone-else");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Provider tool-call support", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("declares native tool support per adapter", () => {
    expect(resolveAiProvider("openai").supportsNativeTools).toBe(true);
    expect(resolveAiProvider("openrouter").supportsNativeTools).toBe(true);
    expect(resolveAiProvider("ollama").supportsNativeTools).toBe(true);
    expect(resolveAiProvider("gemini").supportsNativeTools).toBe(false);
    expect(resolveAiProvider("anthropic").supportsNativeTools).toBe(false);
  });

  it("omits the tools key entirely on a no-tools request", async () => {
    const script = scriptedFetch([textTurn("hi")]);
    vi.stubGlobal("fetch", script.mock);
    const provider = new AiProvider(resolveAiProvider("openai"), { apiKey: "k" }, "https://p.test");

    await provider.chatWithTools({ messages: [{ role: "user", content: "hi" }] });
    expect(script.bodies[0]).not.toHaveProperty("tools");
  });

  it("sends tool schemas and tool_choice when asked", async () => {
    const script = scriptedFetch([textTurn("done")]);
    vi.stubGlobal("fetch", script.mock);
    const provider = new AiProvider(resolveAiProvider("openai"), { apiKey: "k" }, "https://p.test");

    await provider.chatWithTools({
      messages: [{ role: "user", content: "hi" }],
      tools: getProviderToolSchemas(["get_courses"]),
      toolChoice: "none",
    });

    expect((script.bodies[0].tools as unknown[]).length).toBe(1);
    expect(script.bodies[0].tool_choice).toBe("none");
  });

  it("serialises the tool-calling loop into the OpenAI wire shape", async () => {
    // Regression: the internal message uses `toolCalls`/`toolCallId`, but the API
    // only accepts `tool_calls`/`tool_call_id`. Passing the object straight
    // through made every follow-up round fail with HTTP 400
    // ("tool messages must include a non-empty string tool_call_id").
    const script = scriptedFetch([textTurn("All done.")]);
    vi.stubGlobal("fetch", script.mock);
    const provider = new AiProvider(resolveAiProvider("openai"), { apiKey: "k" }, "https://p.test");

    await provider.chatWithTools({
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
        {
          role: "assistant",
          content: null,
          toolCalls: [
            { id: "call_abc", type: "function", function: { name: "get_courses", arguments: "{}" } },
          ],
        },
        { role: "tool", content: '{"ok":true}', toolCallId: "call_abc", name: "get_courses" },
      ],
      tools: getProviderToolSchemas(["get_courses"]),
    });

    const sent = script.bodies[0].messages as Array<Record<string, unknown>>;
    expect(sent[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_abc", type: "function", function: { name: "get_courses", arguments: "{}" } },
      ],
    });
    expect(sent[3]).toEqual({
      role: "tool",
      content: '{"ok":true}',
      tool_call_id: "call_abc",
      name: "get_courses",
    });
  });

  it("normalises Ollama's object-shaped tool arguments", async () => {
    const script = scriptedFetch([
      {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{ function: { name: "get_courses", arguments: { status: "ACTIVE" } } }],
        },
      },
    ]);
    vi.stubGlobal("fetch", script.mock);
    const provider = new AiProvider(resolveAiProvider("ollama"), {}, "http://ollama.test");

    const turn = await provider.chatWithTools({
      messages: [{ role: "user", content: "courses" }],
      tools: getProviderToolSchemas(["get_courses"]),
    });

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].function.name).toBe("get_courses");
    expect(JSON.parse(turn.toolCalls[0].function.arguments)).toEqual({ status: "ACTIVE" });
    expect(turn.finishReason).toBe("tool_calls");
  });

  it("refuses to fake tool calls on a provider that lacks them", async () => {
    const provider = new AiProvider(resolveAiProvider("anthropic"), { apiKey: "k" });
    expect(provider.supportsTools()).toBe(false);
    await expect(
      provider.chatWithTools({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/does not support native tool calls/);
  });

  it("keeps the legacy grounded prompt working for tool-less providers", async () => {
    const script = scriptedFetch([textTurn("grounded")]);
    vi.stubGlobal("fetch", script.mock);
    const provider = new AiProvider(resolveAiProvider("openai"), { apiKey: "k" }, "https://p.test");

    const result = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      context: '{"studentos":{}}',
    });
    expect(result.content).toBe("grounded");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("AI HTTP surface: tool activity, proposals and confirmations", () => {
  beforeEach(async () => {
    const a = await seedStudent("http-agent", "STAT201", "Statistics");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Problem set 1" });

    useFakeConnection();
  });

  async function newConversation() {
    const created = await authRequestJson("post", `${BASE}/ai/conversations`, userA.token, { title: "Agent" });
    return created.body.data.id as string;
  }

  it("returns tool activity with the reply", async () => {
    const script = scriptedFetch([
      toolCallTurn("get_tasks", { status: "TODO" }),
      textTurn("Start with Problem set 1."),
    ]);
    vi.stubGlobal("fetch", script.mock);

    const conversationId = await newConversation();
    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, userA.token, {
      content: "What should I focus on?",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.reply.content).toContain("Problem set 1");
    expect(res.body.data.toolActivity[0]).toMatchObject({ tool: "get_tasks", status: "success" });
    expect(res.body.data.agent).toMatchObject({ usedTools: true, toolSupport: true, provider: "openai" });
  });

  it("returns a pending action for an unconfirmed write and creates nothing", async () => {
    const script = scriptedFetch([
      toolCallTurn("create_task", { title: "Read chapter 9" }),
      textTurn("I can add that — confirm?"),
    ]);
    vi.stubGlobal("fetch", script.mock);

    const conversationId = await newConversation();
    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, userA.token, {
      content: "Add a task to read chapter 9",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.pendingAction.status).toBe("PENDING");
    expect(res.body.data.pendingAction.actions[0].tool).toBe("create_task");
    expect(res.body.data.pendingAction).not.toHaveProperty("userId");
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Read chapter 9" } })).toBe(0);
  });

  it("exposes the pending action over REST and confirms it", async () => {
    const conversationId = await newConversation();
    confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "Add a task",
      actions: [{ tool: "create_task", description: "Add a task", arguments: { title: "Read chapter 9" } }],
    });

    const pending = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/pending-action`, userA.token);
    expect(pending.status).toBe(200);
    expect(pending.body.data.pendingAction.actions).toHaveLength(1);

    const actionId = pending.body.data.pendingAction.id as string;
    const confirmed = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${actionId}/confirm`,
      userA.token,
    );

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe("EXECUTED");
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Read chapter 9" } })).toBe(1);
  });

  it("refuses a second confirm of the same proposal", async () => {
    const conversationId = await newConversation();
    confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "Add a task",
      actions: [{ tool: "create_task", description: "Add", arguments: { title: "Only once" } }],
    });
    const pending = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/pending-action`, userA.token);
    const actionId = pending.body.data.pendingAction.id as string;

    const first = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${actionId}/confirm`,
      userA.token,
    );
    expect(first.status).toBe(200);

    const second = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${actionId}/confirm`,
      userA.token,
    );
    expect(second.status).toBe(409);
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Only once" } })).toBe(1);
  });

  it("cancels a proposal without applying it", async () => {
    const conversationId = await newConversation();
    confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "Add a task",
      actions: [{ tool: "create_task", description: "Add", arguments: { title: "Never applied" } }],
    });
    const pending = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/pending-action`, userA.token);
    const actionId = pending.body.data.pendingAction.id as string;

    const cancelled = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${actionId}/cancel`,
      userA.token,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.pendingAction.status).toBe("CANCELLED");
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Never applied" } })).toBe(0);
  });

  it("does not let another student confirm or even see a proposal", async () => {
    const other = await seedStudent("http-other", "CHEM101", "Chemistry");
    const conversationId = await newConversation();
    confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "Add a task",
      actions: [{ tool: "create_task", description: "Add", arguments: { title: "Private" } }],
    });
    const pending = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/pending-action`, userA.token);
    const actionId = pending.body.data.pendingAction.id as string;

    const otherConversation = await authRequestJson("post", `${BASE}/ai/conversations`, other.token, {});
    const otherConversationId = otherConversation.body.data.id as string;

    // Same id, different conversation and user.
    const crossUser = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${otherConversationId}/pending-action/${actionId}/confirm`,
      other.token,
    );
    expect(crossUser.status).toBe(404);

    const crossConversation = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${actionId}/confirm`,
      other.token,
    );
    expect(crossConversation.status).toBe(404);

    expect(await prisma.task.count({ where: { userId: userA.id, title: "Private" } })).toBe(0);
    expect(confirmationStore.getPending(userA.id, conversationId)).not.toBeNull();
  });

  it("applies a plan the student confirmed in chat", async () => {
    const conversationId = await newConversation();
    confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "Study plan",
      actions: [
        { tool: "create_study_session", description: "Session 1", arguments: { topic: "Chapter 1", startedAt: new Date().toISOString() } },
        { tool: "create_task", description: "Task 1", arguments: { title: "Past questions" } },
      ],
    });

    const script = scriptedFetch([
      toolCallTurn("confirm_pending_actions", {
        confirmationId: confirmationStore.getPending(userA.id, conversationId)!.id,
      }),
      textTurn("Done — I added both."),
    ]);
    vi.stubGlobal("fetch", script.mock);

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, userA.token, {
      content: "create it",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.toolActivity[0].status).toBe("success");
    expect(await prisma.studySession.count({ where: { userId: userA.id } })).toBe(1);
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Past questions" } })).toBe(1);
    expect(res.body.data.pendingAction).toBeNull();
  });

  it("cannot apply a proposal twice through the chat path", async () => {
    const conversationId = await newConversation();
    confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "Study plan",
      actions: [{ tool: "create_task", description: "Task", arguments: { title: "Exactly once" } }],
    });
    const actionId = confirmationStore.getPending(userA.id, conversationId)!.id;

    // The model keeps asking: the second confirm must fail, not re-apply.
    const script = scriptedFetch([
      toolCallTurn("confirm_pending_actions", { confirmationId: actionId }, "call_1"),
      toolCallTurn("confirm_pending_actions", { confirmationId: actionId }, "call_2"),
      textTurn("That was already applied."),
    ]);
    vi.stubGlobal("fetch", script.mock);

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, userA.token, {
      content: "create it",
    });

    expect(res.status).toBe(201);
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Exactly once" } })).toBe(1);
    expect(res.body.data.toolActivity.some((a: { status: string }) => a.status === "error")).toBe(true);
  });

  it("still stores messages without a provider when reply generation is off", async () => {
    vi.mocked(getActiveUserConnection).mockResolvedValue(null);
    const conversationId = await newConversation();

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, userA.token, {
      content: "no reply please",
      generateReply: false,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.reply).toBeNull();
    expect(res.body.data.toolActivity).toEqual([]);
  });

  it("returns 503 when no provider is resolvable at all", async () => {
    vi.mocked(getActiveUserConnection).mockResolvedValue(null);
    const conversationId = await newConversation();

    const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, userA.token, {
      content: "hello?",
    });

    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe("AI_PROVIDER_NOT_CONFIGURED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Natural references", () => {
  beforeEach(async () => {
    const a = await seedStudent("resolve-a", "PSYC300", "Cognitive Psychology");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    const b = await seedStudent("resolve-b", "CHEM110", "General Chemistry");
    userB = { token: b.token, id: b.id };
    courseB = b.courseId;
  });

  it("resolves a course from its code, ignoring case and spacing", async () => {
    for (const ref of ["PSYC300", "psyc300", "PSYC 300"]) {
      const result = await executeTool(
        { name: "create_task", arguments: { title: `Task for ${ref}`, course: ref } },
        ctxFor(userA),
      );
      expect(result.proposedActions?.[0].arguments.courseId, ref).toBe(courseA);
    }
  });

  it("resolves a course from its name when the code is unknown", async () => {
    const result = await executeTool(
      { name: "create_task", arguments: { title: "Read the chapter", course: "cognitive psychology" } },
      ctxFor(userA),
    );
    expect(result.proposedActions?.[0].arguments.courseId).toBe(courseA);
  });

  it("asks which course it means instead of guessing between two", async () => {
    // A genuinely ambiguous reference: the same name on two of this student's
    // courses, so neither candidate can be preferred.
    await authRequestJson("post", `${BASE}/courses`, userA.token, {
      code: "PSYC301",
      name: "Cognitive Psychology",
      credits: 3,
    });

    const result = await executeTool(
      { name: "create_task", arguments: { title: "Ambiguous", course: "Cognitive Psychology" } },
      ctxFor(userA),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ambiguous");
    expect(result.error?.message).toMatch(/PSYC300|PSYC301/);
  });

  it("reports a course that does not exist rather than substituting one", async () => {
    const result = await executeTool(
      { name: "create_task", arguments: { title: "Nowhere", course: "HIST999" } },
      ctxFor(userA),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_found");
    expect(result.error?.message).toMatch(/HIST999/);
  });

  it("will not resolve another student's course", async () => {
    const result = await executeTool(
      { name: "create_task", arguments: { title: "Borrowed", course: "CHEM110" } },
      ctxFor(userA),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_found");
  });

  it("resolves the task to update from its title", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Draft the lab report" });

    const result = await executeTool(
      { name: "update_task", arguments: { task: "draft the lab", title: "Draft the lab report v2" } },
      ctxFor(userA),
    );

    expect(result.proposedActions?.[0].arguments.taskId).toBe(task.body.data.id);
  });

  it("scopes a subtask reference to its parent task", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Group project" });
    const subtask = await authRequestJson("post", `${BASE}/tasks/${task.body.data.id}/subtasks`, userA.token, {
      title: "Write the introduction",
    });

    const result = await executeTool(
      {
        name: "update_subtask",
        arguments: {
          taskId: task.body.data.id,
          subtask: "introduction",
          status: "COMPLETED",
        },
      },
      ctxFor(userA),
    );

    expect(result.proposedActions?.[0].arguments.subtaskId).toBe(subtask.body.data.id);
  });

  it("refuses a subtask reference that belongs to a different task", async () => {
    const first = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "First parent" });
    const second = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Second parent" });
    await authRequestJson("post", `${BASE}/tasks/${second.body.data.id}/subtasks`, userA.token, {
      title: "Write the introduction",
    });

    const result = await executeTool(
      {
        name: "update_subtask",
        arguments: { taskId: first.body.data.id, subtask: "introduction", status: "COMPLETED" },
      },
      ctxFor(userA),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("not_found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Post-write verification", () => {
  beforeEach(async () => {
    const a = await seedStudent("verify-a", "EE220", "Digital Logic");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
  });

  /** Run one action through the confirmed path, exactly as the API does. */
  async function runConfirmed(tool: string, args: Record<string, unknown>) {
    const action: ProposedAction = { tool, description: tool, arguments: args };
    return executeTool({ name: tool, arguments: args }, ctxFor(userA, `conv-verify-${tool}`, [action]));
  }

  it("reports a created task as applied and verified", async () => {
    const result = await runConfirmed("create_task", { title: "Verify me", priority: "HIGH" });
    expect(result.ok).toBe(true);

    const verification = await verifyExecutedAction(userA.id, "create_task", { title: "Verify me", priority: "HIGH" }, result.data);
    expect(verification.verified).toBe(true);
    expect(verification.message).toContain("Verify me");
  });

  it("verifies a completed task by its stored status", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Close me" });
    const result = await runConfirmed("complete_task", { taskId: task.body.data.id });
    expect(result.ok).toBe(true);

    const verification = await verifyExecutedAction(userA.id, "complete_task", { status: "COMPLETED" }, result.data);
    expect(verification.verified).toBe(true);
  });

  it("verifies an updated calendar event against the approved time", async () => {
    const event = await authRequestJson("post", `${BASE}/events`, userA.token, {
      title: "Midterm",
      type: "EXAM",
      startAt: new Date().toISOString(),
    });
    const newStart = "2035-03-04T09:00:00.000Z";
    const result = await runConfirmed("update_event", { eventId: event.body.data.id, startAt: newStart });
    expect(result.ok).toBe(true);

    const verification = await verifyExecutedAction(
      userA.id,
      "update_event",
      { startAt: newStart },
      result.data,
    );
    expect(verification.verified).toBe(true);
  });

  it("does not verify an event moved to a different time on the approved day", async () => {
    // The approved value carried a time, so a record on the same day but at a
    // different hour is a different exam and must not read as verified.
    const event = await authRequestJson("post", `${BASE}/events`, userA.token, {
      title: "Final",
      type: "EXAM",
      startAt: new Date().toISOString(),
    });
    const result = await runConfirmed("update_event", { eventId: event.body.data.id, startAt: "2035-03-04T14:00:00.000Z" });
    expect(result.ok).toBe(true);

    const stored = (await eventsService.getById(userA.id, event.body.data.id)).startAt;
    expect(String(stored).slice(0, 10)).toBe("2035-03-04");

    // Approve a different time on that same day.
    const sameDayOtherTime = await verifyExecutedAction(
      userA.id,
      "update_event",
      { startAt: "2035-03-04T09:00:00.000Z" },
      result.data,
    );
    expect(sameDayOtherTime.verified).toBe(false);
    expect(sameDayOtherTime.message).toMatch(/startAt/i);
  });

  it("accepts a date-only approval against a normalised stored instant", async () => {
    // "2035-03-04" only ever asked for the day: the tool normalises it to
    // 09:00 local, so the stored instant must still verify.
    const event = await authRequestJson("post", `${BASE}/events`, userA.token, {
      title: "Study block",
      type: "STUDY",
      startAt: new Date().toISOString(),
    });
    const result = await runConfirmed("update_event", { eventId: event.body.data.id, startAt: "2035-03-04" });
    expect(result.ok).toBe(true);

    const verification = await verifyExecutedAction(
      userA.id,
      "update_event",
      { startAt: "2035-03-04" },
      result.data,
    );
    expect(verification.verified).toBe(true);
  });

  it("verifies a subtask through its parent task", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Thesis" });
    const result = await runConfirmed("create_subtask", { taskId: task.body.data.id, title: "Chapter one" });
    expect(result.ok).toBe(true);

    const verification = await verifyExecutedAction(
      userA.id,
      "create_subtask",
      { taskId: task.body.data.id, title: "Chapter one" },
      result.data,
    );
    expect(verification.verified).toBe(true);
  });

  it("fails verification when the record does not hold the approved value", async () => {
    const result = await runConfirmed("create_task", { title: "Actual title" });
    const verification = await verifyExecutedAction(
      userA.id,
      "create_task",
      { title: "A different title" },
      result.data,
    );

    expect(verification.verified).toBe(false);
    expect(verification.message).toMatch(/does not match/i);
  });

  it("fails verification when the record cannot be read back", async () => {
    const result = await runConfirmed("create_task", { title: "Vanishing" });
    const verification = await verifyExecutedAction(
      userA.id,
      "create_task",
      { title: "Vanishing" },
      { id: "does-not-exist" },
    );

    expect(verification.verified).toBe(false);
    expect(result.ok).toBe(true);
  });

  it("refuses to call a tool verified that has no verifier", async () => {
    const verification = await verifyExecutedAction(userA.id, "create_task", {}, { id: "x" });
    expect(verification.verified).toBe(false);
  });

  it("covers every write tool that can be confirmed", () => {
    for (const tool of listTools("WRITE")) {
      if (tool.name === "confirm_pending_actions") continue;
      expect(verificationTools, `${tool.name} has no verifier`).toContain(tool.name);
    }
  });

  it("re-reads every field a write tool can change", () => {
    // A field the student approved but the verifier never re-reads is reported
    // as verified on the strength of the other fields alone, which is exactly
    // the false "the change went through" this module exists to prevent.
    // Reference and id arguments are locators rather than approved changes, so
    // they are excluded: the resolver consumes them before the write runs.
    const locators = new Set([
      "id", "taskId", "courseId", "sessionId", "goalId", "noteId", "resourceId",
      "eventId", "gradeId", "subtaskId", "milestoneId", "task", "course", "session",
      "goal", "note", "resource", "event", "grade", "milestone", "subtask",
    ]);

    for (const tool of listTools("WRITE")) {
      if (tool.name === "confirm_pending_actions") continue;
      const checked = verificationFields(tool.name);
      const objectSchema = tool.parameters as unknown as { shape?: Record<string, unknown> };
      for (const key of Object.keys(objectSchema.shape ?? {})) {
        if (locators.has(key)) continue;
        expect(checked, `${tool.name} approves "${key}" but never re-reads it`).toContain(key);
      }
    }
  });

  it("fails complete_task when the record is not actually completed", async () => {    const created = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Verifier probe" });
    const taskId = created.body.data.id as string;

    // Not completed yet: the tool's whole purpose is COMPLETED, so a record in
    // any other state must not verify even though no status was approved.
    const stillOpen = await verifyExecutedAction(userA.id, "complete_task", { taskId }, { id: taskId });
    expect(stillOpen.verified).toBe(false);
    expect(stillOpen.message).toContain("COMPLETED");

    await authRequestJson("post", `${BASE}/tasks/${taskId}/complete`, userA.token, {});

    const completed = await verifyExecutedAction(userA.id, "complete_task", { taskId }, { id: taskId });
    expect(completed.verified).toBe(true);
  });

  it("never verifies a record belonging to another student", async () => {
    const other = await seedStudent("verify-b", "BIO220", "Cell Biology");
    const otherTask = await authRequestJson("post", `${BASE}/tasks`, other.token, { title: "Theirs" });

    const verification = await verifyExecutedAction(
      userA.id,
      "create_task",
      { title: "Theirs" },
      { id: otherTask.body.data.id },
    );
    expect(verification.verified).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Verified batch outcomes", () => {
  let conversationId: string;

  beforeEach(async () => {
    const a = await seedStudent("batch", "FIN400", "Corporate Finance");
    userA = { token: a.token, id: a.id };
    // A real conversation: the HTTP endpoints assert ownership, so a synthetic
    // id would 404 before the proposal could ever be read or confirmed.
    const created = await authRequestJson("post", `${BASE}/ai/conversations`, userA.token, { title: "Batch" });
    conversationId = created.body.data.id as string;
  });

  it("reports one applied and verified action honestly", async () => {
    const proposal = confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "One change",
      actions: [{ tool: "create_task", description: "Task", arguments: { title: "Solo" } }],
    });

    const outcomes = await executeProposalActions(
      proposal.actions,
      { userId: userA.id, conversationId },
      executeTool,
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(true);
    expect(outcomes[0].verified).toBe(true);
    expect(summarizeOutcomes(outcomes)).toContain("Verified");
  });

  it("keeps the good steps when one step fails, and says so", async () => {
    const proposal = confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "Mixed batch",
      actions: [
        { tool: "create_task", description: "Good", arguments: { title: "Applied" } },
        { tool: "create_note", description: "Bad", arguments: { title: "n" } },
        { tool: "create_task", description: "Also good", arguments: { title: "Applied too" } },
      ],
    });

    const outcomes = await executeProposalActions(
      proposal.actions,
      { userId: userA.id, conversationId },
      executeTool,
    );

    expect(outcomes.filter((o) => o.ok && o.verified)).toHaveLength(2);
    expect(outcomes.filter((o) => !o.ok)).toHaveLength(1);

    const summary = summarizeOutcomes(outcomes);
    expect(summary).toContain("2 of 3");
    expect(summary).toContain("1 failed");

    expect(await prisma.task.count({ where: { userId: userA.id } })).toBe(2);
    expect(await prisma.note.count({ where: { userId: userA.id } })).toBe(0);
  });

  it("exposes the applied, verified and failed counts on the stored proposal", async () => {
    expect(summarizeOutcomes([])).toBe("Nothing to apply");

    // One action that applies and verifies, and one whose write fails because
    // its target was deleted before the batch ran. The counts must separate the
    // two: the first is applied and verified, the second is a failure, and
    // neither may be folded into the other's number.
    const vanishing = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Counts: vanishing" });
    const vanishingId = vanishing.body.data.id as string;
    await prisma.task.delete({ where: { id: vanishingId } });

    const proposal = confirmationStore.create({
      userId: userA.id,
      conversationId: "conv-counts",
      title: "Counts probe",
      actions: [
        { tool: "create_task", description: "Good", arguments: { title: "Counts: applied" } },
        { tool: "complete_task", description: "Doomed", arguments: { taskId: vanishingId } },
      ],
    });

    const executed = await executeProposalActions(
      proposal.actions,
      { userId: userA.id, conversationId: "conv-counts" },
      executeTool,
    );
    const summary = summarizeOutcomes(executed);

    expect(executed).toHaveLength(2);
    expect(executed[0].ok).toBe(true);
    expect(executed[0].verified).toBe(true);

    // complete_task cannot find its target, so the write itself fails.
    expect(executed[1].ok).toBe(false);
    expect(executed[1].verified).toBe(false);
    expect(executed[1].error).toBeTruthy();

    expect(summary).toMatch(/1 .*verified/i);
    expect(summary).toMatch(/1 .*failed/i);

    // Exactly one task was really written: the counts match the database.
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Counts: applied" } })).toBe(1);
    expect(await prisma.task.count({ where: { id: vanishingId } })).toBe(0);
  });

  it("distinguishes an applied-but-unverified write from a failure", async () => {
    // The state this suite otherwise never produces: the write succeeded, but
    // the re-read could not confirm it. Reporting it as a failure would be a
    // lie (the row is there) and reporting it as verified would be a worse one.
    //
    // Forced deterministically by deleting the row between the write and the
    // verifier's re-read, using the runner hook rather than a timing race.
    const proposal = confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "Unverifiable",
      actions: [{ tool: "create_task", description: "Vanishes", arguments: { title: "Unverifiable: written" } }],
    });

    const runner: typeof executeTool = async (call, ctx) => {
      const result = await executeTool(call, ctx);
      if (result.ok) {
        const created = result.data as { id?: string };
        if (created?.id) await prisma.task.delete({ where: { id: created.id } });
      }
      return result;
    };

    const outcomes = await executeProposalActions(
      proposal.actions,
      { userId: userA.id, conversationId },
      runner,
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(true);
    expect(outcomes[0].verified).toBe(false);
    expect(summarizeOutcomes(outcomes)).not.toMatch(/\bfailed\b/i);
  });

  it("reports a partly applied proposal as PARTIAL and stores the counts", async () => {
    // The batch layer already covers good/bad mixes; this is the same truth over
    // HTTP, because PARTIAL is the only thing standing between a student and a
    // summary that claims a failed change was made. A real conversation is
    // needed here: the endpoint checks ownership, so a made-up id would 404.
    const created = await authRequestJson("post", `${BASE}/ai/conversations`, userA.token, { title: "Partial" });
    const conversation = created.body.data.id as string;
    confirmationStore.create({
      userId: userA.id,
      conversationId: conversation,
      title: "Half of this works",
      actions: [
        { tool: "create_task", description: "Good", arguments: { title: "Partial: applied" } },
        { tool: "complete_task", description: "Doomed", arguments: { taskId: "00000000-0000-0000-0000-000000000000" } },
      ],
    });

    const pending = await authRequestJson("get", `${BASE}/ai/conversations/${conversation}/pending-action`, userA.token);
    const actionId = pending.body.data.pendingAction.id as string;

    const confirmed = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversation}/pending-action/${actionId}/confirm`,
      userA.token,
    );

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe("PARTIAL");
    expect(confirmed.body.data.summary).toMatch(/1 .*failed/i);

    // The good half really landed.
    expect(await prisma.task.count({ where: { userId: userA.id, title: "Partial: applied" } })).toBe(1);

    // And the stored proposal carries the counts, not just the prose summary.
    const result = confirmed.body.data.pendingAction.result;
    expect(result).toMatchObject({ executed: 1, verified: 1, failed: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Post-write verification", () => {
  let userId: string;

  beforeEach(async () => {
    const auth = await registerAndLogin(`verify-${Date.now()}@test.com`, "Pass123!");
    userId = auth.user.id;
  });

  it("verifies a created task by re-reading it through the domain service", async () => {
    const created = await tasksService.create(userId, {
      title: "Test task",
      type: "HOMEWORK",
      priority: "HIGH",
      status: "TODO",
    });

    const result = await verifyExecutedAction(userId, "create_task", { title: "Test task", type: "HOMEWORK", priority: "HIGH" }, created);

    expect(result.verified).toBe(true);
    expect(result.message).toContain("Verified:");
    expect(result.record).toBeDefined();
  });

  it("fails verification when a field does not match what was approved", async () => {
    const created = await tasksService.create(userId, {
      title: "Original title",
      type: "HOMEWORK",
      priority: "LOW",
      status: "TODO",
    });

    // Verify with different arguments than what was actually written.
    const result = await verifyExecutedAction(userId, "create_task", { title: "Different title", priority: "HIGH" }, created);

    expect(result.verified).toBe(false);
    expect(result.message).toContain("does not match");
  });

  it("fails verification when the record cannot be found", async () => {
    const result = await verifyExecutedAction(userId, "create_task", { title: "Ghost" }, { id: "nonexistent" });

    expect(result.verified).toBe(false);
    expect(result.message).toContain("could not be verified");
  });

  it("fails verification when the tool has no verifier defined", async () => {
    const result = await verifyExecutedAction(userId, "unknown_tool", {}, { id: "some-id" });

    expect(result.verified).toBe(false);
    expect(result.message).toContain("No verification is defined");
  });

  it("verifies complete_task by checking the status invariant", async () => {
    const created = await tasksService.create(userId, {
      title: "Task to complete",
      type: "HOMEWORK",
      priority: "MEDIUM",
      status: "TODO",
    });

    // Complete the task.
    await tasksService.update(userId, created.id, { status: "COMPLETED" });

    const result = await verifyExecutedAction(userId, "complete_task", {}, { id: created.id });

    expect(result.verified).toBe(true);
    expect(result.message).toContain("Verified:");
  });

  it("fails complete_task verification when status is not COMPLETED", async () => {
    const created = await tasksService.create(userId, {
      title: "Incomplete task",
      type: "HOMEWORK",
      priority: "MEDIUM",
      status: "TODO",
    });

    // Don't complete it — status is still TODO.
    const result = await verifyExecutedAction(userId, "complete_task", {}, { id: created.id });

    expect(result.verified).toBe(false);
    expect(result.message).toContain("expected COMPLETED");
  });

  it("lists all write tools as having verifiers", () => {
    const writeTools = [
      "create_task", "update_task", "complete_task",
      "create_subtask", "update_subtask", "create_task_tag",
      "create_study_session", "update_study_session",
      "create_goal", "update_goal_progress", "create_milestone", "update_milestone",
      "create_note", "update_note",
      "create_resource", "update_resource",
      "create_event", "update_event",
      "create_grade", "update_grade",
      "update_course",
    ];

    for (const tool of writeTools) {
      expect(verificationTools).toContain(tool);
    }
  });

  it("exposes verification fields for each tool", () => {
    const fields = verificationFields("create_task");
    expect(fields).toContain("title");
    expect(fields).toContain("type");
    expect(fields).toContain("priority");
  });
});

