import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { prisma, registerAndLogin, authRequestJson } from "./helpers";
import { getActiveUserConnection } from "@/services/ai-connections";
import { AiProvider, resolveAiProvider } from "@/services/ai/provider";
import { runAgent } from "@/services/ai/agent";
import { confirmationStore } from "@/services/ai/confirmations";
import { executeProposalActions } from "@/services/ai/tools/confirm-tool";
import { executeTool } from "@/services/ai/tools/registry";
import type { ProposedAction } from "@/services/ai/tools/types";
import { tasksService } from "@/services/tasks";
import { notesService } from "@/services/notes";
import { studySessionsService } from "@/services/study-sessions";
import { aiService } from "@/services/ai/service";

vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

const BASE = "/api/v1";

let userA: { token: string; id: string };
let userB: { token: string; id: string };
let courseA: string;

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
  const toolCall = { id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
  const message = { role: "assistant" as const, content: null, tool_calls: [toolCall], finish_reason: "tool_calls" as const };
  const choice = { index: 0, message };
  return { choices: [choice] };
}

function multiToolCallTurn(calls: Array<{ name: string; args: Record<string, unknown>; id: string }>) {
  const toolCalls = calls.map(({ name: n, args: a, id: i }) => ({ id: i, type: "function" as const, function: { name: n, arguments: JSON.stringify(a) } }));
  const message = { role: "assistant" as const, content: null, tool_calls: toolCalls, finish_reason: "tool_calls" as const };
  const choice = { index: 0, message };
  return { choices: [choice] };
}

function openAiProvider(turns: Array<Record<string, unknown>>, model = "test-model") {
  const script = scriptedFetch(turns);
  vi.stubGlobal("fetch", script.mock);
  return { provider: new AiProvider(resolveAiProvider("openai"), { apiKey: "sk-test" }, "https://provider.test.local", model), bodies: script.bodies, get callCount() { return script.callCount; } };
}

beforeEach(async () => {
  confirmationStore.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Missing tools: delete_task", () => {
  beforeEach(async () => {
    const a = await seedStudent("delete-task", "MATH101", "Calculus");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    const b = await seedStudent("delete-task-other", "PHYS101", "Physics");
    userB = { token: b.token, id: b.id };
  });

  it("refuses a delete_task without confirmation and creates nothing", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Task to delete", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const taskId = task.body.data.id as string;

    const result = await executeTool({ name: "delete_task", arguments: { taskId } }, ctxFor(userA, "conv-1"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");

    const stored = await prisma.task.findUnique({ where: { id: taskId } });
    expect(stored).not.toBeNull();
  });

  it("deletes a task after confirmation and verifies it is gone", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Task to delete", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const taskId = task.body.data.id as string;

    const result = await executeTool({ name: "delete_task", arguments: { taskId } }, ctxFor(userA, "conv-2", [{ tool: "delete_task", description: "d", arguments: { taskId } }]));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ id: taskId, deleted: true });

    const stored = await prisma.task.findUnique({ where: { id: taskId } });
    expect(stored).toBeNull();
  });

  it("refuses to delete another student's task", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userB.token, { title: "User B task", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const taskId = task.body.data.id as string;

    const result = await executeTool({ name: "delete_task", arguments: { taskId } }, ctxFor(userA, "conv-3", [{ tool: "delete_task", description: "d", arguments: { taskId } }]));
    expect(result.ok).toBe(false);

    const stored = await prisma.task.findUnique({ where: { id: taskId } });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(userB.id);
  });

  it("verifies deletion through the verifier", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Task to delete", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const taskId = task.body.data.id as string;

    await executeTool({ name: "delete_task", arguments: { taskId } }, ctxFor(userA, "conv-4", [{ tool: "delete_task", description: "d", arguments: { taskId } }]));

    const { verifyExecutedAction } = await import("@/services/ai/tools/verify");
    const verification = await verifyExecutedAction(userA.id, "delete_task", { taskId }, { id: taskId, deleted: true });
    expect(verification.verified).toBe(true);
  });
});

