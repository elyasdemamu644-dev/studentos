import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

const UPDATED_USER = { id: "u1", email: "a@b.c", name: "New Name" };

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/features/settings/settings-api", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  updateProfile: vi.fn(async () => UPDATED_USER),
  changePassword: vi.fn(),
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

import { ME_KEY } from "@/features/auth/keys";
import { useUpdateProfile } from "@/features/settings/hooks";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("settings profile mutation", () => {
  it("writes the updated user to the session-user cache key, not a lookalike", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useUpdateProfile(), { wrapper: makeWrapper(client) });

    await result.current.mutateAsync({ name: "New Name" } as never);

    await waitFor(() => {
      expect(client.getQueryData(ME_KEY)).toMatchObject(UPDATED_USER);
    });
    expect(client.getQueryData(["auth", "user"])).toBeUndefined();
  });
});
