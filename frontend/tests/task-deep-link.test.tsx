import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

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
  getTask: vi.fn(),
  task: undefined as Task | undefined,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), replace: mock.replace }),
  useSearchParams: () => ({
    get: (key: string) => new URLSearchParams(mock.search).get(key),
    toString: () => mock.search,
  }),
}));

vi.mock("@/features/tasks/hooks", async () => {
  const React = await import("react");
  return {
    useTask: (id: string | undefined) => {
      const [state, setState] = React.useState<{ status: "idle" | "success" | "error" }>({ status: "idle" });
      React.useEffect(() => {
        if (!id) return;
        let live = true;
        // Returning the same object lets React bail out: no re-render for a
        // state the mock already has, and no act() warning for it either.
        setState((prev) => (prev.status === "idle" ? prev : { status: "idle" }));
        mock
          .getTask(id)
          .then(() => live && setState({ status: "success" }))
          .catch(() => live && setState({ status: "error" }));
        return () => {
          live = false;
        };
      }, [id]);
      return {
        data: state.status === "success" ? mock.task : undefined,
        isPending: state.status === "idle",
        isError: state.status === "error",
        error: null,
        refetch: () => {},
      };
    },
    useTasks: () => ({
      data: { items: [], hasMore: false, nextCursor: null },
      isPending: false,
      isError: false,
      error: null,
      refetch: () => {},
    }),
    useCompleteTask: () => ({ mutateAsync: async () => undefined }),
    useUpdateTask: () => ({ mutateAsync: async () => undefined }),
    useDeleteTask: () => ({ mutateAsync: async () => undefined }),
    useCreateTask: () => ({ mutateAsync: async () => undefined, isPending: false }),
  };
});

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

async function renderPage() {
  const { default: TasksPage } = await import("@/app/(dashboard)/tasks/page");
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
  mock.task = undefined;
});

describe("task deep link", () => {
  it("opens the task's editor and strips the param from the URL", async () => {
    mock.search = "task=task-1";
    mock.task = TASK;
    mock.getTask.mockResolvedValue(TASK);

    await renderPage();

    expect(await screen.findByText("Edit task")).toBeInTheDocument();
    expect(mock.getTask).toHaveBeenCalledWith("task-1");
    await waitFor(() => expect(mock.replace).toHaveBeenCalledWith("/tasks", { scroll: false }));
  });

  it("keeps the other query params and never spins on a dead id", async () => {
    mock.search = "task=gone&course=course-7";
    mock.getTask.mockRejectedValue(new Error("not found"));

    await renderPage();

    await waitFor(() => expect(mock.replace).toHaveBeenCalled());
    const [url] = mock.replace.mock.calls[0];
    expect(url).toContain("course=course-7");
    expect(url).not.toContain("task=");
    expect(screen.queryByText("Edit task")).not.toBeInTheDocument();
  });
});
