import { describe, it, expect, beforeAll, beforeEach } from "vitest";

import { prisma, registerAndLogin, authRequestJson } from "./helpers";
import { executeTool } from "@/services/ai/tools/registry";
import { verifyExecutedAction } from "@/services/ai/tools/verify";
import { MAX_MEMORY_CONTENT_LENGTH } from "@/schemas/ai";
import type { ProposedAction } from "@/services/ai/tools/types";

// ─────────────────────────────────────────────────────────────────────────────
// Saved memories: the student's own list, the assistant's two memory tools, and
// the rules that keep both paths honest.
//
//  * The REST surface always serves the student's list, even when
//    `ai.memoryEnabled` is off — turning memory off must never hide or destroy
//    what they saved.
//  * `save_memory` is a WRITE: gated behind confirmation in manual mode,
//    labelled provenance AI, deduplicated rather than duplicated, and refused
//    outright when the student turned memory off.
//  * Every read is scoped to the owner in the service layer, so neither the
//    routes nor the tools can reach another student's rows.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "/api/v1";

let userA: { token: string; id: string };
let userB: { token: string; id: string };

function ctxFor(
  user: { id: string },
  options: {
    conversationId?: string;
    approvedActions?: ProposedAction[] | null;
    executionAutonomyMode?: "manual" | "autonomous";
  } = {},
) {
  return {
    userId: user.id,
    conversationId: options.conversationId ?? "conv-memory",
    approvedActions: options.approvedActions ?? null,
    executionAutonomyMode: options.executionAutonomyMode ?? "manual",
  };
}

function saveProposal(content: string, category = "OTHER"): ProposedAction {
  return { tool: "save_memory", description: "d", arguments: { content, category } };
}

async function createFor(token: string, body: Record<string, unknown>) {
  return authRequestJson("post", `${BASE}/ai/memories`, token, body);
}

beforeAll(async () => {
  const a = await registerAndLogin("memories-a@test.com", "Pass123!");
  const b = await registerAndLogin("memories-b@test.com", "Pass123!");
  userA = { token: a.token, id: a.user.id };
  userB = { token: b.token, id: b.user.id };
});

beforeEach(async () => {
  await prisma.aiMemory.deleteMany({});
  await prisma.userSetting.deleteMany({});
});

