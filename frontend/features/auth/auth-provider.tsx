"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { clearSession, getRefreshToken, hasSession, setTokens, type SessionUser } from "@/lib/api/auth-session";
import { SessionExpiredError } from "@/lib/api/errors";
import * as authApi from "./auth-api";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: SessionUser | null;
  status: AuthStatus;
  loading: boolean;
  login: (email: string, password: string, redirectTo?: string) => Promise<SessionUser>;
  register: (input: authApi.RegisterInput) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<unknown>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ME_KEY = ["auth", "me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Whether a session token exists (browser-only check).
  const sessionPresent = typeof window !== "undefined" && hasSession();

  const userQuery = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await authApi.getMe();
      } catch (error) {
        if (error instanceof SessionExpiredError) {
          clearSession();
          return null;
        }
        throw error;
      }
    },
    enabled: sessionPresent,
    retry: 0,
    staleTime: 30_000,
  });

  // Session expiry detected mid-flight.
  useEffect(() => {
    if (userQuery.error instanceof SessionExpiredError) {
      clearSession();
      queryClient.invalidateQueries({ queryKey: ME_KEY });
    }
  }, [userQuery.error, queryClient]);

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
  });

  const registerMutation = useMutation({
    mutationFn: (input: authApi.RegisterInput) => authApi.register(input),
  });

  const logoutMutation = useMutation({
    mutationFn: () => authApi.logout(getRefreshToken() ?? "noop"),
  });

  const login = useCallback(
    async (email: string, password: string, redirectTo?: string) => {
      const result = await loginMutation.mutateAsync({ email, password });
      setTokens(result.accessToken, result.refreshToken);
      queryClient.setQueryData(ME_KEY, result.user);
      router.replace(redirectTo ?? "/dashboard");
      return result.user;
    },
    [loginMutation, queryClient, router],
  );

  const register = useCallback(
    async (input: authApi.RegisterInput) => {
      const user = await registerMutation.mutateAsync(input);
      await login(input.email, input.password);
      return user;
    },
    [login, registerMutation],
  );

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Even if the server call fails, clear the local session.
    }
    clearSession();
    queryClient.setQueryData(ME_KEY, null);
    queryClient.clear();
    router.replace("/login");
  }, [logoutMutation, queryClient, router]);

  const status: AuthStatus = useMemo(() => {
    if (!sessionPresent) return "unauthenticated";
    if (userQuery.isPending) return "loading";
    if (userQuery.data) return "authenticated";
    return "unauthenticated";
  }, [sessionPresent, userQuery]);

  return (
    <AuthContext.Provider
      value={{
        user: userQuery.data ?? null,
        status,
        loading: status === "loading",
        login,
        register,
        logout,
        refetchUser: () => userQuery.refetch(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}