import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";

import type { Task } from "@/types/api-types";

/**
 * `/tasks?task=<id>` is how the command palette (and any other deep link)
 * opens a specific task's editor. Two things can go wrong silently: the
 * dialog never opens (the fetch is ignored), or the param is left in the URL
 * so Back/refresh reopens a dialog the user already dismissed.
 */

const mock = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  deleteTask: vi.fn(),
  listSubtasks: vi.fn(),
  createSubtask: vi.fn(),
  updateSubtask: vi.fn(),
  deleteSubtask: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: mock.replace }),
  useSearchParams: () => ({
    get: (key: string) => new URLSearchParams(mock.search).get(key),
    toString: () => mock.search,
  }),
}));

vi.mock("@/features/tasks/tasks-api", () => ({
  listTasks: mock.listTasks,
  getTask: mock.getTask,
  createTask: mock.createTask,
  updateTask: mock.updateTask,
  completeTask: mock.completeTask,
  deleteTask: mock.deleteTask,
  listSubtasks: mock.listSubtasks,
  createSubtask: mock.createSubtask,
  updateSubtask: mock.updateSubtask,
  deleteSubtask: mock.deleteSubtask,
}));

vi.mock("@/features/courses/hooks", () => ({
  useCourses: () => ({ data: [], isPending: false }),
}));
vi.mock("@/features/academics/use-academic-breadcrumb", () => ({
  useAcademicBreadcrumb: () => [],
}));

const TASK: Task = {
  id: "task-1",
  courseId: null,
  title: "Eigenvalues revision",
  description: null,
  type: "REVISION",
  priority: "HIGH",
  status: "TODO",
  dueDate: null,
  estimatedMinutes: null,
  completedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  course: null,
};

let TasksPage: ComponentType;

// The full page pulls in the task form's Radix dialog tree; importing it here,
// before the tests' clock starts, keeps the import cost out of every test body.
beforeAll(async () => {
  ({ default: TasksPage } = await import("@/app/(dashboard)/tasks/page"));
});

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TasksPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  mock.search = "";
});

describe("task deep link", () => {
  it("opens the task's editor and strips the param from the URL", async () => {
    mock.search = "task=task-1";
    mock.getTask.mockResolvedValue(TASK);
    mock.listTasks.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });

    await renderPage();

    expect(await screen.findByText("Edit task")).toBeInTheDocument();
    expect(mock.getTask).toHaveBeenCalledWith("task-1");
    await waitFor(() => expect(mock.replace).toHaveBeenCalledWith("/tasks", { scroll: false }));
  });

  it("keeps the other query params and never spins on a dead id", async () => {
    mock.search = "task=gone&course=course-7";
    mock.getTask.mockRejectedValue(new Error("not found"));
    mock.listTasks.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });

    await renderPage();

    await waitFor(() => expect(mock.replace).toHaveBeenCalled());
    const [url] = mock.replace.mock.calls[0];
    expect(url).toContain("course=course-7");
    expect(url).not.toContain("task=");
    expect(screen.queryByText("Edit task")).not.toBeInTheDocument();
  });
});
