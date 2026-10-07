// ─────────────────────────────────────────────────────────────────────
// Shared test utilities — consumed by every vitest file in tests/.
// ─────────────────────────────────────────────────────────────────────

import { prisma as prismaClient } from "@/lib/prisma";
import { authService } from "@/modules/auth/routes";
import request from "supertest";
import { app } from "@/app";

// ─────────────────────────────────────────────────────────────────────
// Prisma access
// ─────────────────────────────────────────────────────────────────────

export { prismaClient as prisma };

// ─────────────────────────────────────────────────────────────────────
// Database cleanup
// ─────────────────────────────────────────────────────────────────────

/** Delete all rows in foreign-key-safe order. Truncating parent tables
 *  with CASCADE also empties their dependents, but we list every table
 *  explicitly so the helper works regardless of FK configuration. */
export async function cleanupDb() {
  const tables = [
    "users",
    "refresh_tokens",
    "user_settings",
    "academic_years",
    "semesters",
    "courses",
    "tasks",
    "task_subtasks",
    "task_tags",
    "notes",
    "resources",
    "events",
    "study_sessions",
    "goals",
    "goal_milestones",
    "grades",
    "notifications",
    "ai_conversations",
    "ai_messages",
    "ai_study_plans",
    "ai_study_plan_entries",
    "ai_connections",
  ];
  for (const table of tables) {
    await prismaClient.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Authentication helper
// ─────────────────────────────────────────────────────────────────────

/** RegisterAndLogin supports both positional and object styles:
 *   registerAndLogin("email@test.com", "password")
 *   registerAndLogin({ email: "email@test.com", password: "password" })
 * Returns { accessToken, refreshToken, expiresIn, token, user }. */
export async function registerAndLogin(
  emailOrOpts: string | { email: string; password: string },
  password?: string,
) {
  // Resolve opts
  let email: string;
  let pass: string;
  if (typeof emailOrOpts === "string") {
    email = emailOrOpts;
    pass = password ?? `Test${Date.now()}Pass!`;
  } else {
    email = emailOrOpts.email;
    pass = emailOrOpts.password;
  }

  const firstName = "Integration";
  const lastName = "Test";

  const user = await authService.register(email, pass, firstName, lastName);

  const result = await authService.login(email, pass);

  // Normalize return shape: some tests destructure .token, some .accessToken
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    token: result.accessToken, // alias
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      university: user.university,
      department: user.department,
      academicYear: user.academicYear,
      timezone: user.timezone,
      profilePicture: user.profilePicture,
      createdAt: user.createdAt,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// HTTP helpers — support both positional and chained supertest styles
// ─────────────────────────────────────────────────────────────────────

type HttpMethod = "get" | "post" | "patch" | "delete";

// ── authRequestJson (overloaded) ──────────────────────────────────────
//
// Chained style (used by courses + academics tests):
//   const res = await authRequestJson(token).post(path).send(body);
//   // res has .data (the parsed body), .status
//
// Positional style (used by dashboard test):
//   const res = await authRequestJson("post", path, token, body);
//   // res is supertest Response; res.body.data is the payload

export function authRequestJson(token: string): AuthRequestChained;
export function authRequestJson(
  method: HttpMethod,
  path: string,
  token: string,
  body?: unknown,
): Promise<request.Response>;

export function authRequestJson(
  arg1: string | HttpMethod,
  arg2?: string | undefined,
  arg3?: string,
  arg4?: unknown,
): AuthRequestChained | Promise<request.Response> {
  // Chained: single token argument
  if (typeof arg1 === "string" && typeof arg2 === "undefined") {
    return new AuthRequestChained(arg1);
  }
  // Positional: method, path, token, body?
  return positionalAuthRequestJson(
    arg1 as HttpMethod,
    arg2 as string,
    arg3 as string,
    arg4,
  );
}

/** Unwraps the response payload while preserving access to `.data` and outer envelope properties.
 * This allows both `res.data.id` and `res.data.data.id` (or `res.body.data.id`) to work consistently. */
export function createDataProxy(body: any): any {
  if (body === null || typeof body !== "object") {
    return body;
  }

  const inner = body.data !== undefined ? body.data : body;

  if (inner === null || typeof inner !== "object") {
    return inner;
  }

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "data") {
        return inner;
      }
      if (prop in target) {
        const val = Reflect.get(target, prop, receiver);
        return typeof val === "function" ? val.bind(target) : val;
      }
      if (prop in body) {
        const val = Reflect.get(body, prop);
        return typeof val === "function" ? val.bind(body) : val;
      }
      return undefined;
    },
    has(target, prop) {
      if (prop === "data") return true;
      return prop in target || prop in body;
    },
  });
}

