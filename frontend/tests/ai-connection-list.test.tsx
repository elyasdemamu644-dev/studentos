import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AiConnection } from "@/types/api-types";

const CONNECTION: AiConnection = {
  id: "conn-1",
  provider: "openai",
  model: "gpt-4o-mini",
  endpoint: null,
  enabled: true,
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const deleteMutate = vi.fn();
const updateMutate = vi.fn();
const activateMutate = vi.fn();
const setModeMutate = vi.fn();
const setModelMutate = vi.fn();

const selection = vi.hoisted(() => ({
  value: {
    mode: "personal" as "default" | "personal",
    defaultAvailable: true,
    personalConnectionAvailable: true,
    defaultProvider: "openai",
    defaultModel: "gpt-4o-mini",
    aiMode: "AUTO" as const,
    model: null as string | null,
  },
}));

vi.mock("@/features/ai-connections/hooks", () => ({
  useAiConnections: () => ({
    data: { items: [CONNECTION] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAiProviderSelection: () => ({
    data: selection.value,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useDefaultAiModels: () => ({
    data: {
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
      group: {
        provider: "openai",
        defaultModel: "gpt-4o-mini",
        models: [
          { id: "gpt-4o-mini", label: "GPT-4o mini" },
          { id: "gpt-4o", label: "GPT-4o" },
        ],
      },
    },
    isPending: false,
    isError: false,
  }),
  useSetAiProviderMode: () => ({ mutate: setModeMutate, isPending: false }),
  useSetAiMode: () => ({ mutate: vi.fn(), isPending: false }),
  useSetExecutionAutonomyMode: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDefaultModel: () => ({ mutate: setModelMutate, isPending: false }),
  useDeleteConnection: () => ({ mutate: deleteMutate, isPending: false }),
  useUpdateConnection: () => ({ mutate: updateMutate, isPending: false }),
  useActivateConnection: () => ({ mutate: activateMutate, isPending: false }),
}));

vi.mock("@/features/ai-connections/connection-form", () => ({
  AiConnectionFormDialog: () => null,
}));

import { AiConnectionsPanel } from "@/features/ai-connections/connection-list";

describe("AI connection list", () => {
  beforeEach(() => {
    selection.value = {
      mode: "personal",
      defaultAvailable: true,
      personalConnectionAvailable: true,
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
      aiMode: "AUTO",
      model: null,
    };
  });

  it("asks for confirmation before deleting a connection", async () => {
    const user = userEvent.setup();
    render(<AiConnectionsPanel />);

    await user.click(screen.getByRole("button", { name: "Delete OpenAI" }));

    expect(deleteMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Delete connection" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete connection" }));

    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate.mock.calls[0][0]).toBe("conn-1");
  });

  it("shows the AI mode and only offers the model picker for Default AI", () => {
    const { unmount } = render(<AiConnectionsPanel />);
    // Personal mode: the Default AI model preference would have no effect.
    expect(screen.getByLabelText("AI mode")).toBeInTheDocument();
    expect(screen.queryByLabelText("Default AI model")).not.toBeInTheDocument();
    unmount();

    selection.value = { ...selection.value, mode: "default" };
    render(<AiConnectionsPanel />);
    expect(screen.getByLabelText("Default AI model")).toBeInTheDocument();
  });

  it("reflects the current Default AI model preference", () => {
    selection.value = { ...selection.value, mode: "default", model: "gpt-4o" };
    render(<AiConnectionsPanel />);

    expect(screen.getByLabelText("Default AI model")).toHaveTextContent("GPT-4o");
  });
});
