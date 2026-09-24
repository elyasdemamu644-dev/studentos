// Auth API — typed calls into the /auth endpoints.
import { api } from "@/lib/api/client";
import type { SessionUser } from "@/lib/api/auth-session";

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  university?: string;
  department?: string;
  academicYear?: string;
  timezone?: string;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return api.post<LoginResult>("/auth/login", { email, password });
}

export async function register(input: RegisterInput): Promise<SessionUser> {
  return api.post<SessionUser>("/auth/register", input);
}

export async function logout(refreshToken: string): Promise<void> {
  await api.post<void>("/auth/logout", { refreshToken });
}

export async function getMe(): Promise<SessionUser> {
  return api.get<SessionUser>("/auth/me");
}