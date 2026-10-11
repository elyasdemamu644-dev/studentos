import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ api: client }));

import {
  createStudyPlan,
  deleteStudyPlan,
  extractStructured,
  listStudyPlans,
  updateStudyPlan,
  updateStudyPlanEntry,
} from "@/features/ai/ai-api";
import {
  createTaskTag,
  deleteTaskTag,
  listTaskTags,
  updateTaskTag,
} from "@/features/tasks/tasks-api";
import { emailNotification } from "@/features/notifications/notifications-api";
import type { StudyPlan } from "@/types/api-types";

const plan: StudyPlan = {
  id: "plan-1",
  title: "Biology review",
  examDate: null,
  courseId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  entries: [],
};

describe("newly exposed backend workflows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the authenticated task tag endpoints for full tag management", async () => {
    client.get.mockResolvedValue([]);
    client.post.mockResolvedValue({ id: "tag-1", taskId: "task-1", name: "Exam", color: null });
    client.patch.mockResolvedValue({ id: "tag-1", taskId: "task-1", name: "Final", color: "#123456" });
    client.delete.mockResolvedValue({ deleted: true });

    await listTaskTags("task-1");
    await createTaskTag("task-1", { name: "Exam" });
    await updateTaskTag("task-1", "tag-1", { name: "Final", color: "#123456" });
    await deleteTaskTag("task-1", "tag-1");

    expect(client.get).toHaveBeenCalledWith("/tasks/task-1/tags");
    expect(client.post).toHaveBeenCalledWith("/tasks/task-1/tags", { name: "Exam" });
    expect(client.patch).toHaveBeenCalledWith("/tasks/task-1/tags/tag-1", { name: "Final", color: "#123456" });
    expect(client.delete).toHaveBeenCalledWith("/tasks/task-1/tags/tag-1");
  });

  it("uses the existing saved study plan and entry contracts", async () => {
    client.get.mockResolvedValue({ items: [plan], hasMore: false, nextCursor: null });
    client.post.mockResolvedValue(plan);
    client.patch.mockResolvedValue(plan);
    client.delete.mockResolvedValue({ deleted: true });

    await listStudyPlans({ limit: 25 });
    await createStudyPlan({ title: plan.title, entries: [{ dayNumber: 1, title: "Review cells", durationMinutes: 30 }] });
    await updateStudyPlan(plan.id, { title: "Final biology review" });
    await updateStudyPlanEntry(plan.id, "entry-1", { status: "COMPLETED", durationMinutes: 45 });
    await deleteStudyPlan(plan.id);

    expect(client.get).toHaveBeenCalledWith("/ai/study-plans?limit=25");
    expect(client.post).toHaveBeenCalledWith("/ai/study-plans", expect.objectContaining({ title: plan.title }));
    expect(client.patch).toHaveBeenNthCalledWith(1, "/ai/study-plans/plan-1", { title: "Final biology review" });
    expect(client.patch).toHaveBeenNthCalledWith(2, "/ai/study-plans/plan-1/entries/entry-1", { status: "COMPLETED", durationMinutes: 45 });
    expect(client.delete).toHaveBeenCalledWith("/ai/study-plans/plan-1");
  });

  it("calls read-only structured extraction and on-demand notification email routes", async () => {
    client.post.mockResolvedValue({ result: { summary: "Study summary" }, repaired: false, provider: "test", model: null });

    const schema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };
    await extractStructured({ prompt: "Summarize my exam topics", schema, ground: true });
    await emailNotification("notification-1");

    expect(client.post).toHaveBeenNthCalledWith(1, "/ai/structured", { prompt: "Summarize my exam topics", schema, ground: true });
    expect(client.post).toHaveBeenNthCalledWith(2, "/notifications/notification-1/email");
  });
});