describe("Saved memories REST", () => {
  it("returns nothing for a fresh account", async () => {
    const res = await authRequestJson("get", `${BASE}/ai/memories`, userA.token);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.hasMore).toBe(false);
  });

  it("creates a memory with USER provenance and normalised content", async () => {
    const res = await createFor(userA.token, { content: "  I study\n  best after dark  " });
    expect(res.status).toBe(201);
    expect(res.body.data.provenance).toBe("USER");
    expect(res.body.data.category).toBe("OTHER");
    expect(res.body.data.content).toBe("I study best after dark");
    expect(res.body.data.id).toBeTruthy();
  });

  it("answers 200 with the existing row when the same memory is saved again", async () => {
    const first = await createFor(userA.token, { content: "I prefer morning lectures", category: "PREFERENCE" });
    expect(first.status).toBe(201);

    const second = await createFor(userA.token, { content: "I prefer morning lectures", category: "PREFERENCE" });
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const list = await authRequestJson("get", `${BASE}/ai/memories`, userA.token);
    expect(list.body.data.items).toHaveLength(1);
  });

  it("treats case and spacing differences as the same memory", async () => {
    await createFor(userA.token, { content: "I prefer quiet", category: "OTHER" });
    const res = await createFor(userA.token, { content: "  i prefer    QUIET  ", category: "OTHER" });

    expect(res.status).toBe(200);
    const list = await authRequestJson("get", `${BASE}/ai/memories`, userA.token);
    expect(list.body.data.items).toHaveLength(1);
  });

  it("keeps identical words in different categories apart", async () => {
    await createFor(userA.token, { content: "Databases first", category: "PREFERENCE" });
    const res = await createFor(userA.token, { content: "Databases first", category: "ACADEMIC" });

    expect(res.status).toBe(201);
    const list = await authRequestJson("get", `${BASE}/ai/memories`, userA.token);
    expect(list.body.data.items).toHaveLength(2);
  });

  it("filters by category and honours the page limit", async () => {
    await createFor(userA.token, { content: "Quiet please", category: "PREFERENCE" });
    await createFor(userA.token, { content: "Exam on Friday", category: "ACADEMIC" });
    await createFor(userA.token, { content: "Deadline next week", category: "ACADEMIC" });

    const filtered = await authRequestJson(
      "get",
      `${BASE}/ai/memories?category=ACADEMIC`,
      userA.token,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.items).toHaveLength(2);
    expect(filtered.body.data.items.every((m: { category: string }) => m.category === "ACADEMIC")).toBe(true);

    const paged = await authRequestJson("get", `${BASE}/ai/memories?limit=1`, userA.token);
    expect(paged.status).toBe(200);
    expect(paged.body.data.items).toHaveLength(1);
    expect(paged.body.data.hasMore).toBe(true);
  });

  it("rejects an unknown category filter", async () => {
    const res = await authRequestJson("get", `${BASE}/ai/memories?category=NOT_A_CATEGORY`, userA.token);
    expect(res.status).toBe(400);
  });

  it("reads one memory and never another student's", async () => {
    const created = await createFor(userA.token, { content: "Only Alice sees this" });
    const id = created.body.data.id as string;

    const own = await authRequestJson("get", `${BASE}/ai/memories/${id}`, userA.token);
    expect(own.status).toBe(200);
    expect(own.body.data.content).toBe("Only Alice sees this");

    const foreign = await authRequestJson("get", `${BASE}/ai/memories/${id}`, userB.token);
    expect(foreign.status).toBe(404);

    const unknown = await authRequestJson("get", `${BASE}/ai/memories/no-such-id`, userA.token);
    expect(unknown.status).toBe(404);
  });

  it("updates content and category", async () => {
    const created = await createFor(userA.token, { content: "Draft fact" });
    const id = created.body.data.id as string;

    const res = await authRequestJson("patch", `${BASE}/ai/memories/${id}`, userA.token, {
      content: "Corrected fact",
      category: "GOALS",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe("Corrected fact");
    expect(res.body.data.category).toBe("GOALS");
  });

  it("refuses an update that would duplicate an existing memory", async () => {
    await createFor(userA.token, { content: "First memory", category: "OTHER" });
    const second = await createFor(userA.token, { content: "Second memory", category: "OTHER" });

    const res = await authRequestJson(
      "patch",
      `${BASE}/ai/memories/${second.body.data.id}`,
      userA.token,
      { content: "First memory" },
    );
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/identical/i);
  });

  it("refuses an update that changes nothing", async () => {
    const created = await createFor(userA.token, { content: "Untouched" });
    const res = await authRequestJson(
      "patch",
      `${BASE}/ai/memories/${created.body.data.id}`,
      userA.token,
      {},
    );
    expect(res.status).toBe(400);
  });

  it("rejects blank, whitespace-only and oversized content", async () => {
    const blank = await createFor(userA.token, { content: "" });
    expect(blank.status).toBe(400);

    const spaces = await createFor(userA.token, { content: "   " });
    expect(spaces.status).toBe(400);

    const oversized = await createFor(userA.token, { content: "x".repeat(MAX_MEMORY_CONTENT_LENGTH + 1) });
    expect(oversized.status).toBe(400);
  });

  it("deletes one memory; deleting it twice is a 404", async () => {
    const created = await createFor(userA.token, { content: "Temporary" });
    const id = created.body.data.id as string;

    const first = await authRequestJson("delete", `${BASE}/ai/memories/${id}`, userA.token);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ deleted: true });

    const again = await authRequestJson("delete", `${BASE}/ai/memories/${id}`, userA.token);
    expect(again.status).toBe(404);
  });

  it("clears only the current student's memories", async () => {
    await createFor(userA.token, { content: "Alice one" });
    await createFor(userA.token, { content: "Alice two" });
    await createFor(userB.token, { content: "Bob one" });

    const res = await authRequestJson("delete", `${BASE}/ai/memories`, userA.token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: 2 });

    const bList = await authRequestJson("get", `${BASE}/ai/memories`, userB.token);
    expect(bList.body.data.items).toHaveLength(1);
  });
});

