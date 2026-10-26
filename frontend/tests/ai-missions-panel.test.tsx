import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Real mission shapes captured from GET /ai/missions.
const STEP = {
  id: "step-1",
  missionId: "m1",
  stepOrder: 0,
  toolName: "create_task",
  description: "Create the revision task",
  arguments: { title: "Revision" },
  dependsOn: [] as string[],
  status: "WAITING" as const,
  attempts: 1,
  maxAttempts: 3,
  idempotencyKey: "m1:step-1",
  pendingActionId: "pa1",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
  result: null,
  error: null,
  verification: null,
};

const PENDING_ACTION = {
  id: "pa1",
  title: "Create a task",
  status: "PENDING",
  actions: [{ tool: "create_task", description: "Create the revision task" }],
  createdAt: "1970-01-01T00:00:00.000Z",
  expiresAt: "1970-01-01T00:30:00.000Z",
  result: null,
};

function mission(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    userId: "u1",
    conversationId: "c1",
    objective: "Create a revision task",
    contextSnapshot: null,
    status: "WAITING",
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    terminalError: null,
    steps: [STEP],
    pendingAction: PENDING_ACTION,
    ...overrides,
  };
}

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  retry: vi.fn(),
  approve: vi.fn(),
  missions: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));

vi.mock("@/features/ai/hooks", () => ({
  useMissions: () => h.missions,
  useExecuteMission: () => ({ mutateAsync: h.execute, isPending: false }),
  useRetryMission: () => ({ mutateAsync: h.retry, isPending: false }),
  useApproveMission: () => ({ mutateAsync: h.approve, isPending: false }),
  useMissionTools: () => ({
    data: { tools: [], executionAutonomyMode: "manual" },
    isPending: false,
    isError: false,
  }),
  useConversations: () => ({ data: { items: [] }, isPending: false, isError: false }),
  useCreateMission: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { MissionProgress } from "@/components/domain/mission-progress";
import { AiMissionsPanel } from "@/components/domain/ai-missions-panel";

describe("Mission approval", () => {
  it("offers the approval for a mission that is waiting on a change", async () => {
    const user = userEvent.setup();
    render(<MissionProgress mission={mission() as never} compact />);

    expect(screen.getByText(/waiting for your approval/i)).toBeTruthy();
    const approve = screen.getByRole("button", { name: /approve change/i });
    await user.click(approve);

    expect(h.approve).toHaveBeenCalledWith("m1");
  });

  it("does not offer to run a mission that is waiting for an approval", () => {
    render(<MissionProgress mission={mission() as never} compact />);

    // A waiting mission is not waiting to run: running it again would do
    // nothing, and the button would have been a lie.
    expect(screen.queryByRole("button", { name: /^execute$/i })).toBeNull();
  });

  it("offers to run a mission that has not run yet", async () => {
    const user = userEvent.setup();
    render(
      <MissionProgress
        mission={mission({
          status: "QUEUED",
          steps: [{ ...STEP, status: "QUEUED", pendingActionId: null }],
          pendingAction: null,
        }) as never}
        compact
      />,
    );

    const execute = screen.getByRole("button", { name: /^execute$/i });
    await user.click(execute);

    expect(h.execute).toHaveBeenCalledWith("m1");
    expect(screen.queryByRole("button", { name: /approve change/i })).toBeNull();
  });

  it("offers to retry a mission that partly failed", async () => {
    const user = userEvent.setup();
    render(
      <MissionProgress
        mission={mission({
          status: "PARTIAL",
          steps: [
            { ...STEP, status: "COMPLETED", pendingActionId: null },
            { ...STEP, id: "step-2", stepOrder: 1, status: "FAILED_RECOVERABLE", pendingActionId: null },
          ],
          pendingAction: null,
        }) as never}
        compact
      />,
    );

    const retry = screen.getByRole("button", { name: /retry/i });
    await user.click(retry);

    expect(h.retry).toHaveBeenCalledWith("m1");
  });

  it("shows the change that is being asked for in the panel list", () => {
    h.missions.data = { items: [mission()] };
    render(<AiMissionsPanel />);

    expect(screen.getByText(/waiting for your approval/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /approve change/i })).toBeTruthy();
  });
});

describe("Mission creation surface", () => {
  it("offers a real way to create a mission when there are none", async () => {
    h.missions.data = { items: [] };
    const user = userEvent.setup();
    render(<AiMissionsPanel />);

    expect(screen.getByText("No missions yet")).toBeTruthy();
    expect(
      screen.getByText("Create a mission to run a multi-step plan using your tools."),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "New mission" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Create a mission")).toBeTruthy();
    // The builder is the real form, not a placeholder: the objective and the
    // approval conversation are both there.
    expect(screen.getByLabelText("Objective")).toBeTruthy();
    expect(screen.getByText("Conversation (for approvals)")).toBeTruthy();
  });
});
