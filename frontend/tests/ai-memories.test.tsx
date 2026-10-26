import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type MemoryFixture = {
  id: string;
  category: "PREFERENCE" | "ACADEMIC" | "GOALS" | "SCHEDULE" | "OTHER";
  content: string;
  provenance: "USER" | "AI";
  createdAt: string;
  updatedAt: string;
};

const MEMORY: MemoryFixture = {
  id: "mem-1",
  category: "PREFERENCE",
  content: "I revise best in the morning",
  provenance: "USER",
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
};

const AI_MEMORY: MemoryFixture = {
  id: "mem-2",
  category: "ACADEMIC",
  content: "Aiming for 85% in CS301",
  provenance: "AI",
  createdAt: "2026-10-02T08:00:00.000Z",
  updatedAt: "2026-10-02T08:00:00.000Z",
};

const h = vi.hoisted(() => {
  const createMutate = vi.fn();
  const updateMutate = vi.fn();
  const deleteMutate = vi.fn();
  const clearAllMutate = vi.fn();
  const updateSettingsMutate = vi.fn();
  const refetch = vi.fn();
  const memories: {
    data: { items: unknown[]; hasMore: boolean } | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => void;
  } = {
    data: { items: [], hasMore: false },
    isPending: false,
    isError: false,
    error: null,
    refetch,
  };
  const settings: {
    data: Record<string, string | null> | undefined;
    isPending: boolean;
    isError: boolean;
    refetch: () => void;
  } = { data: undefined, isPending: false, isError: false, refetch: vi.fn() };
  return {
    createMutate,
    updateMutate,
    deleteMutate,
    clearAllMutate,
    updateSettingsMutate,
    refetch,
    memories,
    settings,
  };
});

vi.mock("@/features/ai-memories/hooks", () => ({
  useMemories: () => h.memories,
  useCreateMemory: () => ({ mutate: h.createMutate, isPending: false }),
  useUpdateMemory: () => ({ mutate: h.updateMutate, isPending: false }),
  useDeleteMemory: () => ({ mutate: h.deleteMutate, isPending: false }),
  useClearAllMemories: () => ({ mutate: h.clearAllMutate, isPending: false }),
}));

vi.mock("@/features/settings/hooks", () => ({
  useSettings: () => h.settings,
  useUpdateSettings: () => ({ mutate: h.updateSettingsMutate, isPending: false }),
}));

import { MemoryPanel } from "@/features/ai-memories/memory-panel";

describe("assistant memory panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.memories.data = { items: [MEMORY, AI_MEMORY], hasMore: false };
    h.memories.isPending = false;
    h.memories.isError = false;
    h.memories.error = null;
    h.settings.data = undefined;
    h.settings.isPending = false;
    h.settings.isError = false;
  });

  it("lists each saved memory with its category and how it was saved", () => {
    render(<MemoryPanel />);

    expect(screen.getByText(MEMORY.content)).toBeInTheDocument();
    expect(screen.getByText(AI_MEMORY.content)).toBeInTheDocument();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Academic")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Saved by assistant")).toBeInTheDocument();
  });

  it("points the student at the empty state when nothing is saved", () => {
    h.memories.data = { items: [], hasMore: false };
    render(<MemoryPanel />);

    expect(screen.getByText(/No saved memories yet/)).toBeInTheDocument();
    // Nothing to clear, so the destructive shortcut stays hidden.
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("saves a new memory with the trimmed content the API stores", async () => {
    const user = userEvent.setup();
    h.memories.data = { items: [], hasMore: false };
    render(<MemoryPanel />);

    await user.click(screen.getByRole("button", { name: "Add memory" }));
    await user.type(
      screen.getByLabelText("What should Tutor Walle remember?"),
      "  I revise best after lectures  ",
    );
    await user.click(screen.getByRole("button", { name: "Save memory" }));

    expect(h.createMutate).toHaveBeenCalledTimes(1);
    expect(h.createMutate.mock.calls[0][0]).toEqual({
      content: "I revise best after lectures",
      category: "OTHER",
    });
  });

  it("will not submit content that is only whitespace", async () => {
    const user = userEvent.setup();
    render(<MemoryPanel />);

    await user.click(screen.getByRole("button", { name: "Add memory" }));
    const save = screen.getByRole("button", { name: "Save memory" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("What should Tutor Walle remember?"), "   ");
    expect(save).toBeDisabled();
    expect(h.createMutate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("What should Tutor Walle remember?"), "Morning person");
    expect(save).toBeEnabled();
  });

  it("deletes one memory only after confirmation", async () => {
    const user = userEvent.setup();
    h.memories.data = { items: [MEMORY], hasMore: false };
    render(<MemoryPanel />);

    await user.click(screen.getByRole("button", { name: `Delete memory: ${MEMORY.content}` }));
    expect(h.deleteMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete memory" }));
    expect(h.deleteMutate).toHaveBeenCalledTimes(1);
    expect(h.deleteMutate.mock.calls[0][0]).toBe(MEMORY.id);
  });

  it("clears every memory from the header, behind a confirmation", async () => {
    const user = userEvent.setup();
    render(<MemoryPanel />);

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(h.clearAllMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Clear all memories" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear all memories" }));
    expect(h.clearAllMutate).toHaveBeenCalledTimes(1);
  });

  it("treats the switch as on unless the setting says otherwise, and writes it back", async () => {
    const user = userEvent.setup();
    h.settings.data = { "ai.memoryEnabled": "false" };
    render(<MemoryPanel />);

    const toggle = screen.getByRole("switch", { name: "Use saved memories in chats" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);
    expect(h.updateSettingsMutate).toHaveBeenCalledWith({ "ai.memoryEnabled": "true" });
  });

  it("reads an unset memory switch as enabled", () => {
    h.settings.data = {};
    render(<MemoryPanel />);

    expect(
      screen.getByRole("switch", { name: "Use saved memories in chats" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("surfaces a load failure with a retry", async () => {
    const user = userEvent.setup();
    h.memories.isError = true;
    h.memories.error = new Error("memory service unavailable");
    render(<MemoryPanel />);

    expect(screen.getByRole("alert")).toHaveTextContent("memory service unavailable");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.refetch).toHaveBeenCalled();
  });
});