describe("Missing tools: delete_note", () => {
  beforeEach(async () => {
    const a = await seedStudent("delete-note", "CHEM101", "Chemistry");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    const b = await seedStudent("delete-note-other", "BIO101", "Biology");
    userB = { token: b.token, id: b.id };
  });

  it("refuses a delete_note without confirmation", async () => {
    const note = await authRequestJson("post", `${BASE}/notes`, userA.token, { title: "Note to delete", content: "content" });
    const noteId = note.body.data.id as string;

    const result = await executeTool({ name: "delete_note", arguments: { noteId } }, ctxFor(userA, "conv-1"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");

    const stored = await prisma.note.findUnique({ where: { id: noteId } });
    expect(stored).not.toBeNull();
  });

  it("deletes a note after confirmation and verifies it is gone", async () => {
    const note = await authRequestJson("post", `${BASE}/notes`, userA.token, { title: "Note to delete", content: "content" });
    const noteId = note.body.data.id as string;

    const result = await executeTool({ name: "delete_note", arguments: { noteId } }, ctxFor(userA, "conv-2", [{ tool: "delete_note", description: "d", arguments: { noteId } }]));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ id: noteId, deleted: true });

    const stored = await prisma.note.findUnique({ where: { id: noteId } });
    expect(stored).toBeNull();
  });

  it("refuses to delete another student's note", async () => {
    const note = await authRequestJson("post", `${BASE}/notes`, userB.token, { title: "User B note", content: "content" });
    const noteId = note.body.data.id as string;

    const result = await executeTool({ name: "delete_note", arguments: { noteId } }, ctxFor(userA, "conv-3", [{ tool: "delete_note", description: "d", arguments: { noteId } }]));
    expect(result.ok).toBe(false);

    const stored = await prisma.note.findUnique({ where: { id: noteId } });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(userB.id);
  });

  it("rejects invalid noteId format (empty string fails schema)", async () => {
    const result = await executeTool({ name: "delete_note", arguments: { noteId: "" } }, ctxFor(userA, "conv-4", [{ tool: "delete_note", description: "d", arguments: { noteId: "" } }]));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_arguments");
  });
});

describe("Missing tools: delete_study_session", () => {
  beforeEach(async () => {
    const a = await seedStudent("delete-session", "HIST101", "History");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    const b = await seedStudent("delete-session-other", "GEOG101", "Geography");
    userB = { token: b.token, id: b.id };
  });

  it("refuses a delete_study_session without confirmation", async () => {
    const session = await authRequestJson("post", `${BASE}/study-sessions`, userA.token, { courseId: courseA, topic: "Session to delete", startedAt: new Date().toISOString(), durationMinutes: 30 });
    const sessionId = session.body.data.id as string;

    const result = await executeTool({ name: "delete_study_session", arguments: { sessionId } }, ctxFor(userA, "conv-1"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");

    const stored = await prisma.studySession.findUnique({ where: { id: sessionId } });
    expect(stored).not.toBeNull();
  });

  it("deletes a study session after confirmation and verifies it is gone", async () => {
    const session = await authRequestJson("post", `${BASE}/study-sessions`, userA.token, { courseId: courseA, topic: "Session to delete", startedAt: new Date().toISOString(), durationMinutes: 30 });
    const sessionId = session.body.data.id as string;

    const result = await executeTool({ name: "delete_study_session", arguments: { sessionId } }, ctxFor(userA, "conv-2", [{ tool: "delete_study_session", description: "d", arguments: { sessionId } }]));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ id: sessionId, deleted: true });

    const stored = await prisma.studySession.findUnique({ where: { id: sessionId } });
    expect(stored).toBeNull();
  });

  it("refuses to delete another student's study session", async () => {
    // Create a course for userB first (use unique year name to avoid 409)
    const yearB = await authRequestJson("post", `${BASE}/academics/years`, userB.token, {
      name: "2035-2036",
      startDate: "2035-09-01T00:00:00.000Z",
      endDate: "2036-06-30T00:00:00.000Z",
    });
    const semB = await authRequestJson("post", `${BASE}/academics/semesters`, userB.token, {
      name: "Fall 2035",
      academicYearId: yearB.body.data.id,
      startDate: "2035-09-01T00:00:00.000Z",
      endDate: "2035-12-15T00:00:00.000Z",
    });
    const courseB = await authRequestJson("post", `${BASE}/courses`, userB.token, {
      code: "GEOG101",
      name: "Geography",
      credits: 3,
      semesterId: semB.body.data.id,
    });

    const session = await authRequestJson("post", `${BASE}/study-sessions`, userB.token, { courseId: courseB.body.data.id, topic: "User B session", startedAt: new Date().toISOString(), durationMinutes: 30 });
    const sessionId = session.body.data.id as string;

    const result = await executeTool({ name: "delete_study_session", arguments: { sessionId } }, ctxFor(userA, "conv-3", [{ tool: "delete_study_session", description: "d", arguments: { sessionId } }]));
    expect(result.ok).toBe(false);

    const stored = await prisma.studySession.findUnique({ where: { id: sessionId } });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(userB.id);
  });
});

