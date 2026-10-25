import { describe, it, expect, beforeAll } from "vitest";

import { getTool, toolNeedsApproval } from "@/services/ai/tools/registry";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Mission lifecycle over REST: creation with ordered, dependent steps; listing
// and ownership; cancellation; execution of a real plan through the tool layer;
// honest terminal failure with a working retry.
//
// These are the Phase 7 gate tests. Two regressions they are built around:
//
//  * Column naming. The mission migrations created snake_case columns while
//    the Prisma schema declares camelCase, so every read of mission *rows*
//    failed with P2022 even though a count still worked. Listing a created
//    mission pins that.
//  * Dependency identity. `dependsOn` is submitted as step indices (the only
//    form a client can know before the rows exist) while execution resolves
//    dependencies against generated step ids. Creation translates one into the
//    other; a dependent step that runs proves it.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "/api/v1";

let alice: { token: string; id: string };
let bob: { token: string; id: string };

async function createMission(token: string, body: Record<string, unknown>) {
  return authRequestJson("post", `${BASE}/ai/missions`, token, body);
}

function readPlan(objective = "Check outstanding work") {
  return {
    objective,
    steps: [
      { toolName: "get_tasks", description: "Read open tasks", arguments: {}, dependsOn: [] },
      { toolName: "get_courses", description: "Read enrolled courses", arguments: {}, dependsOn: [] },
    ],
  };
}

beforeAll(async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const a = await registerAndLogin(`missions-alice-${run}@test.com`, "Pass123!");
  const b = await registerAndLogin(`missions-bob-${run}@test.com`, "Pass123!");
  alice = { token: a.token, id: a.user.id };
  bob = { token: b.token, id: b.user.id };
});

