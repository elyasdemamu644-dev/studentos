import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookOpen } from "lucide-react";

import { CommandPaletteProvider, useCommandPalette } from "@/components/layout/command-palette";
import type { Page, Task } from "@/types/api-types";

/**
 * The palette is the app's search and command surface. What is easy to break
 * without noticing: the ⌘K/Ctrl+K shortcut, the 250ms debounce that keeps
 * typing from firing a request per keystroke, and the fact that results are
 * real server data (tasks/courses/notes/resources `?search=`) rather than a
 * client-side list — so a result must navigate to a deep link that opens it.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const api = vi.hoisted(() => ({
  listTasks: vi.fn(),
  listCourses: vi.fn(),
  listNotes: vi.fn(),
  listResources: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
}));
vi.mock("@/features/tasks/tasks-api", () => ({ listTasks: api.listTasks }));
vi.mock("@/features/courses/courses-api", () => ({ listCourses: api.listCourses }));
vi.mock("@/features/notes/notes-api", () => ({ listNotes: api.listNotes }));
vi.mock("@/features/resources/resources-api", () => ({ listResources: api.listResources }));

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

const EMPTY_TASKS: Page<Task> = { items: [], hasMore: false, nextCursor: null };

function Trigger() {
  const { open } = useCommandPalette();
  return (
    <button type="button" onClick={open}>
      open palette
    </button>
  );
}

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommandPaletteProvider pages={[{ href: "/courses", label: "Courses", icon: BookOpen }]}>
        <Trigger />
      </CommandPaletteProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("command palette", () => {
  it("opens on Ctrl+K, Escape closes it again", async () => {
    renderPalette();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("combobox")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
  });

  it("offers the real quick actions before anything is typed", () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByRole("option", { name: /Add task/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Add note/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Go to|Courses/ })).toBeInTheDocument();
  });

  it("searches the server after the debounce and opens the matching task", async () => {
    api.listTasks.mockResolvedValue({ items: [TASK], hasMore: false, nextCursor: null });
    api.listCourses.mockResolvedValue([]);
    api.listNotes.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
    api.listResources.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });

    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await userEvent.type(screen.getByRole("combobox"), "eigen");

    // One request for the whole word, not one per keystroke.
    await waitFor(() => expect(api.listTasks).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(api.listTasks).toHaveBeenCalledWith({ search: "eigen", limit: 5 });

    expect(await screen.findByRole("option", { name: /Eigenvalues revision/ })).toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    expect(nav.push).toHaveBeenCalledWith("/tasks?task=task-1");
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
  });

  it("offers to ask the AI about the typed term", async () => {
    api.listTasks.mockResolvedValue(EMPTY_TASKS);
    api.listCourses.mockResolvedValue([]);
    api.listNotes.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });
    api.listResources.mockResolvedValue({ items: [], hasMore: false, nextCursor: null });

    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await userEvent.type(screen.getByRole("combobox"), "indexing");

    const ask = await screen.findByRole("option", { name: /Ask the AI assistant about/ });
    await userEvent.click(ask);
    expect(nav.push).toHaveBeenCalledWith("/ai?prompt=indexing");
  });
});