describe("Missing tools: create_study_plan", () => {
  beforeEach(async () => {
    const a = await seedStudent("create-plan", "CS101", "Computer Science");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    const b = await seedStudent("create-plan-other", "EE101", "Electrical Engineering");
    userB = { token: b.token, id: b.id };
  });

  it("refuses a create_study_plan without confirmation", async () => {
    const result = await executeTool({ name: "create_study_plan", arguments: { title: "My Plan", examDate: "2026-06-15", courseId: courseA } }, ctxFor(userA, "conv-1"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");
  });

  it("creates a study plan after confirmation with all fields", async () => {
    const result = await executeTool({ name: "create_study_plan", arguments: { title: "Final Exam Plan", examDate: "2026-06-15T09:00:00.000Z", courseId: courseA, entries: [{ dayNumber: 1, title: "Review Chapter 1", durationMinutes: 60 }, { dayNumber: 2, title: "Practice problems", durationMinutes: 90 }] } }, ctxFor(userA, "conv-2", [{ tool: "create_study_plan", description: "d", arguments: { title: "Final Exam Plan", examDate: "2026-06-15T09:00:00.000Z", courseId: courseA, entries: [{ dayNumber: 1, title: "Review Chapter 1", durationMinutes: 60 }, { dayNumber: 2, title: "Practice problems", durationMinutes: 90 }] } }]));
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty("id");
    expect(result.data.title).toBe("Final Exam Plan");
    expect(result.data.entries).toHaveLength(2);

    const stored = await aiService.getStudyPlan(userA.id, result.data.id);
    expect(stored).not.toBeNull();
    expect(stored.entries).toHaveLength(2);
  });

  it("creates a study plan without optional courseId", async () => {
    const result = await executeTool({ name: "create_study_plan", arguments: { title: "General Plan", examDate: "2026-07-01", entries: [{ dayNumber: 1, title: "Read", durationMinutes: 30 }] } }, ctxFor(userA, "conv-3", [{ tool: "create_study_plan", description: "d", arguments: { title: "General Plan", examDate: "2026-07-01", entries: [{ dayNumber: 1, title: "Read", durationMinutes: 30 }] } }]));
    expect(result.ok).toBe(true);
    expect(result.data.courseId).toBeNull();
  });

  it("rejects invalid title (too short/long)", async () => {
    const result = await executeTool({ name: "create_study_plan", arguments: { title: "", examDate: "2026-06-15" } }, ctxFor(userA, "conv-4", [{ tool: "create_study_plan", description: "d", arguments: { title: "", examDate: "2026-06-15" } }]));
    expect(result.ok).toBe(false);
  });

  it("rejects invalid dayNumber in entries", async () => {
    const result = await executeTool({ name: "create_study_plan", arguments: { title: "Plan", examDate: "2026-06-15", entries: [{ dayNumber: 0, title: "Bad", durationMinutes: 30 }] } }, ctxFor(userA, "conv-5", [{ tool: "create_study_plan", description: "d", arguments: { title: "Plan", examDate: "2026-06-15", entries: [{ dayNumber: 0, title: "Bad", durationMinutes: 30 }] } }]));
    expect(result.ok).toBe(false);
  });

  it("refuses to create a plan for another student's course", async () => {
    const result = await executeTool({ name: "create_study_plan", arguments: { title: "Plan", examDate: "2026-06-15", courseId: courseA } }, ctxFor(userB, "conv-6", [{ tool: "create_study_plan", description: "d", arguments: { title: "Plan", examDate: "2026-06-15", courseId: courseA } }]));
    expect(result.ok).toBe(false);
  });
});

describe("Missing tools: add_study_plan_entry", () => {
  let planId: string;

  beforeEach(async () => {
    const a = await seedStudent("add-entry", "CS201", "Data Structures");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    const b = await seedStudent("add-entry-other", "MATH201", "Linear Algebra");
    userB = { token: b.token, id: b.id };

    const plan = await aiService.createStudyPlan(userA.id, { title: "Existing Plan", examDate: "2026-08-01" });
    planId = plan.id;
  });

  it("refuses add_study_plan_entry without confirmation", async () => {
    const result = await executeTool({ name: "add_study_plan_entry", arguments: { planId, dayNumber: 3, title: "New Entry", durationMinutes: 45 } }, ctxFor(userA, "conv-1"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");
  });

  it("adds an entry to an existing study plan after confirmation", async () => {
    const result = await executeTool({ name: "add_study_plan_entry", arguments: { planId, dayNumber: 3, title: "New Entry", description: "Details", durationMinutes: 45, taskId: null, courseId: null } }, ctxFor(userA, "conv-2", [{ tool: "add_study_plan_entry", description: "d", arguments: { planId, dayNumber: 3, title: "New Entry", description: "Details", durationMinutes: 45, taskId: null, courseId: null } }]));
    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty("id", planId);
    expect(result.data.entry).toMatchObject({ dayNumber: 3, title: "New Entry", durationMinutes: 45 });

    const stored = await aiService.getStudyPlan(userA.id, planId);
    expect(stored.entries).toHaveLength(1);
    expect(stored.entries[0].title).toBe("New Entry");
  });

  it("adds an entry with optional taskId", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Related task", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const taskId = task.body.data.id as string;

    const result = await executeTool({ name: "add_study_plan_entry", arguments: { planId, dayNumber: 4, title: "With Task", durationMinutes: 60, taskId, courseId: null } }, ctxFor(userA, "conv-3", [{ tool: "add_study_plan_entry", description: "d", arguments: { planId, dayNumber: 4, title: "With Task", durationMinutes: 60, taskId, courseId: null } }]));
    expect(result.ok).toBe(true);
    expect(result.data.entry.taskId).toBe(taskId);
  });

  it("refuses to add entry to another student's plan", async () => {
    const result = await executeTool({ name: "add_study_plan_entry", arguments: { planId, dayNumber: 1, title: "Hack", durationMinutes: 30 } }, ctxFor(userB, "conv-4", [{ tool: "add_study_plan_entry", description: "d", arguments: { planId, dayNumber: 1, title: "Hack", durationMinutes: 30 } }]));
    expect(result.ok).toBe(false);
  });

  it("rejects non-existent planId", async () => {
    const fakeId = "cmvdt0t480004u3rcrn81cag7";
    const result = await executeTool({ name: "add_study_plan_entry", arguments: { planId: fakeId, dayNumber: 1, title: "Fail", durationMinutes: 30 } }, ctxFor(userA, "conv-5", [{ tool: "add_study_plan_entry", description: "d", arguments: { planId: fakeId, dayNumber: 1, title: "Fail", durationMinutes: 30 } }]));
    expect(result.ok).toBe(false);
  });
});

describe("Missing tools: push_daily_agenda (ANALYZE, no confirmation)", () => {
  let planId: string;

  beforeEach(async () => {
    const a = await seedStudent("push-agenda", "PHYS201", "Quantum Mechanics");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;

    const plan = await aiService.createStudyPlan(userA.id, { title: "Quantum Plan", examDate: "2026-10-01", entries: [{ dayNumber: 1, title: "Wave functions", durationMinutes: 60 }, { dayNumber: 2, title: "Schrodinger equation", durationMinutes: 90 }, { dayNumber: 3, title: "Operators", durationMinutes: 60 }] });
    planId = plan.id;
  });

  it("builds a daily agenda from a study plan without confirmation", async () => {
    const result = await executeTool({ name: "push_daily_agenda", arguments: { planId, date: "2026-09-20", hoursPerDay: 6 } }, ctxFor(userA, "conv-1"));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ studyPlanId: planId, title: "Quantum Plan", date: "2026-09-20", hoursPerDay: 6 });
    expect(result.data.entries).toHaveLength(3);
    expect(result.data.totalDays).toBe(3);
    expect(result.data.totalMinutes).toBe(210);
  });

  it("uses default hoursPerDay when omitted", async () => {
    const result = await executeTool({ name: "push_daily_agenda", arguments: { planId, date: "2026-09-20" } }, ctxFor(userA, "conv-2"));
    expect(result.ok).toBe(true);
    expect(result.data.hoursPerDay).toBe(6);
  });

  it("assigns consecutive dates for each dayNumber", async () => {
    const result = await executeTool({ name: "push_daily_agenda", arguments: { planId, date: "2026-09-20" } }, ctxFor(userA, "conv-3"));
    expect(result.ok).toBe(true);
    expect(result.data.entries[0].studyDate).toContain("2026-09-20");
    expect(result.data.entries[1].studyDate).toContain("2026-09-21");
    expect(result.data.entries[2].studyDate).toContain("2026-09-22");
  });

  it("refuses to build agenda for another student's plan", async () => {
    const b = await seedStudent("push-agenda-other", "CHEM201", "Organic Chemistry");
    userB = { token: b.token, id: b.id };

    const result = await executeTool({ name: "push_daily_agenda", arguments: { planId, date: "2026-09-20" } }, ctxFor(userB, "conv-4"));
    expect(result.ok).toBe(false);
  });

  it("rejects invalid date format", async () => {
    const result = await executeTool({ name: "push_daily_agenda", arguments: { planId, date: "not-a-date" } }, ctxFor(userA, "conv-5"));
    expect(result.ok).toBe(false);
  });
});

describe("Missing tools: bulk_update_task_status", () => {
  let taskIds: string[];

  beforeEach(async () => {
    const a = await seedStudent("bulk-update", "ENG101", "English Literature");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
    const b = await seedStudent("bulk-update-other", "ENG102", "Creative Writing");
    userB = { token: b.token, id: b.id };

    const t1 = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Task 1", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const t2 = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Task 2", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const t3 = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Task 3", dueDate: new Date(Date.now() + 86400000).toISOString() });
    taskIds = [t1.body.data.id as string, t2.body.data.id as string, t3.body.data.id as string];
  });

  it("refuses bulk_update_task_status without confirmation", async () => {
    const result = await executeTool({ name: "bulk_update_task_status", arguments: { taskIds: [taskIds[0]], status: "COMPLETED" } }, ctxFor(userA, "conv-1"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");
  });

  it("updates multiple tasks to COMPLETED after confirmation", async () => {
    const result = await executeTool({ name: "bulk_update_task_status", arguments: { taskIds: [taskIds[0], taskIds[1]], status: "COMPLETED" } }, ctxFor(userA, "conv-2", [{ tool: "bulk_update_task_status", description: "d", arguments: { taskIds: [taskIds[0], taskIds[1]], status: "COMPLETED" } }]));
    expect(result.ok).toBe(true);
    expect(result.data.updatedCount).toBe(2);
    expect(result.data.failedCount).toBe(0);
    expect(result.data.updated).toHaveLength(2);

    const t1 = await prisma.task.findUnique({ where: { id: taskIds[0] } });
    const t2 = await prisma.task.findUnique({ where: { id: taskIds[1] } });
    expect(t1?.status).toBe("COMPLETED");
    expect(t2?.status).toBe("COMPLETED");
  });

  it("handles partial failure: non-existent task does not roll back others", async () => {
    const fakeId = "cmvdt0t480004u3rcrn81cag7";
    const result = await executeTool({ name: "bulk_update_task_status", arguments: { taskIds: [taskIds[0], fakeId], status: "IN_PROGRESS" } }, ctxFor(userA, "conv-3", [{ tool: "bulk_update_task_status", description: "d", arguments: { taskIds: [taskIds[0], fakeId], status: "IN_PROGRESS" } }]));
    expect(result.ok).toBe(true);
    expect(result.data.updatedCount).toBe(1);
    expect(result.data.failedCount).toBe(1);
    expect(result.data.failed[0].taskId).toBe(fakeId);

    const t1 = await prisma.task.findUnique({ where: { id: taskIds[0] } });
    expect(t1?.status).toBe("IN_PROGRESS");
  });

  it("handles partial failure: another student's task does not roll back own tasks", async () => {
    const tOther = await authRequestJson("post", `${BASE}/tasks`, userB.token, { title: "User B task", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const otherId = tOther.body.data.id as string;

    const result = await executeTool({ name: "bulk_update_task_status", arguments: { taskIds: [taskIds[0], otherId], status: "COMPLETED" } }, ctxFor(userA, "conv-4", [{ tool: "bulk_update_task_status", description: "d", arguments: { taskIds: [taskIds[0], otherId], status: "COMPLETED" } }]));
    expect(result.ok).toBe(true);
    expect(result.data.updatedCount).toBe(1);
    expect(result.data.failedCount).toBe(1);

    const t1 = await prisma.task.findUnique({ where: { id: taskIds[0] } });
    expect(t1?.status).toBe("COMPLETED");
    const tOtherStored = await prisma.task.findUnique({ where: { id: otherId } });
    expect(tOtherStored?.status).toBe("TODO");
  });

  it("rejects invalid status value", async () => {
    const result = await executeTool({ name: "bulk_update_task_status", arguments: { taskIds: [taskIds[0]], status: "INVALID_STATUS" } }, ctxFor(userA, "conv-5", [{ tool: "bulk_update_task_status", description: "d", arguments: { taskIds: [taskIds[0]], status: "INVALID_STATUS" } }]));
    expect(result.ok).toBe(false);
  });

  it("rejects empty taskIds array", async () => {
    const result = await executeTool({ name: "bulk_update_task_status", arguments: { taskIds: [], status: "COMPLETED" } }, ctxFor(userA, "conv-6", [{ tool: "bulk_update_task_status", description: "d", arguments: { taskIds: [], status: "COMPLETED" } }]));
    expect(result.ok).toBe(false);
  });

  it("verifies each updated task through the verifier", async () => {
    const { verifyExecutedAction } = await import("@/services/ai/tools/verify");
    const result = await executeTool({ name: "bulk_update_task_status", arguments: { taskIds: [taskIds[0]], status: "COMPLETED" } }, ctxFor(userA, "conv-7", [{ tool: "bulk_update_task_status", description: "d", arguments: { taskIds: [taskIds[0]], status: "COMPLETED" } }]));
    expect(result.ok).toBe(true);

    const verification = await verifyExecutedAction(userA.id, "bulk_update_task_status", { taskIds: [taskIds[0]], status: "COMPLETED" }, result.data);
    expect(verification.verified).toBe(true);
  });
});

describe("Missing tools: confirmation gate and idempotency", () => {
  beforeEach(async () => {
    const a = await seedStudent("gate", "ART101", "Art History");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
  });

  it("does not let one approval unlock a different tool", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Task", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const taskId = task.body.data.id as string;

    const result = await executeTool({ name: "delete_task", arguments: { taskId } }, ctxFor(userA, "conv-1", [{ tool: "delete_note", description: "d", arguments: { noteId: taskId } }]));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");

    const stored = await prisma.task.findUnique({ where: { id: taskId } });
    expect(stored).not.toBeNull();
  });

  it("cannot apply a proposal twice through the confirmation flow", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Task", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const taskId = task.body.data.id as string;

    const proposal: ProposedAction = { tool: "delete_task", description: "d", arguments: { taskId } };
    const created = confirmationStore.create({ userId: userA.id, conversationId: "conv-2", title: "Delete", actions: [proposal] });

    const { executeTool } = await import("@/services/ai/tools/registry");
    const first = await executeProposalActions([proposal], { userId: userA.id, conversationId: "conv-2" }, executeTool);
    expect(first[0].ok).toBe(true);

    const second = await executeProposalActions([proposal], { userId: userA.id, conversationId: "conv-2" }, executeTool);
    expect(second[0].error).toBeDefined();
  });

  it("cancels a proposal without executing", async () => {
    const task = await authRequestJson("post", `${BASE}/tasks`, userA.token, { title: "Task to cancel", dueDate: new Date(Date.now() + 86400000).toISOString() });
    const taskId = task.body.data.id as string;

    const proposal: ProposedAction = { tool: "delete_task", description: "d", arguments: { taskId } };
    const created = confirmationStore.create({ userId: userA.id, conversationId: "conv-3", title: "Delete", actions: [proposal] });

    confirmationStore.cancel(userA.id, "conv-3", created.id);
    const stored = await prisma.task.findUnique({ where: { id: taskId } });
    expect(stored).not.toBeNull();
  });
});

describe("Missing tools: verifier coverage", () => {
  beforeEach(async () => {
    const a = await seedStudent("verify", "MUS101", "Music Theory");
    userA = { token: a.token, id: a.id };
    courseA = a.courseId;
  });

  it("has a verifier for delete_task", async () => {
    const { verificationFields: vf } = await import("@/services/ai/tools/verify");
    expect(vf("delete_task")).toBeDefined();
  });

  it("has a verifier for delete_note", async () => {
    const { verificationFields: vf } = await import("@/services/ai/tools/verify");
    expect(vf("delete_note")).toBeDefined();
  });

  it("has a verifier for delete_study_session", async () => {
    const { verificationFields: vf } = await import("@/services/ai/tools/verify");
    expect(vf("delete_study_session")).toBeDefined();
  });

  it("has a verifier for create_study_plan", async () => {
    const { verificationFields: vf } = await import("@/services/ai/tools/verify");
    expect(vf("create_study_plan")).toBeDefined();
  });

  it("has a verifier for add_study_plan_entry", async () => {
    const { verificationFields: vf } = await import("@/services/ai/tools/verify");
    expect(vf("add_study_plan_entry")).toBeDefined();
  });

  it("has a verifier for bulk_update_task_status", async () => {
    const { verificationFields: vf } = await import("@/services/ai/tools/verify");
    expect(vf("bulk_update_task_status")).toBeDefined();
  });

  it("push_daily_agenda is ANALYZE and does not need a verifier", async () => {
    const { verificationTools: vt } = await import("@/services/ai/tools/verify");
    expect(vt.includes("push_daily_agenda")).toBe(false);
  });
});