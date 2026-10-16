import { describe, expect, it, vi } from "vitest";
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

vi.mock("@/features/ai-connections/hooks", () => ({
  useAiConnections: () => ({
    data: { items: [CONNECTION] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAiProviderSelection: () => ({
    data: {
      mode: "personal",
      defaultAvailable: true,
      personalConnectionAvailable: true,
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSetAiProviderMode: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteConnection: () => ({ mutate: deleteMutate, isPending: false }),
  useUpdateConnection: () => ({ mutate: updateMutate, isPending: false }),
  useActivateConnection: () => ({ mutate: activateMutate, isPending: false }),
}));

vi.mock("@/features/ai-connections/connection-form", () => ({
  AiConnectionFormDialog: () => null,
}));

import { AiConnectionsPanel } from "@/features/ai-connections/connection-list";

describe("AI connection list", () => {
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
});