describe("save_memory and get_memories tools", () => {
  it("refuses to save until the student confirms the exact call", async () => {
    const result = await executeTool(
      { name: "save_memory", arguments: { content: "I learn by example" } },
      ctxFor(userA),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");
    expect(result.proposedActions).toHaveLength(1);
    expect(result.proposedActions![0].tool).toBe("save_memory");
    expect(result.proposedActions![0].arguments).toMatchObject({
      content: "I learn by example",
      category: "OTHER",
    });
    expect(await prisma.aiMemory.count()).toBe(0);
  });

  it("does not accept an approval for different arguments", async () => {
    const result = await executeTool(
      { name: "save_memory", arguments: { content: "What the model wants to store" } },
      ctxFor(userA, {
        approvedActions: [saveProposal("What the student approved")],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");
    expect(await prisma.aiMemory.count()).toBe(0);
  });

  it("saves with AI provenance once the student approves the exact call", async () => {
    const result = await executeTool(
      { name: "save_memory", arguments: { content: "I learn by example" } },
      ctxFor(userA, { approvedActions: [saveProposal("I learn by example")] }),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ created: true, provenance: "AI", content: "I learn by example" });

    const row = await prisma.aiMemory.findFirst({ where: { content: "I learn by example" } });
    expect(row?.provenance).toBe("AI");
    expect(row?.userId).toBe(userA.id);
  });

  it("runs without a click when the student chose autonomous execution", async () => {
    const result = await executeTool(
      { name: "save_memory", arguments: { content: "Autonomously remembered", category: "GOALS" } },
      ctxFor(userA, { executionAutonomyMode: "autonomous" }),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ created: true, provenance: "AI", category: "GOALS" });
    expect(await prisma.aiMemory.count()).toBe(1);
  });

  it("returns the already-saved row instead of a second copy", async () => {
    const ctx = ctxFor(userA, { executionAutonomyMode: "autonomous" });
    const first = await executeTool({ name: "save_memory", arguments: { content: "Save once" } }, ctx);
    const second = await executeTool({ name: "save_memory", arguments: { content: "Save once" } }, ctx);

    expect(first.ok).toBe(true);
    expect((first.data as { created: boolean }).created).toBe(true);
    expect(second.ok).toBe(true);
    expect((second.data as { created: boolean }).created).toBe(false);
    expect(await prisma.aiMemory.count()).toBe(1);
  });

  it("refuses both tools when the student turned memory off", async () => {
    const patch = await authRequestJson("patch", `${BASE}/settings`, userA.token, {
      settings: { "ai.memoryEnabled": "false" },
    });
    expect(patch.status).toBe(200);

    const write = await executeTool(
      { name: "save_memory", arguments: { content: "Should not be stored" } },
      ctxFor(userA, { executionAutonomyMode: "autonomous" }),
    );
    expect(write.ok).toBe(false);
    expect(write.error?.code).toBe("memory_disabled");
    expect(await prisma.aiMemory.count()).toBe(0);

    const read = await executeTool({ name: "get_memories", arguments: {} }, ctxFor(userA));
    expect(read.ok).toBe(true);
    expect(read.data).toEqual({ items: [], enabled: false });

    // The student's own list stays reachable through Settings either way.
    const rest = await authRequestJson("get", `${BASE}/ai/memories`, userA.token);
    expect(rest.status).toBe(200);
  });

  it("reads only the student's own saved memories", async () => {
    await createFor(userA.token, { content: "Alice memory one" });
    await createFor(userA.token, { content: "Alice memory two" });
    await createFor(userB.token, { content: "Bob memory one" });

    const forA = await executeTool({ name: "get_memories", arguments: {} }, ctxFor(userA));
    expect(forA.ok).toBe(true);
    expect((forA.data as { items: unknown[]; enabled: boolean }).items).toHaveLength(2);
    expect((forA.data as { enabled: boolean }).enabled).toBe(true);

    const forB = await executeTool({ name: "get_memories", arguments: {} }, ctxFor(userB));
    expect((forB.data as { items: Array<{ content: string }> }).items).toEqual([
      expect.objectContaining({ content: "Bob memory one" }),
    ]);
  });

  it("filters get_memories by category", async () => {
    await createFor(userA.token, { content: "Alice preference", category: "PREFERENCE" });
    await createFor(userA.token, { content: "Alice academic", category: "ACADEMIC" });

    const res = await executeTool(
      { name: "get_memories", arguments: { category: "PREFERENCE" } },
      ctxFor(userA),
    );
    expect(res.ok).toBe(true);
    expect((res.data as { items: Array<{ category: string }> }).items).toEqual([
      expect.objectContaining({ category: "PREFERENCE" }),
    ]);
  });

  it("never verifies a memory belonging to another student", async () => {
    const created = await createFor(userA.token, { content: "Alice's approved fact" });
    const id = created.body.data.id as string;

    const own = await verifyExecutedAction(
      userA.id,
      "save_memory",
      { content: "Alice's approved fact" },
      { id },
    );
    expect(own.verified).toBe(true);

    const foreign = await verifyExecutedAction(
      userB.id,
      "save_memory",
      { content: "Alice's approved fact" },
      { id },
    );
    expect(foreign.verified).toBe(false);
  });
});
