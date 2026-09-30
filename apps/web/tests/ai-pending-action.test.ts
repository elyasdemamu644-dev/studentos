import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPendingAction } from "@/features/ai/ai-api";
import { setTokens } from "@/lib/api/auth-session";

/**
 * The API wraps the pending action in an extra object:
 *   { success: true, data: { pendingAction: PendingAction | null } }
 * The api client unwraps `data`, so `getPendingAction` receives
 * `{ pendingAction: ... }` — not a `PendingAction`. The page feeds that value
 * straight into `PendingActionCard`, which reads `action.actions.map(...)`.
 */

const SERVER_PENDING_ACTION = {
  id: "action-1",
  title: "Add a task",
  status: "PENDING",
  actions: [{ tool: "create_task", description: "Add a task" }],
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  result: null,
};

function mockPendingActionResponse(pendingAction: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { pendingAction } }),
    }),
  );
}

describe("getPendingAction", () => {
  beforeEach(() => {
    setTokens("test-access-token", "test-refresh-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the pending action itself, not the envelope object", async () => {
    mockPendingActionResponse(SERVER_PENDING_ACTION);

    const result = await getPendingAction("conversation-1");

    expect(result).toEqual(SERVER_PENDING_ACTION);
    // The card renders `action.actions.map(...)` — this is the crash.
    expect(Array.isArray(result?.actions)).toBe(true);
  });

  it("returns null when there is no pending action", async () => {
    mockPendingActionResponse(null);

    const result = await getPendingAction("conversation-1");

    expect(result).toBeNull();
  });
});