/** Chained supertest wrapper — exposes .data (parsed body) instead of .body,
 *  so tests can write `res.data.id` consistently. supertest v7's `request(app)`
 *  has no `.set`, so auth is attached inside each verb method. */
export class AuthRequestChained {
  private test: request.Test;
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.test = undefined as unknown as request.Test;
  }

  private authed(method: HttpMethod, path: string): request.Test {
    return request(app)[method](path).set("Authorization", `Bearer ${this.token}`);
  }

  post(path: string): AuthRequestChained {
    this.test = this.authed("post", path);
    return this;
  }
  get(path: string): AuthRequestChained {
    this.test = this.authed("get", path);
    return this;
  }
  patch(path: string): AuthRequestChained {
    this.test = this.authed("patch", path);
    return this;
  }
  delete(path: string): AuthRequestChained {
    this.test = this.authed("delete", path);
    return this;
  }
  send(body: unknown): AuthRequestChained {
    this.test = this.test.send(body);
    return this;
  }
  expect(status: number): Promise<AuthRequestChained> {
    return this.test.expect(status).then((r) => {
      // attach .data for test convenience
      (r as any).data = createDataProxy(r.body);
      return r as any;
    });
  }

  // Make it thenable so `await chain` (without .expect) resolves to { data, status, ... }
  then<T, TResult1 = AuthRequestChained, TResult2 = never>(
    onFulfilled?: (value: AuthRequestChained) => T | TResult1 | PromiseLike<T | TResult1>,
    onRejected?: (reason: any) => TResult2 | PromiseLike<TResult2>,
  ): Promise<T | TResult1 | TResult2> {
    return this.test.then(
      (res) => {
        const proxy = createDataProxy(res.body);
        const wrapped = new AuthRequestChained(this.token);
        (wrapped as any).test = this.test;
        (wrapped as any).data = proxy;
        (wrapped as any).status = res.status;
        (wrapped as any).headers = res.headers;
        (wrapped as any).body = res.body;
        (res as any).data = proxy;
        if (onFulfilled) return onFulfilled(res as any);
        return res as any;
      },
      onRejected,
    );
  }
}

async function positionalAuthRequestJson(
  method: HttpMethod,
  path: string,
  token: string,
  body?: unknown,
): Promise<request.Response> {
  const req = request(app)[method](path).set("Authorization", `Bearer ${token}`);
  const res = body !== undefined
    ? await (req as request.Test).send(body)
    : await (req as request.Test);
  (res as any).data = createDataProxy(res.body);
  return res as request.Response;
}

// ── authRequest (overloaded) ─────────────────────────────────────────
//
// Positional style used by tasks tests:
//   const res = await authRequest("get", `/tasks/${id}`, token);
//
// Single-token style used by auth test:
//   const res = await authRequest(token);  // GET /api/v1/auth/me

export function authRequest(token: string): Promise<request.Response>;
export function authRequest(
  method: HttpMethod,
  path: string,
  token: string,
): Promise<request.Response>;

export function authRequest(
  arg1: string,
  arg2: string,
  arg3?: string,
): Promise<request.Response> {
  // Two supported call patterns:
  //   authRequest(method, path, token)          (tasks test style)
  //   authRequest(token, method, path)          (auth test style)
  let method: HttpMethod;
  let path: string;
  let token: string;

  if (["get", "post", "patch", "delete"].includes(arg1.toLowerCase())) {
    method = arg1.toLowerCase() as HttpMethod;
    path = arg2;
    token = arg3 as string;
  } else {
    token = arg1;
    method = arg2.toLowerCase() as HttpMethod;
    path = arg3 as string;
  }

  return (request(app)[method](path).set("Authorization", `Bearer ${token}`) as request.Test).then((res) => {
    (res as any).data = createDataProxy(res.body);
    return res as request.Response;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Logout helper (imported by academics test)
// ─────────────────────────────────────────────────────────────────────

export async function logout(refreshToken: string): Promise<request.Response> {
  return request(app).post("/api/v1/auth/logout").send({ refreshToken });
}