describe("Mission creation and validation", () => {
  it("creates a mission with ordered steps and resolves dependsOn to step ids", async () => {
    const res = await createMission(alice.token, {
      objective: "Read tasks first, then courses",
      steps: [
        { toolName: "get_tasks", description: "Read open tasks", arguments: {}, dependsOn: [] },
        { toolName: "get_courses", description: "Read enrolled courses", arguments: {}, dependsOn: ["0"] },
      ],
    });

    expect(res.status).toBe(201);
    const mission = res.body.data;
    expect(mission.status).toBe("QUEUED");
    expect(mission.objective).toBe("Read tasks first, then courses");
    expect(mission.userId).toBe(alice.id);
    expect(mission.steps).toHaveLength(2);
    expect(mission.steps[0].stepOrder).toBe(0);
    expect(mission.steps[1].stepOrder).toBe(1);
    expect(mission.steps[0].status).toBe("PENDING");
    expect(mission.steps[0].dependsOn).toEqual([]);
    expect(mission.steps[1].dependsOn).toEqual([mission.steps[0].id]);
    expect(mission.steps[1].maxAttempts).toBe(3);
    expect(mission.steps[0].idempotencyKey).toBeNull();
  });

  it("rejects a plan with a dependency cycle", async () => {
    const res = await createMission(alice.token, {
      objective: "Impossible plan",
      steps: [
        { toolName: "get_tasks", description: "A", arguments: {}, dependsOn: ["1"] },
        { toolName: "get_courses", description: "B", arguments: {}, dependsOn: ["0"] },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/invalid mission plan/i);
    expect(JSON.stringify(res.body.error.details)).toMatch(/cycle/i);
  });

  it("rejects a dependency on a step that does not exist", async () => {
    const res = await createMission(alice.token, {
      objective: "Unknown dependency",
      steps: [{ toolName: "get_tasks", description: "A", arguments: {}, dependsOn: ["9"] }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects structurally invalid plans", async () => {
    const noObjective = await createMission(alice.token, { steps: readPlan("").steps });
    expect(noObjective.status).toBe(400);

    const noDescription = await createMission(alice.token, {
      objective: "Fine objective",
      steps: [{ toolName: "get_tasks", description: "", arguments: {} }],
    });
    expect(noDescription.status).toBe(400);

    const noSteps = await createMission(alice.token, { objective: "Fine objective", steps: [] });
    expect(noSteps.status).toBe(400);
  });

  it("publishes the mission tool catalog without self-confirmation tools", async () => {
    const res = await authRequestJson("get", `${BASE}/ai/tools`, alice.token);
    expect(res.status).toBe(200);

    const catalog = res.body.data;
    expect(catalog.executionAutonomyMode).toBe("manual");
    expect(Array.isArray(catalog.tools)).toBe(true);

    const byName = new Map(
      catalog.tools.map((tool: { name: string }) => [tool.name, tool]),
    ) as Map<string, {
      kind: string;
      confirmation: string;
      requiresApproval: boolean;
      parameters: { type?: string };
    }>;

    // A self-confirmation tool is the approval gesture itself; a mission step
    // has nowhere to ask, so the catalog never offers it.
    expect(byName.has("confirm_pending_actions")).toBe(false);

    // An autonomous-capable write still needs approval in manual mode; the
    // catalog reports both facts so the builder can explain it.
    const write = byName.get("create_task");
    expect(write).toBeTruthy();
    expect(write?.kind).toBe("WRITE");
    expect(write?.confirmation).toBe("autonomous");
    expect(write?.requiresApproval).toBe(true);
    expect(write?.parameters.type).toBe("object");

    const requiredWrite = byName.get("delete_task");
    expect(requiredWrite?.confirmation).toBe("required");
    expect(requiredWrite?.requiresApproval).toBe(true);

    const read = byName.get("get_tasks");
    expect(read).toBeTruthy();
    expect(read?.kind).toBe("READ");
    expect(read?.confirmation).toBe("none");
    expect(read?.requiresApproval).toBe(false);
  });

  it("computes requiresApproval from the same rule the runtime gate uses", async () => {
    await prisma.userSetting.upsert({
      where: { userId_key: { userId: alice.id, key: "ai.executionMode" } },
      create: { userId: alice.id, key: "ai.executionMode", value: "autonomous" },
      update: { value: "autonomous" },
    });

    try {
      const res = await authRequestJson("get", `${BASE}/ai/tools`, alice.token);
      expect(res.status).toBe(200);
      expect(res.body.data.executionAutonomyMode).toBe("autonomous");

      const byName = new Map(
        res.body.data.tools.map((tool: { name: string }) => [tool.name, tool]),
      ) as Map<string, { confirmation: string; requiresApproval: boolean }>;

      // An autonomous-capable write runs without approval in autonomous mode…
      expect(byName.get("create_task")?.confirmation).toBe("autonomous");
      expect(byName.get("create_task")?.requiresApproval).toBe(false);
      // …while a write that always needs confirmation still does.
      expect(byName.get("delete_task")?.confirmation).toBe("required");
      expect(byName.get("delete_task")?.requiresApproval).toBe(true);
      // Reads never need approval, in any mode.
      expect(byName.get("get_tasks")?.requiresApproval).toBe(false);

      // Every entry agrees with the shared registry rule, so the catalog and the
      // confirmation gate cannot drift apart.
      for (const entry of res.body.data.tools as Array<{ name: string; requiresApproval: boolean }>) {
        const tool = getTool(entry.name);
        expect(tool, entry.name).toBeTruthy();
        expect(entry.requiresApproval, entry.name).toBe(toolNeedsApproval(tool!, true));
      }
    } finally {
      await prisma.userSetting.deleteMany({ where: { userId: alice.id, key: "ai.executionMode" } });
    }
  });

  it("rejects a self-confirmation tool sent as a mission step", async () => {
    const res = await createMission(alice.token, {
      objective: "Try to confirm from a mission",
      steps: [
        {
          toolName: "confirm_pending_actions",
          description: "Confirm a proposal",
          arguments: {},
        },
      ],
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toMatch(/cannot be used as a mission step/);
  });
});

describe("Mission listing and ownership", () => {
  it("lists a created mission back — rows, not just a count", async () => {
    const created = await createMission(alice.token, readPlan("List me"));
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const list = await authRequestJson("get", `${BASE}/ai/missions`, alice.token);
    expect(list.status).toBe(200);
    expect(list.body.data.hasMore).toBe(false);
    const listed = list.body.data.items.find((m: { id: string }) => m.id === id);
    expect(listed).toBeTruthy();
    expect(listed.objective).toBe("List me");
    expect(listed.steps).toHaveLength(2);

    const queued = await authRequestJson("get", `${BASE}/ai/missions?status=QUEUED`, alice.token);
    expect(queued.body.data.items.some((m: { id: string }) => m.id === id)).toBe(true);

    const cancelled = await authRequestJson("get", `${BASE}/ai/missions?status=CANCELLED`, alice.token);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.items.some((m: { id: string }) => m.id === id)).toBe(false);
  });

  it("reads one mission and refuses another student's", async () => {
    const created = await createMission(alice.token, readPlan("Private plan"));
    const id = created.body.data.id as string;

    const own = await authRequestJson("get", `${BASE}/ai/missions/${id}`, alice.token);
    expect(own.status).toBe(200);
    expect(own.body.data.objective).toBe("Private plan");

    const foreign = await authRequestJson("get", `${BASE}/ai/missions/${id}`, bob.token);
    expect(foreign.status).toBe(404);

    const unknown = await authRequestJson("get", `${BASE}/ai/missions/no-such-id`, alice.token);
    expect(unknown.status).toBe(404);
  });

  it("refuses every write path for another student's mission", async () => {
    const created = await createMission(alice.token, readPlan("Guarded plan"));
    const id = created.body.data.id as string;

    for (const path of ["cancel", "retry", "execute", "approve"]) {
      const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/${path}`, bob.token);
      expect(res.status, path).toBe(404);
    }
  });

  it("never lists another student's missions", async () => {
    await createMission(alice.token, readPlan("Alice only mission"));
    const list = await authRequestJson("get", `${BASE}/ai/missions`, bob.token);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toEqual([]);
  });
});

describe("Mission cancellation", () => {
  it("cancels a queued mission and parks the remaining steps", async () => {
    const created = await createMission(alice.token, readPlan("Cancel me"));
    const id = created.body.data.id as string;

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/cancel`, alice.token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCEL_REQUESTED");
    expect(res.body.data.cancelledAt).toBeTruthy();
    expect(res.body.data.steps.every((s: { status: string }) => s.status === "CANCELLED")).toBe(true);
  });

  it("does not start a cancelled mission", async () => {
    const created = await createMission(alice.token, readPlan("Cancelled before start"));
    const id = created.body.data.id as string;
    await authRequestJson("post", `${BASE}/ai/missions/${id}/cancel`, alice.token);

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCEL_REQUESTED");
    expect(res.body.data.startedAt).toBeNull();
  });
});

describe("Mission execution", () => {
  it("runs a read-only plan to completion through the tool layer", async () => {
    const created = await createMission(alice.token, readPlan("Run me"));
    const id = created.body.data.id as string;

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    expect(res.status).toBe(200);

    const mission = res.body.data;
    expect(mission.status).toBe("COMPLETED");
    expect(mission.startedAt).toBeTruthy();
    expect(mission.completedAt).toBeTruthy();
    expect(mission.terminalError).toBeNull();
    expect(mission.steps).toHaveLength(2);
    for (const step of mission.steps) {
      expect(step.status).toBe("COMPLETED");
      expect(step.attempts).toBe(1);
      expect(step.result).toBeTruthy();
      expect(step.completedAt).toBeTruthy();
    }
  });

  it("runs a dependent step only after its dependency completed", async () => {
    const created = await createMission(alice.token, {
      objective: "Ordered reads",
      steps: [
        { toolName: "get_tasks", description: "Read open tasks", arguments: {}, dependsOn: [] },
        { toolName: "get_courses", description: "Read enrolled courses", arguments: {}, dependsOn: ["0"] },
      ],
    });
    const id = created.body.data.id as string;

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    expect(res.status).toBe(200);

    const mission = res.body.data;
    const [first, second] = mission.steps;
    expect(mission.status).toBe("COMPLETED");
    expect(first.status).toBe("COMPLETED");
    // The dependent step ran at all — before the index→id translation existed
    // it waited on an id that could never match and stayed PENDING forever
    // while the mission was reported COMPLETED.
    expect(second.status).toBe("COMPLETED");
    expect(new Date(second.startedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.completedAt).getTime(),
    );
  });

  it("refuses to cancel a mission that already completed", async () => {
    const created = await createMission(alice.token, readPlan("Finished work"));
    const id = created.body.data.id as string;
    await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/cancel`, alice.token);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/COMPLETED/);
  });
});

describe("Mission failure and retry", () => {
  it("fails honestly when a step cannot run, then retries from PENDING", async () => {
    const created = await createMission(alice.token, {
      objective: "Will fail",
      steps: [
        { toolName: "definitely_not_a_tool", description: "Not a real tool", arguments: {}, maxAttempts: 2 },
      ],
    });
    const id = created.body.data.id as string;

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    expect(res.status).toBe(200);

    const mission = res.body.data;
    expect(mission.status).toBe("FAILED_TERMINAL");
    expect(mission.terminalError).toBeTruthy();
    expect(mission.completedAt).toBeTruthy();
    expect(mission.steps[0].status).toBe("FAILED_TERMINAL");
    expect(mission.steps[0].attempts).toBe(1);
    expect(mission.steps[0].error).toMatch(/No tool named/);

    const retry = await authRequestJson("post", `${BASE}/ai/missions/${id}/retry`, alice.token);
    expect(retry.status).toBe(200);
    expect(retry.body.data.status).toBe("QUEUED");
    expect(retry.body.data.terminalError).toBeNull();
    expect(retry.body.data.steps[0].status).toBe("PENDING");
    expect(retry.body.data.steps[0].attempts).toBe(0);
    expect(retry.body.data.steps[0].error).toBeNull();
  });

  it("refuses to retry a mission that has not failed", async () => {
    const created = await createMission(alice.token, readPlan("Nothing failed"));
    const id = created.body.data.id as string;

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/retry`, alice.token);
    expect(res.status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval handshake.
//
// A mission step that changes data cannot run on its own: the registry refuses
// the write and hands back the exact call the student was shown. The mission
// has to park that proposal, wait, and apply it only when the student says so.
//
// The regressions these tests are built around:
//
//  * The proposal was thrown away. `executeStepWithRetries` checked `!ok`
//    before it looked at `proposedActions`, so a refused write was reported as
//    a terminal failure and the change the student was never shown was lost.
//  * Nothing could approve it. The step did not remember which proposal it
//    was waiting on, so there was no way to claim it.
//  * The mission spun. A step in WAITING kept the executor looping for ever
//    instead of stopping and waiting for the student.
// ─────────────────────────────────────────────────────────────────────────────

async function createConversation(token: string, title: string) {
  const res = await authRequestJson("post", `${BASE}/ai/conversations`, token, { title });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

/** A mission whose single step writes a task, in its own conversation. */
async function createWriteMission(token: string, conversationId: string, title = "Revision task") {
  const res = await createMission(token, {
    objective: "Create a revision task",
    conversationId,
    steps: [
      {
        toolName: "create_task",
        description: "Create the revision task",
        arguments: { title, type: "REVISION" },
        dependsOn: [],
      },
    ],
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe("Mission approval handshake", () => {
  it("parks a write step for approval instead of failing it", async () => {
    const conversationId = await createConversation(alice.token, "Approval chat");
    const id = await createWriteMission(alice.token, conversationId, "Parked task");

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    expect(res.status).toBe(200);

    const mission = res.body.data;
    expect(mission.status).toBe("WAITING");
    expect(mission.steps[0].status).toBe("WAITING");
    // The step remembers which proposal it is waiting on, so the student can
    // be shown what they are approving and the proposal can be claimed.
    expect(mission.steps[0].pendingActionId).toBeTruthy();
    expect(mission.pendingAction).toBeTruthy();
    expect(mission.pendingAction.status).toBe("PENDING");
    expect(mission.pendingAction.actions[0].tool).toBe("create_task");

    // Nothing was written yet: the change waits for the student.
    const tasks = await authRequestJson("get", `${BASE}/tasks`, alice.token);
    expect(tasks.body.data.items.some((t: { title: string }) => t.title === "Parked task")).toBe(false);
  });

  it("applies the approved change, completes the step and finishes the mission", async () => {
    const conversationId = await createConversation(alice.token, "Approve chat");
    const id = await createWriteMission(alice.token, conversationId, "Approved task");

    await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/approve`, alice.token);
    expect(res.status).toBe(200);

    const mission = res.body.data;
    expect(mission.status).toBe("COMPLETED");
    expect(mission.steps[0].status).toBe("COMPLETED");
    // The key ties the step to its change, so a replay is recognisable as the
    // same one.
    expect(mission.steps[0].idempotencyKey).toBe(`${id}:${mission.steps[0].id}`);

    const tasks = await authRequestJson("get", `${BASE}/tasks`, alice.token);
    const created = tasks.body.data.items.find((t: { title: string }) => t.title === "Approved task");
    expect(created).toBeTruthy();
  });

  it("applies a proposal exactly once — a second approval is a conflict", async () => {
    const conversationId = await createConversation(alice.token, "Double click chat");
    const id = await createWriteMission(alice.token, conversationId, "Once only task");

    await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);

    const first = await authRequestJson("post", `${BASE}/ai/missions/${id}/approve`, alice.token);
    expect(first.status).toBe(200);

    const second = await authRequestJson("post", `${BASE}/ai/missions/${id}/approve`, alice.token);
    expect(second.status).toBe(409);

    const tasks = await authRequestJson("get", `${BASE}/tasks`, alice.token);
    const matches = tasks.body.data.items.filter((t: { title: string }) => t.title === "Once only task");
    expect(matches).toHaveLength(1);
  });

  it("finishes the mission when its proposal is confirmed from chat", async () => {
    const conversationId = await createConversation(alice.token, "Chat confirm");
    const id = await createWriteMission(alice.token, conversationId, "Confirmed in chat task");

    const started = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    const actionId = started.body.data.steps[0].pendingActionId as string;

    // The same proposal is also visible in chat. Confirming it there must move
    // the mission on instead of leaving it stuck in WAITING.
    const confirmed = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${actionId}/confirm`,
      alice.token,
    );
    expect(confirmed.status).toBe(200);

    const res = await authRequestJson("get", `${BASE}/ai/missions/${id}`, alice.token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("COMPLETED");
    expect(res.body.data.steps[0].status).toBe("COMPLETED");

    const tasks = await authRequestJson("get", `${BASE}/tasks`, alice.token);
    const matches = tasks.body.data.items.filter(
      (t: { title: string }) => t.title === "Confirmed in chat task",
    );
    expect(matches).toHaveLength(1);
  });

  it("skips a step whose proposal the student declined", async () => {
    const conversationId = await createConversation(alice.token, "Decline chat");
    const id = await createWriteMission(alice.token, conversationId, "Declined task");

    const started = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    const actionId = started.body.data.steps[0].pendingActionId as string;

    const cancelled = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${actionId}/cancel`,
      alice.token,
    );
    expect(cancelled.status).toBe(200);

    // Declining the proposal reconciles the waiting step: the step is skipped,
    // and the mission moves on instead of waiting for ever.
    const res = await authRequestJson("get", `${BASE}/ai/missions/${id}`, alice.token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("COMPLETED");
    expect(res.body.data.steps[0].status).toBe("SKIPPED");

    const tasks = await authRequestJson("get", `${BASE}/tasks`, alice.token);
    expect(tasks.body.data.items.some((t: { title: string }) => t.title === "Declined task")).toBe(false);
  });

  it("refuses another student's approval", async () => {
    const conversationId = await createConversation(alice.token, "Owned chat");
    const id = await createWriteMission(alice.token, conversationId, "Not yours task");
    await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/approve`, bob.token);
    expect(res.status).toBe(404);

    const tasks = await authRequestJson("get", `${BASE}/tasks`, alice.token);
    expect(tasks.body.data.items.some((t: { title: string }) => t.title === "Not yours task")).toBe(false);
  });

  it("reports a mission that both succeeded and failed as PARTIAL", async () => {
    const created = await createMission(alice.token, {
      objective: "One good step, one bad step",
      steps: [
        { toolName: "get_tasks", description: "Read open tasks", arguments: {}, dependsOn: [] },
        { toolName: "definitely_not_a_tool", description: "Not a real tool", arguments: {}, dependsOn: ["0"] },
      ],
    });
    const id = created.body.data.id as string;

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    expect(res.status).toBe(200);

    const mission = res.body.data;
    // Neither COMPLETED nor FAILED describes this: one step is done and one
    // failed.
    expect(mission.status).toBe("PARTIAL");
    expect(mission.steps[0].status).toBe("COMPLETED");
    expect(mission.steps[1].status).toBe("FAILED_TERMINAL");
    expect(mission.terminalError).toBeTruthy();
  });

  it("refuses to start a mission that is already running", async () => {
    const created = await createMission(alice.token, readPlan("Running elsewhere"));
    const id = created.body.data.id as string;

    await prisma.aiMission.update({ where: { id }, data: { status: "RUNNING" } });

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already running/i);
  });

  it("takes over a mission whose worker was lost", async () => {
    const created = await createMission(alice.token, readPlan("Abandoned run"));
    const id = created.body.data.id as string;

    // A RUNNING row older than the stale window means the worker that owned it
    // is gone; the mission must not stay stuck for ever.
    await prisma.aiMission.update({
      where: { id },
      data: { status: "RUNNING", updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const res = await authRequestJson("post", `${BASE}/ai/missions/${id}/execute`, alice.token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("COMPLETED");
  });
});
