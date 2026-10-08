# AI_CONTEXT — StudentOS source of truth

> **Snapshot:** 2026-09-29, after the first Phase 3 (Integration QA) browser pass. Every claim below was read from code or produced by running a command in this repo. Anything not verifiable is listed in [Unverified](#unverified).
> **Scope:** this file is the onboarding document for AI agents. Human setup lives in [README.md](README.md); agent workflow rules live in [INSTRUCTIONS_FOR_AGENT.md](INSTRUCTIONS_FOR_AGENT.md).
> **Latest AI work:** AI Assistant chat made persistent and context-aware — history window, retry dedupe, conversation recency and reload correctness — see [§17 Change log](#17-latest-ai-work--change-log).

---

## READ ONLY WHAT YOU NEED

**Do not scan the whole repository.** This file already tells you the architecture, the conventions, and where things live. Reading all ~280 source files wastes time and tokens and tends to *reduce* accuracy.

Read in this order, and stop as soon as you have what you need:

1. **This file** (always, in full — it is the map).
2. **[INSTRUCTIONS_FOR_AGENT.md](INSTRUCTIONS_FOR_AGENT.md)** (the workflow contract).
3. **`docs/api/openapi.yaml`** — the current OpenAPI 3.1.1 spec: real YAML, all 60 paths / 111 operations, regenerated 2026-10-07 (gap #2 resolved). Still derived from the code by hand, so the code wins on any conflict. `docs/audits/` is archived history, never current state.
4. **Only the files your task touches** — use the lookup tables below to resolve names to paths.
5. **The matching test file** — tests encode the contract better than the code does.
6. **Only if still blocked**, widen the search.

### Task → files to read

| Task | Read these | Nothing else unless blocked |
| --- | --- | --- |
| Add/change an API endpoint | `src/{routes,services,schemas}/<domain>.ts` | `src/routes/index.ts` (only if mounting), `tests/<domain>.test.ts` |
| Change list pagination / response envelope | `src/services/<domain>.ts` | `packages/shared/src/schemas/api.ts` |
| Change error codes / status mapping | `src/config/errors.ts`, `src/config/http.ts` | `packages/shared/src/schemas/api.ts` (`ERROR_CODES`) |
| Change auth / tokens / login | `src/routes/auth.ts`, `src/middlewares/auth.ts` | `src/utils/jwt.ts` — the single JWT implementation (signing *and* verification) |
| Change DB schema | `prisma/schema.prisma` | `prisma/seed.ts`, `tests/helpers.ts` (table list) |
| Add a web page | `app/(dashboard)/<name>/page.tsx`, `components/layout/app-shell.tsx` | `features/<domain>/` |
| Change HTTP transport / token refresh | `frontend/lib/api/client.ts` | `frontend/lib/api/auth-session.ts`, `frontend/lib/api/errors.ts` |
| Change data fetching on web | `frontend/features/<domain>/hooks.ts` | `*-api.ts` in same folder |
| Change AI behaviour | `src/services/ai/{service,context,provider}.ts` | `tests/ai.test.ts` |
| Change AI provider connections | `src/{routes,services,schemas}/ai-connections.ts`, `src/utils/encryption.ts` | `tests/ai-connections.test.ts`, `src/services/ai/provider.ts` (error classes + `getActiveUserConnection`) |
| Change theme / styling tokens | `frontend/lib/theme/themes.ts` | `frontend/tailwind.config.ts`, `frontend/app/globals.css` |
| Change a shared frontend type | `frontend/types/api-types.ts` | — |

### Anti-patterns

- Do not read `node_modules/`, `.next/`, `dist/`, `.turbo/` — never useful.
- Do not read every file in `frontend/features/*` to learn "the pattern". Read **one** feature folder; the pattern is uniform.
- Do not read `prisma/schema.prisma` end-to-end for a non-schema task; grep the model you need.
- Do not re-derive the build/test commands. They are in [Commands](#11-commands).
- Do not trust `docs/audits/*.md` for current state — all three are archived snapshots (see [Known issue #13](#13-known-gaps--issues)). This file wins.

---

## 1. Purpose & product vision

StudentOS is a **personal academic operating system** for a single student: one place to hold their academic years, semesters, courses, tasks, calendar/exams, notes, resources, study sessions, goals, grades and notifications, with an AI assistant grounded in that same data.

Design intent, as evidenced by the code:

- **Single-tenant, strictly owner-scoped.** Every user-owned row is filtered by `userId` in the query itself. There is no admin/teacher surface in the code.
- **AI is a grounded assistant, not a chat toy.** The AI layer builds a bounded snapshot of the user's *own* StudentOS data and injects it as system context.
- **No mock data anywhere.** The web app talks exclusively to the real API.
- **Graceful degradation over hard failure.** Unconfigured AI, or unavailable S3, produce controlled HTTP errors rather than pretending to work.

---

## 2. Current phase & status

| Field | Value |
| --- | --- |
| Phase | **Phase 3 (capstone) complete 2026-10-07.** All phases are closed: Phase 0 (regenerated migrations), Phase 1 (backend foundation), Phase 2 (OpenAPI + contract safety + production readiness), Phase 3 (production config guardrails, owner indexes, IDOR sweep, migration deploy verification, live smoke, docs refresh). |
| Last committed checkpoint | `18b4f3a` — *refactor: reorganize StudentOS project structure* (on `task/studentos-folder-migration`, **not pushed**); `main` is still at `96c106e`, in sync with `origin/main` |
| Working tree | **Uncommitted (intentionally).** The folder migration is committed as `18b4f3a`; the AI Assistant chat fixes + the frontend product upgrade (see §17) are a modified working tree — 11 backend files (`provider.ts`, `service.ts`, `zod-validator-shim.ts`, the 4 searchable services, 3 test files) and 15 frontend files (pages for dashboard/calendar/tasks/resources/academics/courses/study/notes/ai, `app-shell.tsx`, `ai-conversation-sidebar.tsx`, `features/resources|tasks/hooks.ts`) plus 3 new files: `components/layout/command-palette.tsx`, `tests/command-palette.test.tsx`, `tests/task-deep-link.test.tsx`. Nothing pushed yet. |
| Tests | API **435/435 pass** (29 files), Web **236/236 pass** (20 files) — 0 failures, re-run 2026-10-08. |
| Builds | `tsc` (API) **passes**; `next build` (Web) **passes**, 19 routes. Re-verified 2026-10-08. |
| Lint | `next lint` **clean** (web only, `app`, `components`, `features`, `lib`, `types`, `tests`); root `pnpm lint` clean. No lint config exists for the API — `tsc` is its gate. |
| CI | **`.github/workflows/ci.yml` exists** — api job (postgres:16 service, `prisma migrate deploy` into an empty test DB, tests, `tsc`, build), web job, lint job. API path replayed locally: green. |
| Overall | Green: suites, typecheck, lint, builds, `prisma validate`, `migrate status`, and a live HTTP smoke run. Docs describe the current state. |

---

## 3. Git & checkpoint state

Branch `task/studentos-folder-migration` (the `apps/*` → `backend/` + `frontend/` folder migration, committed as `18b4f3a`, **not yet pushed**). Most recent commits (`git log --oneline`):

```text
18b4f3a  refactor: reorganize StudentOS project structure
96c106e  fix: restore ESNext/Bundler module resolution after the Vercel merge
9cee0c2  Merge remote-tracking branch 'origin/main'
2577a8b  phase3: apply migrations in CI before the API tests
7b44461  phase3: production config guardrails, owner indexes migration, IDOR sweep + config tests
```

`main` is **in sync with `origin/main`** — everything through `96c106e` has been pushed. The folder migration is committed only on this branch (`18b4f3a`: 285 renames into `backend/` + `frontend/`, 8 modified root configs, 0 deletions) and has **not been pushed**; `main` still describes the pre-migration `apps/api` + `apps/web` layout. Gaps #22, #26 and #28 still live only in gitignored files (`backend/.env`, `frontend/.env.local`), so a fresh clone must create them itself — the README setup steps do exactly that.

---

## 4. Monorepo structure

pnpm workspaces + Turborepo. 3 packages. This is the **verified actual layout** after the 2026-09-27 cleanup.

```text
StudentOS/
├── AI_CONTEXT.md                  <- you are here
├── INSTRUCTIONS_FOR_AGENT.md      <- agent workflow contract
├── README.md                      <- human setup
├── package.json                   <- root scripts (turbo passthrough, pnpm only)
├── pnpm-workspace.yaml            <- packages: backend, frontend, packages/*
├── pnpm-lock.yaml                 <- the only lockfile
├── turbo.json                     <- task graph
├── docs/
│   ├── api/openapi.yaml           <- OpenAPI 3.1.1, full surface (regenerated 2026-10-07, gap #2)
│   └── audits/                    <- archived historical reports, not current state
│       ├── qa-final-report.md         (was QA_FINAL_REPORT.md)
│       ├── frontend-progress.md       (was frontend/FRONTEND_PROGRESS.md)
│       └── phase-2-ai-connections-audit.md (was Phase2-Audit.md)
├── scripts/
│   └── verify-prisma-baseline.sh  <- manual Prisma/migration verification
├── backend/                      <- @studentos/api  (Express 5 + Prisma + PostgreSQL)
│   ├── prisma/                   <- schema.prisma, seed.ts, migrations/
│   ├── src/                      <- app.ts, server.ts, vercel.ts, config/, middlewares/, routes/, schemas/, services/, utils/
│   └── tests/                    <- 29 *.test.ts + helpers.ts + setup.ts (flat, 31 files)
├── frontend/                     <- @studentos/web  (Next.js 14 App Router)
│   ├── app/  components/  features/  lib/  types/
│   └── tests/                    <- 18 *.test.ts + setup.ts (flat, 19 files)
└── packages/
    └── shared/                    <- @studentos/shared (Zod schemas)
        └── src/schemas/           <- the only source folder
```

`.github/workflows/ci.yml` is the only thing in `.github/`. There is **no** `apps/mobile/`, no `packages/config/`, no `packages/ui/`, and no `backend/types/` — those were empty or orphaned and have been removed.

| Package | Name | Stack |
| --- | --- | --- |
| `backend` | `@studentos/api` | Express 5, TypeScript (ESM), Prisma 6, PostgreSQL, Zod, jose, `@node-rs/argon2`, Vitest + supertest |
| `frontend` | `@studentos/web` | Next.js 14.2.30 (App Router), React 18, TypeScript `strict`, Tailwind 3.4, Radix UI, TanStack Query v5, react-hook-form + Zod, Recharts, lucide-react, sonner, Vitest + jsdom + Testing Library |
| `packages/shared` | `@studentos/shared` | Zod schemas. Depends on `zod` — **do not remove it** (it caused a past build break) |

`packages/shared` exports raw TS via a single `exports` entry: `@studentos/shared/schemas/<name>` → `./src/schemas/<name>.ts`. The dead `./types/*`, `./utils/*` and `./constants/*` entries were removed (gap #17 resolved). Only 9 of the 12 schema files are imported — see gap #21.

---

## 5. Backend architecture

```text
src/server.ts    bootstrap: validateConfig() -> prisma.$connect() -> app.listen(port)
                 graceful shutdown on SIGTERM/SIGINT (10s force-exit); only runs when executed directly
src/app.ts       express app: helmet -> cors -> compression -> json(1mb) -> urlencoded
                 -> requestLogger -> /health -> [apiRateLimiter] /api/v1 -> notFoundHandler -> globalErrorHandler
                 (the limiter is mounted on /api/v1 only, so /health stays probeable; it no-ops under NODE_ENV=test)
src/routes/index.ts   the apiRouter: mounts every domain router under /api/v1 (single aggregator file)
src/config/      index.ts (env + validateConfig), errors.ts (ApiError), http.ts (logging + handlers)
utils/       prisma.ts, jwt.ts, zod-validator-shim.ts, rate-limit.ts, encryption.ts   (cross-cutting infra only)
src/routes/<domain>.ts + src/services/<domain>.ts + src/schemas/<domain>.ts   (+ auth guard: src/middlewares/auth.ts; AI internals: src/services/ai/)
```

The `src/middlewares/` and `src/utils/` folders exist because the migration gave every file a responsibility-true home: the auth guard lives in `src/middlewares/auth.ts` and is re-exported from `routes/auth.ts`; all 17 route files import it from `@/routes/auth`. There is still no `src/controllers/` — HTTP handling lives in the route files — and no `src/@types/`.

**Layer convention (one file per domain per layer):** `routes/<domain>.ts` (HTTP: validation, auth, status codes) → `services/<domain>.ts` (Prisma queries, ownership scoping, `map*` response mappers) → `schemas/<domain>.ts` (Zod). Services are also imported directly by tests and, for auth, by other route files. No barrel `index.ts`; import the specific file.

**Aggregated domains:** `routes/academics.ts` is the only aggregator besides `routes/index.ts` — it mounts `routes/academic-years.ts` and `routes/semesters.ts`, each of which has its own `schemas/` and `services/` counterpart files.

**Mounting quirk:** `subtasks` and `task-tags` are mounted at `/` (not `/tasks`) because their routers declare the full `/tasks/:taskId/...` paths themselves. Do not "fix" this.

**Validation:** `zValidator` is imported from `@/utils/zod-validator-shim` — a small hand-written wrapper around `zod.safeParse` (it does **not** use the `zod-express` package, which is a declared but unused dependency). It accepts `body` / `query` / `params` / `headers`, writes parsed data back onto the request, and passes a raw `ZodError` to `next()` so `globalErrorHandler` answers 400. Prefer the shim; do not swap in `express-zod-api` casually.

**Rate limiting is implemented** in `src/utils/rate-limit.ts`: a dependency-free fixed-window limiter keyed on client IP, mounted in `app.ts` on `/api/v1` only (so `/health` stays reachable). Budget comes from `RATE_LIMIT_MAX_REQUESTS` (default 100) per `RATE_LIMIT_WINDOW_SECONDS` (default 60). It **no-ops when `config.isTest`** — pass `{ enabled: true }` to exercise it, as `tests/error-envelope.test.ts` does. Rejections answer 429 `RATE_LIMITED` through the standard envelope with `Retry-After` and `X-RateLimit-*` headers. See gap #5.

### API conventions (enforced by tests)

| Rule | Detail |
| --- | --- |
| Base path | `/api/v1` (mounted in `app.ts:44`); health is outside it at `/health` |
| Public routes | `/health`, and `/api/v1/auth/{register,login,refresh,logout}` |
| Everything else | Requires `Authorization: Bearer <access token>` |
| Success envelope | `{ success: true, data: T }` |
| Error envelope | `{ success: false, error: { code, message, details } }` — `details` is **always present**: a list of `{ path, message, code }` for `VALIDATION_ERROR`, an object for errors that carry context, `[]` otherwise |
| Pagination | **Cursor-based.** Query: `limit` (int 1–100, default **50**) + `cursor` (id). Response: `{ items, hasMore, nextCursor }`. Implemented via `take: limit + 1` then slice. |
| Cross-user access | Returns **404**, never 403 — ownership is part of the query filter, so other users' rows simply do not match. |
| Duplicate create | 409 `CONFLICT` / `DUPLICATE_VALUE` |
| Validation failure | 400 `VALIDATION_ERROR` |
| Server error | 500 `INTERNAL_ERROR` with a fixed message in **every** environment; the stack and the underlying error go to the server log only |

**Dead code warning:** `packages/shared/src/schemas/api.ts` defines `PaginationInput`/`PaginationOutput` on a `page`/`limit`/`total` model. **Nothing uses them.** The real convention is the cursor scheme above. Do not build on the page-based types.

### Error code mapping (`src/config/http.ts`)

| Source | HTTP | Code |
| --- | --- | --- |
| body-parser `entity.parse.failed` | 400 | `INVALID_JSON` |
| body-parser `entity.too.large` | 400 | `PAYLOAD_TOO_LARGE` |
| `ApiError` (incl. 429 from the rate limiter) | as constructed | as constructed |
| `ZodError` | 400 | `VALIDATION_ERROR` (carries the per-field `details` list) |
| Prisma `P2002` | **409** | `CONFLICT` |
| Prisma `P2025` | **404** | `NOT_FOUND` |
| Prisma `P2023` | 400 | `VALIDATION_ERROR` |
| Prisma `P2003`/`P2007` | 400 | `FOREIGN_KEY_VIOLATION` |
| Prisma other `P2xxx` | 400 | `DATABASE_ERROR` |
| anything else | 500 | `INTERNAL_ERROR` |

Every branch logs the underlying error with a `req_*` request id and returns a **fixed, safe message**. Raw Prisma text quotes column names, constraint names, submitted values and the failing source line, so it never reaches a client in any environment; the same applies to 500s (there is no `INTERNAL_ERROR_DEV` any more). Services still pre-check ownership and existence and throw typed `NotFoundError` / `ConflictError` — the Prisma mapping is only the backstop for races and unguarded constraints. Standard codes live in `ERROR_CODES` in `packages/shared/src/schemas/api.ts`; auth-specific codes (`AUTH_*`) are defined in `src/middlewares/auth.ts`.

### Route surface

| Domain | Endpoints (under `/api/v1`) |
| --- | --- |
| health | `GET /health` (public; returns status, service, version, environment, database, timestamp) |
| auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` — **that is the complete set**; there is no profile-update or change-password route |
| academics | `GET/POST /academics/academic-years`, `GET/PATCH/DELETE /academics/academic-years/:id`; identical tree under the alias `/academics/years`; same five for `/academics/semesters` |
| courses | `GET/POST /courses`, `GET/PATCH/DELETE /courses/:id`, `GET /courses/:id/summary` |
| tasks | `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `POST /tasks/:id/complete` (auto-sets `completedAt`) |
| subtasks | `GET/POST /tasks/:taskId/subtasks`, `PATCH/DELETE /tasks/:taskId/subtasks/:id` (ordered by `position`) |
| task tags | `GET/POST /tasks/:taskId/tags`, `PATCH/DELETE /tasks/:taskId/tags/:id` (duplicate name → 409) |
| dashboard | `GET /dashboard` — aggregate: stats, upcoming/recent tasks, today's + upcoming events, today's study minutes/count + recent sessions, courses, active goals, recent notes, recent grades, unread notification count |
| notes | `GET/POST /notes`, `GET/PATCH/DELETE /notes/:id` |
| resources | `GET/POST /resources`, `GET/PATCH/DELETE /resources/:id` (URL only — see gaps) |
| events | `GET/POST /events`, `GET/PATCH/DELETE /events/:id`; filters `courseId`, `type`, date range |
| study sessions | `GET/POST /study-sessions`, `GET/PATCH/DELETE /study-sessions/:id`, `POST /study-sessions/:id/complete`; list returns a `summary` (count + total minutes) |
| goals | `GET/POST /goals`, `GET/PATCH/DELETE /goals/:id`; `GET/POST /goals/:goalId/milestones`, `PATCH/DELETE /goals/:goalId/milestones/:id` |
| grades | `GET/POST /grades`, `GET/PATCH/DELETE /grades/:id` (`score` ≤ `maxScore` enforced) |
| notifications | `GET /notifications` (newest first + `unreadCount`), `GET /notifications/:id`, `POST /notifications/:id/read`, `PATCH /notifications/:id`, `POST /notifications/read-all`, `POST /notifications/generate` |
| settings | `GET /settings`, `PATCH /settings` (upsert; `null` value deletes a key; **strings only**) |
| ai | `GET/POST /ai/conversations`, `GET/DELETE /ai/conversations/:id`, `GET/POST /ai/conversations/:id/messages`, `GET/POST /ai/study-plans`, `GET/PATCH/DELETE /ai/study-plans/:id`, `GET /ai/study-plans/:id/entries`, `PATCH /ai/study-plans/:id/entries/:entryId` |
| ai connections | `GET/POST /ai-connections`, `GET/PATCH/DELETE /ai-connections/:id`, `GET /ai-connections/active`, `POST /ai-connections/test` (ad-hoc, unsaved creds), `POST /ai-connections/:id/test` (saved, server-side creds), `POST /ai-connections/:id/activate` |

`POST /notifications/generate` and `GET /courses/:id/summary` are recent additions.

**`GET /ai-connections/active` must be registered before `GET /ai-connections/:id`**, otherwise Express matches the literal `active` as an `:id` and 404s it. Same trap applies to any future literal-path route in a `/:id` router.

---

## 6. Frontend architecture

```text
app/
  layout.tsx  globals.css  providers.tsx
  (auth)/     layout, /login, /register
  (dashboard)/ layout (AppShell + auth guard), and pages:
               /  /dashboard  /courses  /courses/[id]  /academics  /tasks
               /calendar  /exams  /notes  /notifications  /resources
               /study  /goals  /analytics  /ai  /settings
lib/      api/{client,auth-session,errors}.ts  theme/{themes,theme-provider}.tsx
              format.ts  labels.ts  utils.ts
features/ <domain>/{*-api.ts, hooks.ts, *-form.tsx}
components/ ui/ (Radix primitives)  domain/ (course-card, task-card, event/goal cards removed — see §17)
              layout/app-shell.tsx  page-header.tsx  states.tsx  feedback.tsx  theme-toggle.tsx
              error-boundary.tsx
types/    api-types.ts   <- shared frontend DTO types, imported by 55 files across all layers
tests/         18 *.test.ts + setup.ts   (NOT colocated — see §12)
```

There is deliberately **no** `hooks/` or `src/schemas/`: every hook is feature-local (`features/<domain>/hooks.ts`) and every Zod schema is feature-local (`features/<domain>/schemas.ts` or beside the form). Do not create top-level folders for these.

| Concern | Implementation |
| --- | --- |
| Transport | **Only** `lib/api/client.ts`. Components never call `fetch`. Exposes `api.get/post/patch/put/delete`, injects the bearer token, unwraps the envelope, and maps failures to `ApiClientError` / `NetworkError` / `SessionExpiredError`. |
| Token refresh | Automatic, **retry-once**: a 401 with code `AUTH_TOKEN_EXPIRED` or `AUTH_INVALID_TOKEN` triggers `POST /auth/refresh`, then one replay. Concurrent refreshes share a single in-flight promise. Failure → `SessionExpiredError`. |
| Session storage | `lib/api/auth-session.ts` — `localStorage` (survives reload). **Not** httpOnly cookies; see gap #6. |
| Server state | TanStack Query v5, one `QueryClient` in `providers.tsx` (`retry: 1`, `staleTime: 15s`, `refetchOnWindowFocus: false`). |
| Forms | react-hook-form + `@hookform/resolvers` + Zod. Schemas live in `features/<domain>/schemas.ts` or next to the form. |
| AI connections UI | `features/ai-connections/` — `AiConnectionsPanel` is a section on `/settings` (not a nav item). `connection-list.tsx` owns the rows and the enable/activate/edit/delete actions; `connection-form.tsx` owns the create/edit dialog and exports `connectionFormSchema` for tests. Keys are write-only: the API never returns them, so the edit form leaves the field blank to preserve the stored key. |
| Theme | `ThemeProvider` (own implementation, not `next-themes`): 8 presets, 11 accents, light/dark/system, driven by a `data-theme` attribute. Bootstrap script prevents flash. |
| Notifications (UI) | `sonner` via `Toaster` in `providers.tsx`; `NotificationBell` in the header; `NotificationBootstrap` calls `POST /notifications/generate` **once per browser session** after sign-in (guarded by `sessionStorage`). |
| Rendering | Pages are server-rendered shells around client data. `next build` prerenders 19 routes statically; `/courses/[id]` is dynamic (ƒ). |

Navigation (`app-shell.tsx`): 12 sidebar items — Dashboard, Courses, Academics, Tasks, Calendar, Exams, Notes, Resources, Study, Goals, Analytics, AI Assistant — plus Settings in the sidebar footer. Mobile bottom bar shows 5: Dashboard, Tasks, Courses, Study, Exams. `/notifications` has **no** nav entry; it is reached via the bell.

---

## 7. Database / Prisma

- PostgreSQL. Generator `prisma-client-js`. Schema: `backend/prisma/schema.prisma`.
- **Migration history exists**: `prisma/migrations/20261006000000_init_from_schema/` (the whole schema, squashed in Phase 0) and `prisma/migrations/20261007000000_add_owner_indexes/` (Phase 3). `prisma migrate deploy` was verified **from an empty database** (create DB → deploy → status clean → drop), on `studentos`, and on `studentos_test`. `prisma migrate status` reports "Database schema is up to date!". `prisma validate` passes. Note: `prisma migrate dev` cannot run here — its shadow database is unreachable (P1001), so new migrations are hand-written and applied with `migrate deploy`.
- 22 models, all `@@map`-ed to snake_case plural tables; 17 enums.
- Prisma client singleton lives in `src/utils/prisma.ts` **and** `src/server.ts` (the server one is cached on `globalThis` in development). Tests import it as `prisma` from `@/server`.
- All child models cascade from `User`. Optional course/task relations use `onDelete: SetNull`.

| Group | Models |
| --- | --- |
| Identity | `User`, `RefreshToken`, `UserSetting` (`@@unique([userId,key])`) |
| Academics | `AcademicYear`, `Semester` |
| Courses | `Course` |
| Tasks | `Task`, `TaskSubtask`, `TaskTag` (`@@unique([taskId,name])`) |
| Content | `Note`, `Resource`, `Event` |
| Tracking | `StudySession`, `Goal`, `GoalMilestone`, `Grade` |
| Notifications | `Notification` (indexed `[userId,status]`, `[userId,createdAt]`) |
| AI | `AiConversation` (indexed `[userId,updatedAt]`), `AiMessage` (indexed `[conversationId,createdAt]`), `AiStudyPlan` (indexed `[userId,updatedAt]`), `AiStudyPlanEntry`, `AiConnection` (`@@unique([userId,provider])`) |

**Indexes:** every owner-scoped list/filter column is indexed (Phase 3 added 16: owner+status/date on tasks, courses, goals, academic years, semesters; `userId` on refresh tokens; `position` on subtasks/milestones; `updatedAt`/`createdAt`/`startedAt`/`dueDate` sort keys). `migrations/20261007000000_add_owner_indexes` carries them.

Notable column-level facts: `Task.estimatedMinutes` + `Task.completedAt`; `Course.instructor`; `StudySession.durationMinutes` (stored, not derived at read); `Resource` has both URL fields and S3 fields (`fileKey`/`fileName`/`fileSize`/`mimeType`); `AiMessage.contextSnapshot` stores the JSON context actually sent to the model.

`TaskRecurrenceRule` and `RecurrenceFrequency` are **commented out** in the schema — recurring tasks are deferred to v1.1.

`User` has **no `role` and no `residency` column** (see gap #3).

Seed: `backend/prisma/seed.ts` (`pnpm --filter @studentos/api db:seed`). It `deleteMany`s all 21 tables in FK order, then creates `demo@studentos.dev` plus `createMany` sample data. **It is destructive.** There is no root-level `db:seed` script.

---

## 8. Authentication & security

| Concern | Implementation |
| --- | --- |
| Password hashing | `@node-rs/argon2` (`hashPassword` / `verifyPassword` in `src/routes/auth.ts`) |
| Token signing | `jose`, HS256 |
| Access token | Claims `{ sub, email, type: "access" }`, plus `iss`/`aud` = `studentos`, a `jti`, and **hardcoded `1h` expiry** |
| Refresh token | Claims `{ sub, type: "refresh" }`, `7d`. Persisted in the `RefreshToken` table, so rotation and server-side revocation are possible |
| Guard | `authenticate` / `authenticateOptional` in `src/middlewares/auth.ts`; attaches `currentUser` + `tokenPayload` |
| Transport | `Authorization: Bearer <token>` |
| Security headers | `helmet` |
| CORS | origins from `CORS_ORIGINS` (comma-separated, default `http://localhost:3000`), `credentials: true` |
| Body limit | 1 MB JSON / urlencoded |
| Password storage on web | `localStorage` — **not** httpOnly cookies |

**One JWT implementation.** `src/utils/jwt.ts` is the only place tokens are minted or verified: `signAccessToken` / `signRefreshToken` / `verifyJwt`, all driven by `config.jwtAccessExpiresInSeconds` (default 900 s) and `config.jwtRefreshExpiresInSeconds` (default 604800 s), with `iss` / `aud` (`"studentos"`) enforced on verify and a `type` claim distinguishing access from refresh. `auth/routes.ts` and `auth/middleware.ts` both import it. Refresh also checks the stored `RefreshToken.expiresAt` row, not just the JWT, so a lapsed or revoked session cannot be renewed. Access tokens carry only `{ sub, email, type, iat, exp }` — no `role`, `residency` or `name` (see gap #3).

---

## 9. AI architecture

`backend/src/services/ai/` — `agent.ts`, `system-prompt.ts`, `provider.ts`, `context.ts`, `service.ts`, `confirmations.ts`, `tools/`. The HTTP layer and the Zod schemas live outside it: `backend/src/routes/ai.ts` and `backend/src/schemas/ai.ts`.

### 9.1 The agent loop

`runAgent()` (`agent.ts`) is a bounded, provider-agnostic loop: ask the model what it needs → run the tools it asked for through the registry → feed the results back → repeat until it answers in prose. The workflow it implements is `UNDERSTAND → READ → ANALYZE → PLAN → PROPOSE → CONFIRM → ACT → VERIFY`.

Limits live in code, not in the prompt, so a non-compliant model cannot exceed them. Each is a hard ceiling; `config.aiAgentMax*` may only lower it.

| Limit | Ceiling | Env override | Effect |
| --- | --- | --- | --- |
| Provider round-trips | `MAX_TOOL_ROUNDS` = 4 | `AI_AGENT_MAX_TOOL_ROUNDS` | Cut off, then one final tool-free turn so the student still gets an answer |
| Tool calls per run | `MAX_TOOL_CALLS` = 12 | `AI_AGENT_MAX_TOOL_CALLS` | Remaining calls in the round are dropped and the model is told so |
| Proposed actions per turn | `MAX_PROPOSED_ACTIONS` = 8 | `AI_AGENT_MAX_PROPOSED_ACTIONS` | Further writes refused with `proposal_limit`; the loop stops proposing |
| Single tool result fed back | 6000 chars | — | Truncated with a `[truncated]` marker before it re-enters the prompt |
| History replayed | 12 turns | — | User's and assistant's own words only |
| User message | 4000 chars | — | Trimmed before it reaches the provider |

Two further rules are structural, not numeric: a turn that produces a proposal becomes **prose-only** for its next round (so a model cannot chain writes behind one another), and the model-supplied `userId` is stripped by the Zod parse before any handler sees it.

`finish` on the result is one of `answered`, `tool_limit`, `confirmation_pending`, `no_tool_support`.

### 9.2 Tool layer

`tools/registry.ts` is the only path between the model and StudentOS. It refuses unknown names, validates arguments against each tool's Zod schema (which strips undeclared keys), enforces the confirmation gate, and converts every thrown error into a safe, model-readable result. No tool imports Prisma — a test asserts this by scanning `tools/*.ts`.

**50 tools: 21 READ, 7 ANALYZE, 22 WRITE** (21 mutations + `confirm_pending_actions`).

| Kind | Tools |
| --- | --- |
| READ (21) | `get_courses`, `get_active_courses`, `get_tasks`, `get_upcoming_tasks`, `get_overdue_tasks`, `get_calendar_events`, `get_upcoming_exams`, `get_study_sessions`, `get_study_history`, `get_goals_and_milestones`, `get_goal_milestones`, `get_grades`, `get_notes`, `get_note`, `search_notes`, `get_task_subtasks`, `get_task_tags`, `get_resources`, `get_academic_structure`, `get_notifications`, `get_academic_dashboard` |
| ANALYZE (7) | `analyze_academic_progress`, `identify_weak_courses`, `identify_at_risk_work`, `analyze_study_consistency`, `calculate_workload`, `identify_upcoming_priorities`, `build_study_plan` |
| WRITE (22) | `create_task`, `update_task`, `complete_task`, `create_subtask`, `update_subtask`, `create_task_tag`, `create_study_session`, `update_study_session`, `create_goal`, `update_goal_progress`, `create_milestone`, `update_milestone`, `create_note`, `update_note`, `create_resource`, `update_resource`, `create_event`, `update_event`, `create_grade`, `update_grade`, `update_course`, `confirm_pending_actions` |

There is deliberately **no delete, no bulk and no free-form update tool**: every action names one record and one bounded change.

### 9.3 Natural references, resolved before approval

`tools/resolver.ts` turns what the student actually says — "the Database exam", "CS210", "my lab report" — into a real record id. It collects candidates through the same domain services, scores them (exact id → exact text → space-insensitive code → prefix → substring → token overlap), and returns one of three outcomes:

| Outcome | Behaviour |
| --- | --- |
| `resolved` | A single best match, with the `match` kind recorded |
| `ambiguous` | Refused. The model receives the candidate list and must ask the student which one it meant — it never picks |
| `not_found` | Refused. The model is told the record is not in the student's data and must not substitute a similar one |

Courses, tasks, subtasks, study sessions, goals, milestones, notes, resources, events and grades are all resolvable. A **subtask is only resolvable inside its own task** and a **milestone only inside its own goal**, so "the introduction" cannot bind to the wrong parent.

Resolution happens at **proposal** time, not execution time, via the optional `prepare(args, ctx)` hook on a tool definition (`types.ts`). The registry calls `prepare` before parking a write, and stores the *resolved* arguments. Two consequences, both deliberate: the confirmation card names the actual record rather than the loose phrase, and an ambiguous or missing reference is answered during the conversation instead of after the student clicks Confirm. Explicit ids still win; `prepare` only acts on a reference the model supplied.

### 9.4 Confirmation

A WRITE tool never runs on the turn that requests it. `executeTool` returns the validated call as `proposedActions`, the agent parks them via `confirmations.ts`, and nothing is created until the student confirms — by the UI's Confirm button (REST) or by saying "create it" (the `confirm_pending_actions` tool). Both paths funnel through `confirmationStore.consume`, so they cannot diverge.

- Proposals are keyed by **user *and* conversation**: one student's proposal id resolves to nothing for another.
- `consume` is atomic, so two concurrent confirms cannot both apply the same mutations; a second confirm is a 409 or a `no_pending_action` tool failure.
- Proposals expire after 30 minutes. A new proposal supersedes the previous pending one.
- The store is **in-process and in-memory**: the handshake is short-lived and inside one conversation, and persisting it would need a migration on a baselined database (see Known gaps).
- An approved call is compared **by value**, so a stored `create_task` cannot be widened to a different title mid-flight, and one approval cannot unlock a different tool.

### 9.5 Verification after the write

`tools/verify.ts` re-reads every changed record **through the same domain service that wrote it** and compares the fields the student approved. `ok && verified` is the only state the assistant may call a success; an action that returned `ok` but did not match on re-read is reported as unverified, with the mismatch named. Every WRITE tool has a verifier, a test asserts every argument a tool can change is re-read by it, and a tool whose whole purpose is an outcome (`complete_task`) asserts that outcome directly. Timestamps compare the **exact instant** when the approval carried a time, and the **day** when it was date-only (the tool normalises a bare date to 09:00 local).

`executeProposalActions()` (`tools/confirm-tool.ts`) produces one `ConfirmationActionOutcome` per step with `ok`, `verified`, an optional `error`, and a one-sentence `verification`. Failures are per action and never abort the batch. `summarizeOutcomes()` in `confirmations.ts` is shared by the REST and chat paths so both describe the same outcome identically: a single action reports its own verification, a batch reports `N of M action(s) applied and verified` plus what failed.

The REST confirm endpoint returns `EXECUTED` only when every step is both applied and verified; anything else is `PARTIAL`.

### 9.6 Providers

`AiProvider` = `{ name, supportsTools(), chat(), chatWithTools() }`. All six provider kinds are implemented in `provider.ts` with plain `fetch` — **no SDK** — so any OpenAI-compatible endpoint works.

| Provider | Native tool calling | Notes |
| --- | --- | --- |
| `openai` | yes | `AI_PROVIDER` default; `OPENAI_API_KEY` + `OPENAI_BASE_URL` |
| `openrouter` | yes | Shares the OpenAI adapter; `OPENROUTER_API_KEY` |
| `custom` | yes | `CUSTOM_AI_ENDPOINT` / `CUSTOM_AI_API_KEY`, any OpenAI-compatible endpoint |
| `ollama` | yes | Local, credential-free. `OLLAMA_BASE_URL`; normalises `tool_calls` that omit `id` |
| `gemini` | **no** | `GEMINI_API_KEY`; `candidates[].content.parts[].text` |
| `anthropic` | **no** | `ANTHROPIC_API_KEY` |

A provider without native tools keeps the honest grounded path: **one** call with the `studentContextBuilder` snapshot inlined, no tools advertised, `finish: "no_tool_support"` and an empty activity feed. It cannot write anything, and the prompt does not pretend otherwise.

Resolution order: the student's active personal AI connection (encrypted at rest) → the environment default → 503 `AI_PROVIDER_NOT_CONFIGURED`.

**Grounding snapshot** (`context.ts`, used only on the no-tools path) runs bounded parallel queries: courses 30, tasks 30 (`status != COMPLETED`, soonest due first), upcoming events 20, study sessions 10, active goals 20, notes 10, grades 20. `toPrompt()` serializes them as `{"studentos": {...}}` as a `system` message.

**Service behaviour.** Conversations, messages and study plans are fully DB-backed and ownership-scoped (cross-user → 404). Posting a message with `generateReply: true` (default) stores it, runs the agent, and persists the assistant reply with `reply.toolActivity` / `reply.agent` alongside `contextSnapshot`. `generateReply: false` stores the message only and returns `reply: null`.

**Failure modes (deliberate, not bugs).**

| Condition | Result |
| --- | --- |
| No provider configured | 503 `AI_PROVIDER_NOT_CONFIGURED`; **no message persisted** |
| Provider returns non-2xx or empty | 502 `AI_PROVIDER_ERROR` |
| `AI_ENABLED=true` + provider `openai` + no `OPENAI_API_KEY` | `validateConfig()` **throws at boot** |
| Ambiguous / missing reference | Tool failure (`ambiguous` / `not_found`) with candidate details; the model asks |
| Model exceeds a limit | Turn is truncated or the call is refused; the student is told in plain language |

Both AI failure codes are produced by `ApiError` subclasses in `provider.ts`, so `globalErrorHandler` maps them through the normal envelope. Do **not** reintroduce a plain `Error` class there — that silently becomes a 500.

**Credential-free providers.** `isCredentialFreeProvider()` in `ai-connections/schema.ts` marks `ollama` as needing no API key. `credentials` is *optional in the type* but required at runtime for every other provider — enforced in `superRefine` in both the Zod schema and the route validator. An ollama connection stores an encrypted empty string (`credentialsEncrypted` is non-nullable), and `parseProviderCredentials("")` returns `{}`.

| Env var | Default | Notes |
| --- | --- | --- |
| `AI_ENABLED` | `true` (`!== "false"`) | test config forces `false` so no external call is ever made |
| `AI_PROVIDER` | `openai` | all six values implemented; see 9.6 |
| `AI_MODEL` | `gpt-4o-mini` | |
| `AI_BASE_URL` | — | base URL of the environment-default provider |
| `AI_AGENT_MAX_TOOL_ROUNDS` | `4` | clamped to `MAX_TOOL_ROUNDS` |
| `AI_AGENT_MAX_TOOL_CALLS` | `12` | clamped to `MAX_TOOL_CALLS` |
| `AI_AGENT_MAX_PROPOSED_ACTIONS` | `8` | clamped to `MAX_PROPOSED_ACTIONS` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | — | required at boot when AI is enabled with `openai` |
| `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | — | |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | |
| `CUSTOM_AI_ENDPOINT` / `CUSTOM_AI_API_KEY` | — | |

The whole rest of the API stays fully functional when no provider is configured.

---

## 10. Ports & environment

| Service | Port | Binding |
| --- | --- | --- |
| API | `3001` (`PORT`, default) | `0.0.0.0` (`HOST`, default) |
| Web | `3000` | `next dev -p 3000` |
| PostgreSQL | `5432` | dev DB `studentos`, test DB `studentos_test` |

| File | Purpose | Gitignored |
| --- | --- | --- |
| `backend/.env` | API runtime config (loaded by `src/config/index.ts` via `process.loadEnvFile`, and parsed by `vitest.config.ts`) | yes |
| `backend/.env.example` | Documented keys: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` (added 2026-09-29), `PORT`, `HOST`, `NODE_ENV` | **yes — and that is a bug**: root `.gitignore` has a blanket `.env.example` rule, so this file is **not in the repository** even though the README tells you to copy it. See gap #22. |
| `frontend/.env.local` | `NEXT_PUBLIC_API_URL` — **must be the API origin `:3001`**, not the web origin; there is no Next.js rewrite proxy | yes |
| `frontend/.env.local.example` | `NEXT_PUBLIC_API_URL` only, correctly set to `:3001` | yes |

Full key set: `NODE_ENV`, `PORT`, `HOST`, `DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN_SECONDS`, `JWT_REFRESH_EXPIRES_IN_SECONDS`, `COOKIE_DOMAIN`, `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_USE_PATH_STYLE`, `CORS_ORIGINS`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_SECONDS`, `UPLOAD_MAX_FILE_SIZE_BYTES`, `UPLOAD_ALLOWED_MIME_TYPES`, plus `ENCRYPTION_KEY` and `TEST_DATABASE_URL` (uncommitted, added by AI Connections).

Boot fails fast via `validateConfig()` if `DATABASE_URL`, `JWT_SECRET` or **`ENCRYPTION_KEY`** are missing (see [§9](#9-ai-architecture) for the AI condition and the S3 pair rule). The `ENCRYPTION_KEY` requirement was added 2026-09-29 (gap #26) so a missing key is a boot failure instead of a 500 on every AI Connections write. Any string is accepted — `lib/encryption.ts` SHA-256 hashes it to 32 bytes; generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. The checked-out local `.env` contains a placeholder `OPENAI_API_KEY=sk-local-placeholder`, which satisfies boot validation but will not produce real completions.

---

## 11. Commands

### Root (Turborepo passthrough)

```bash
pnpm dev          # turbo run dev  — both apps in parallel
pnpm start        # pnpm --filter @studentos/api start
pnpm build        # turbo run build
pnpm lint         # turbo run lint  — only @studentos/web has a lint script
pnpm test         # turbo run test  — test dependsOn build
pnpm db:generate  pnpm db:push  pnpm db:migrate
```

### Per package

```bash
# API  (@studentos/api)
pnpm --filter @studentos/api dev          # tsx watch src/server.ts
pnpm --filter @studentos/api build        # tsc -p tsconfig.json  -> dist/
pnpm --filter @studentos/api start        # tsx src/server.ts
pnpm --filter @studentos/api test         # vitest run  (tests/**/*.test.ts)
pnpm --filter @studentos/api test:watch
pnpm --filter @studentos/api db:generate  # prisma generate
pnpm --filter @studentos/api db:push      # prisma db push
pnpm --filter @studentos/api db:migrate   # prisma migrate dev
pnpm --filter @studentos/api db:seed      # tsx prisma/seed.ts   (destructive)

# Web  (@studentos/web)
pnpm --filter @studentos/web dev          # next dev -p 3000
pnpm --filter @studentos/web build        # next build
pnpm --filter @studentos/web start        # next start -p 3000
pnpm --filter @studentos/web lint         # next lint --dir app --dir components --dir features --dir lib --dir types --dir tests
pnpm --filter @studentos/web test         # vitest run  (tests/**/*.test.ts)
```

Type-check only: `npx tsc --noEmit` in `frontend`. There is no `typecheck` script.

### Local setup

```bash
pnpm install
cp backend/.env.example backend/.env          # NOTE: this example file is gitignored — see gap #22
cp frontend/.env.local.example frontend/.env.local
pnpm --filter @studentos/api db:push             # create the schema
pnpm --filter @studentos/api db:seed             # optional demo data
pnpm dev
```

---

## 12. Test & build status (verified 2026-10-07)

> Re-verified **2026-10-08** after the AI Assistant chat fixes **and the frontend product upgrade** ([§17](#17-latest-ai-work--change-log)): API 435 / web 236 green, `tsc` both apps clean, `next lint` clean, `next build` clean, 12 dashboard routes all HTTP 200 on the running app.

| Suite | Command | Result | Time |
| --- | --- | --- | --- |
| API | `pnpm --filter @studentos/api test` | **29 files, 435 tests — 0 fail** | ~70 s |
| Web | `pnpm --filter @studentos/web test` | **20 files, 236 tests — 0 fail** | ~13 s |
| API typecheck | `pnpm --filter @studentos/api exec tsc -p tsconfig.json --noEmit` | **pass** (exit 0) | ~8 s |
| API build | `pnpm --filter @studentos/api build` | **pass** — `tsc` gate (`dist/` is not the runtime; `start` runs `tsx src/server.ts`) | ~8 s |
| Web typecheck | `pnpm --filter @studentos/web exec tsc --noEmit` | **pass** (exit 0) | ~20 s |
| Web build | `pnpm --filter @studentos/web build` | **pass** — 19 routes (18 static ○, `/courses/[id]` dynamic ƒ) | ~55 s |
| Lint | `pnpm lint` (root, → web) | **pass** — "No ESLint warnings or errors" | ~5 s |
| DB | `npx prisma validate` / `npx prisma migrate status` | **valid** / **up to date** (2 migrations) | — |
| Lockfile | `pnpm install --frozen-lockfile` | **pass** (CI-compatible) | ~2 s |

### Real-browser verification (2026-10-01)

Driven over the Chrome DevTools Protocol against a real `pnpm dev` stack (web `:3000`, API `:3001`), not jsdom. Registered and signed in through the real login form, then exercised `/ai` end to end.

| Check | Result |
| --- | --- |
| Sign in through the UI | `/login` → `/dashboard`, tokens stored |
| First prompt on a **brand-new account** (zero conversations) | Created a conversation, then sent the queued prompt |
| Optimistic message ordering | user text at **t+133 ms**, `StudentOS AI is generating` immediately after, assistant reply at **t+5.8 s** |
| Title generated from the first message | "Prepare for my next exam." → **"Next exam preparation"** |
| Conversation list preview | Shows the real latest message text |
| Active conversation survives a reload | `studentos.ai.activeConversation` set and restored |
| New chat / rename | Both work; rename persisted across a reload |
| Provider failure (API pointed at a bad model) | User message stays on screen, **Stop** button during flight, error banner **and** Retry both appear at t+4.5 s |
| Mobile (390×844) | Sidebar hidden, History button + drawer open with rows, no horizontal overflow |
| Console | No console errors, no uncaught exceptions |

Two environment notes from that session, both worth keeping:

- **Never run `next build` while `next dev` is running.** `build` overwrites `.next`, and the running dev server then serves HTML whose client chunks 404 — the page renders but React never hydrates, so every interaction silently fails and only a `404 | This page could not be found.` or a dead form reveals it. Stop the dev server, or delete `frontend/.next` and restart it.
- **The configured free OpenRouter model is rate-limited upstream (HTTP 429).** A real reply therefore depends on the provider's shared pool at that moment. The UI handles it correctly (message kept, error + Retry shown); do not read a 429 as an application bug.

Per-package commands give a faster, more specific signal than the root `pnpm test`. `tsc` is **not** on the global PATH in this environment; always use `pnpm --filter <pkg> exec tsc …` or `npx tsc` from the package directory.

**API tests need a live PostgreSQL.** They are integration tests against a real database, not mocks. `vitest.config.ts` resolves `DATABASE_URL = TEST_DATABASE_URL ?? postgresql://postgres@localhost:5432/studentos_test`, forces `NODE_ENV=test` and `AI_ENABLED=false`.

**Destructive and non-parallel-safe.** `tests/setup.ts` calls `cleanupDb()` in `beforeAll` for every file, and `cleanupDb()` issues `TRUNCATE TABLE ... CASCADE` over all tables. `fileParallelism: false` keeps files sequential within one run. **Two concurrent API test runs will deadlock** (PostgreSQL `40P01`, observed live) because both hold `ACCESS EXCLUSIVE` locks. Never run the API suite in parallel with another one, and point `TEST_DATABASE_URL` at a throwaway database.

Prisma `createMany` stamps all rows with a single `now()`, so tests that assert `createdAt` ordering must insert explicit timestamps.

### Test inventory

Both suites are **flat**, next to the app they test, never colocated with source.

**API** (`backend/tests/`, 29 files + `helpers.ts` + `setup.ts`): `academics`, `ai`, `ai-connections`, `ai-provider-resolution`, `ai-tools`, `auth`, `contract-safety`, `course-summary`, `courses`, `cross-user`, `dashboard`, `dashboard-command-center`, `encryption-provider-ai-connections`, `error-envelope`, `events`, `goals`, `grades`, `health`, `integration`, `malformed-body`, `notes`, `notifications`, `production-config`, `resources`, `settings`, `study-sessions`, `subtasks`, `task-tags`, `tasks`.

`ai-tools.test.ts` is the AI agent suite: registry registration and JSON-Schema conversion, argument handling and error safety, real-data scoping, the WRITE confirmation gate, the confirmation store, the agent loop (tool round-trip, round limit, **call and proposal budgets**, proposal-then-prose, provider fallback), provider tool-call support, the HTTP surface, natural references, post-write verification (including a check that **every field a write tool can change is re-read**), verified batch outcomes, and the **chat persistence surface** — question kept across a provider failure, retry reusing the stored row, the newest-history window, `updatedAt` recency, per-conversation transcript isolation, and the academic context snapshot (own data only, stored on the question).

**Web** (`frontend/tests/`, 18 files + `setup.ts`): `academic-forms`, `ai-chat-flow` (tsx), `ai-chat-utils`, `ai-connections`, `ai-pending-action` (ts), `ai-transcript-scroll`, `ai-workspace`, `app-shell`, `calendar-page`, `errors`, `exam-utils`, `format`, `labels`, `notification-utils`, `task-form`, `theme-system`, `themes`, `utils`.

Test style: API uses supertest against the real `app` with helpers from `tests/helpers.ts` (`registerAndLogin`, `authRequestJson`, `authRequest`, `logout`). `authRequestJson`/`authRequest` are **overloaded** and accept two different call shapes; read the overloads before using them. Web tests are jsdom + Testing Library, setup in `frontend/tests/setup.ts`, matched by the `tests/**/*.test.{ts,tsx}` glob in `frontend/vitest.config.ts`.

### Not covered by the automated suites

- **Real provider end-to-end, partly done 2026-09-30.** OpenRouter is now proven against a live key: 50 tool schemas accepted, `tool_calls` normalised, read tools answered from the real DB, and the write then confirm then verify path passed 18/18 against a real database. Gemini, Anthropic, Ollama and the custom endpoint are still fixture-only, so `candidates[].content.parts[].text` and the Ollama `tool_calls` shape have never been seen on the wire. See gaps #29 and #33.
- **Browser interaction with the confirmation card.** The card's Confirm/Cancel flow is exercised over HTTP and by types, not by a rendered click. The surrounding chat page *was* driven in a real browser on 2026-10-01 — see [§12](#12-test--build-status-verified-2026-10-07) — but the confirm click itself still was not.
- **Retry used to duplicate a message — RESOLVED 2026-10-01.** `onRetryMessage` and the error banner's Retry both re-posted the failed text as a *new* message while the failed bubble stayed on screen, so a retry after a provider failure left the student's question visible twice. `useSendMessage` now takes `retryOf: string` and reuses the failed message's own cache slot — flipped back to `optimistic`, then replaced in place by the stored message — instead of appending. If the id is no longer in the transcript (a refetch dropped it) the retry falls back to appending, so nothing is lost either way. A retry is also excluded from first-message title derivation. Three tests pin this in `frontend/tests/ai-chat-flow.test.tsx`.
- **A caution for any live or manual script:** `backend/.env` sets `DATABASE_URL` to the **dev** database `studentos`, while the test suites run against `studentos_test` (set in `backend/vitest.config.ts`). A throwaway script that reads `DATABASE_URL` therefore writes to the database you actually use. Prefer a dedicated `studentos_e2e` database, and if you do write to `studentos`, create the throwaway user **inside** a `try` so the cleanup `finally` actually runs. A script that creates rows before its `try` leaks them silently, which is what happened during the 2026-09-30 live run: three leftover users, since removed, with no orphaned rows in any user-owned table.

---

## 13. Known gaps & issues

Ordered by how likely they are to bite you.

| # | Issue | Evidence |
| --- | --- | --- |
| 1 | **RESOLVED.** The working tree was uncommitted for most of this project's history; `af7aab6` committed the AI Agent Core, verifier, resolver and chat UI, and `git status` is now clean. The underlying risk was never the commit itself but the gitignored-file gaps below (#22, #26, #28), which a fresh clone still reproduces. | `git status` |
| 1a | **Never run `next build` while `next dev` is running** (hit live on 2026-10-01). `build` overwrites `frontend/.next` under the running dev server, which then serves HTML whose client chunks 404: the page paints, but React never hydrates, so every click, keystroke and route change silently does nothing. Symptom is either `404 \| This page could not be found.` or a fully rendered form that submits nothing. Stop the dev server first, or delete `frontend/.next` and restart. | `frontend/.next` |
| 1b | **The configured free OpenRouter model is rate-limited upstream (HTTP 429).** A live reply depends on the provider's shared pool at that moment. The UI degrades correctly — the user's message stays, an error banner and Retry appear — so a 429 is not an application bug. | live 2026-10-01 |
| 2 | **RESOLVED 2026-10-07 (Phase 2).** `docs/api/openapi.yaml` is real YAML now, covering the whole surface: **60 paths / 111 operations / 92 schemas / 759 `$ref`s, 0 broken**, verified against the 100 real route registrations. It carries `bearerAuth`, shared 400/401/404/409/429/500/502/503 responses (with `Retry-After` on 429), request schemas with the Zod constraints, `operationId`s, and the documented deviations: 404-not-403 ownership masking, the bare-array lists (`/courses`, the academic-years and semesters lists), `UPLOAD_STORAGE_UNAVAILABLE`, and provider failures as 200 with `success:false`. | `docs/api/openapi.yaml` |
| 3 | **RESOLVED 2026-10-07 (Phase 1).** `CurrentUser` and `TokenPayload` no longer declare `role`, `residency` or `name`. The access token carries only `{ sub, email, type, iat, exp }`, and nothing read the phantom fields. Profile data still comes from `GET /auth/me`. | `auth/middleware.ts` |
| 4 | **RESOLVED 2026-10-07 (Phase 1).** `routes/auth.ts` no longer mints tokens itself — `signAccessToken` / `signRefreshToken` / `verifyJwt` live only in `src/utils/jwt.ts`, so the login path honours `config.jwtAccessExpiresInSeconds` (900 s default) instead of a hardcoded `1h`, and verify enforces `iss` / `aud`. Refresh additionally rejects a stored `RefreshToken.expiresAt` that has lapsed. | `src/utils/jwt.ts`, `routes/auth.ts` |
| 5 | **RESOLVED 2026-10-07 (Phase 1).** `src/utils/rate-limit.ts` provides a dependency-free fixed-window limiter mounted on `/api/v1` in `app.ts`; budget from `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS`, disabled under `NODE_ENV=test`, rejections answer 429 `RATE_LIMITED` with `Retry-After`. Pinned by `tests/error-envelope.test.ts`. | `src/utils/rate-limit.ts`, `app.ts` |
| 6 | **Web stores tokens in `localStorage`**, not httpOnly cookies — any XSS yields a full session. Deliberate (survives reload) but worth knowing. | `frontend/lib/api/auth-session.ts` |
| 7 | **S3 / `UPLOAD` resources not implemented.** The enum, the DB columns and the `S3_*` config exist, but `storageType: "UPLOAD"` on create/update returns 400 `UPLOAD_STORAGE_UNAVAILABLE`. URL resources only. | `prisma/schema.prisma`, `config/index.ts:51-57` |
| 8 | **Notification delivery is `IN_APP` only.** `PUSH`/`EMAIL`/`SMS`/`TELEGRAM` enum values exist but are unimplemented, and there is **no scheduler/job** — generation is client-triggered via `POST /notifications/generate`, fired once per browser session. | `prisma/schema.prisma`, `app-shell.tsx:266-282` |
| 9 | **Recurring tasks deferred to v1.1.** `TaskRecurrenceRule` / `RecurrenceFrequency` are commented out in the schema. | `prisma/schema.prisma:263-287` |
| 10 | **Dead pagination types.** `PaginationInput`/`PaginationOutput` (page/limit/total) in shared are unused; the real convention is cursor-based. | `packages/shared/src/schemas/api.ts:39-48` |
| 11 | **RESOLVED.** `.github/workflows/ci.yml` runs four jobs on push/PR: `api` (postgres:16 service, `pnpm install --frozen-lockfile`, `prisma generate`, **`prisma migrate deploy` into an empty `studentos_test`**, `vitest`, `tsc`, `build`), `web` (vitest, `tsc`, `next lint`, `next build`) and `lint` (root `pnpm lint`). The whole API path was replayed locally against a freshly created database: deploy → 422/29 green. | `.github/workflows/ci.yml` |
| 12 | **PARTIALLY RESOLVED 2026-09-27.** The npm `workspaces` array and the two stray lockfiles (`package-lock.json`, `backend/pnpm-lock.yaml` — the latter a 6-line empty stub) were removed. `pnpm-lock.yaml` is now the only lockfile and the root `start` script uses pnpm. | repo root |
| 13 | **Three archived docs are stale and contradict reality.** `docs/audits/qa-final-report.md` claims ~95% done and lists 166 API tests; `docs/audits/frontend-progress.md` claims 40 web tests, 10 pages, and — wrongly — that the project "is not a git repo"; `docs/audits/phase-2-ai-connections-audit.md` says no test file exists. All three are frozen snapshots, each carrying an "Archived historical snapshot" banner. This file is authoritative. | `docs/audits/` |
| 14 | **RESOLVED 2026-10-07 (Phase 1).** There is no `INTERNAL_ERROR_DEV` any more. 500s return a fixed `INTERNAL_ERROR` message in every environment; the stack goes to the log with a `req_*` request id. Prisma errors likewise return a fixed safe message (they used to echo the raw Prisma text, which quotes the failing source line and constraint fields). | `config/http.ts` |
| 15 | **RESOLVED 2026-10-07 (Phase 3).** The old baseline pair (`20260926004652_baseline`, `20260926010000_add_ai_connections`) was squashed in Phase 0 into `20261006000000_init_from_schema`, and Phase 3 added `20261007000000_add_owner_indexes`. Two real defects were fixed: (a) `init_from_schema/migration.sql` was **UTF-16LE**, so `migrate deploy` died on any fresh database with "string contains embedded null" — it is UTF-8 now and the recorded checksum was rebaselined with `migrate resolve --applied`; (b) `_prisma_migrations` on `studentos`/`studentos_test` still listed the deleted baseline names — cleaned up. **`prisma migrate deploy` now succeeds from a completely empty database** (created one, deployed both migrations, `migrate status` clean, dropped it) and is clean against both existing databases. Caveat that remains: `prisma migrate dev` cannot run on this machine — its shadow database is unreachable (P1001) — so migrations are hand-written and applied with `migrate deploy`. | `backend/prisma/migrations/` |
| 16 | **API has no linter.** `tsc` under `strictNullChecks` is the only static gate; there is no ESLint config for `backend`. | `backend/package.json` |
| 17 | **RESOLVED 2026-09-27.** The dead `./types/*`, `./utils/*`, `./constants/*` export entries were removed from `packages/shared/package.json`; only `./schemas/*` remains, matching the single real source folder. | `packages/shared/package.json` |
| 18 | **`zod-express@0.0.8` is a declared but unused dependency** — `zod-validator-shim.ts` is hand-written over `zod.safeParse` and imports nothing from it. Removing the package would mean a lockfile update; until then, do not assume the shim delegates to it. | `backend/src/utils/zod-validator-shim.ts`, `backend/package.json` |
| 19 | **`authService.updateProfile` and `authService.changePassword` are implemented but unrouted.** `updateProfileSchema` and `changePasswordSchema` are defined and unused. There is no way to change a profile or password over HTTP. | `routes/auth.ts:141,163,202,212` vs the 5 registered routes at `routes/auth.ts:231-269` |
| 20 | **RESOLVED 2026-09-28 — Phase 2 is closed.** All 3 failures fixed. (a) **Ollama needs no key** — `credentials` is now optional in the type but required at runtime for every other provider, via `isCredentialFreeProvider()` in `ai-connections/schema.ts` plus a matching `superRefine` in the route validator; an ollama connection stores an encrypted empty string. (b) **`@@unique([userId, provider])` kept** — one connection per provider is the product rule, so the test now exercises "activating one deactivates the others" with two *different* providers (openai + anthropic) instead of two openai ones. (c) **`AiProviderNotConfiguredError` now extends `ApiError`** (503 `AI_PROVIDER_NOT_CONFIGURED`) instead of plain `Error`, so `globalErrorHandler` maps it instead of leaking a 500. A matching `AiProviderError` (502) was added alongside it. | `backend/src/services/ai/provider.ts`, `backend/src/{schemas,routes,services}/ai-connections.ts`, `backend/tests/ai-connections.test.ts` |
| 21 | **3 of 12 `packages/shared` schemas are imported by nobody**: `academics.ts`, `auth.ts`, `course.ts`. The web app re-declares the same shapes locally in `features/courses/courses-api.ts`. Either wire them up or delete them — do not leave two sources of truth. | `packages/shared/src/schemas/` |
| 22 | **RESOLVED — `.env.example` is tracked.** Root `.gitignore` lines 10-11 comment out the `.env.example` rule (with a note explaining why), so `cp backend/.env.example backend/.env` works from a fresh clone. Names in both example files were re-aligned with `config/index.ts` in Phase 1 (`CORS_ORIGINS`, `JWT_ACCESS_EXPIRES_IN_SECONDS`, `JWT_REFRESH_EXPIRES_IN_SECONDS`; `CORS_ORIGIN` / `JWT_EXPIRES_IN` / `JWT_REFRESH_SECRET` dropped). | `.gitignore:10`, `backend/.env.example` |
| 23 | **`components/ui/checkbox.tsx`, `skeleton.tsx` and `tabs.tsx` are unused.** Left in place deliberately — they are part of a uniform 17-file Radix primitive set, and pruning them would break the pattern. | `frontend/components/ui/` |
| 24 | **The local `.env` pointed at a PostgreSQL role that did not exist** (`elyassql`; only `postgres` exists on this machine), so all 23 API suites failed in `beforeAll` with `PrismaClientInitializationError` and **0 tests actually ran** — 261 reported as "skipped". Fixed 2026-09-28 by switching both URLs to the `postgres` role. Worth knowing because a green-looking run of *nothing* is the failure mode: if the whole suite reports skipped, suspect the database credentials before anything else. | `backend/.env` |
| 25 | **RESOLVED 2026-09-29.** The dev database `studentos` had no `ai_connections` table (`P2021`); `migrate deploy` could not fix it because both migrations are recorded in `_prisma_migrations` with `applied_steps_count = 0` (gap #15), so it is a silent no-op. A `migrate diff` preview confirmed the change was purely additive (one `CREATE TABLE`, one unique index, one FK — no `DROP`/`ALTER`), then `prisma db push` was run against `studentos`. The table now exists with all 10 columns and `prisma.aiConnection.count()` succeeds. **The real fix for a new database is still `db push` + `prisma migrate resolve --applied`** — see gap #15; the migration files themselves are corrected but still never actually execute. | `backend/prisma/migrations/` |
| 26 | **`ENCRYPTION_KEY` was absent from `backend/.env`**, so every AI Connections write returned 500 `INTERNAL_ERROR_DEV` ("ENCRYPTION_KEY environment variable is not set"). The API suite stayed green because `vitest.config.ts` sets it. A key was added locally and `validateConfig()` now checks it, so a missing key fails at **boot** with the standard "Missing required environment variables" message instead of 500ing per request. **The key itself is only in the gitignored `.env`** — a fresh clone still has no key and will not boot until one is generated. `backend/.env.example` is also gitignored (gap #22), so the documented key never reaches the repo either. | `backend/src/config/index.ts`, `backend/.env` |
| 27 | **Every AI Connections endpoint omitted `success: true` from its success envelope.** The API returned `200 {"data":{...}}`, but `frontend/lib/api/client.ts` only unwraps a 2xx body when `success === true` — so the Settings UI rendered "Request failed (200)" with a retry button on perfectly successful responses. All 8 responses now use the standard `{ success: true, data }` envelope, and the 404 on `GET /ai-connections/active` now throws `NotFoundError` instead of an ad-hoc `{ error }` body. **The 261 API tests missed this entirely** because they only asserted `res.body.data`, never `res.body.success`; 8 regression tests now pin the envelope. Every other module already conformed — AI Connections was the sole outlier. | `backend/src/routes/ai-connections.ts`, `frontend/lib/api/client.ts:110-113` |
| 28 | **`frontend/.env.local` pointed `NEXT_PUBLIC_API_URL` at `localhost:3000`** — the web server itself — so every API call 404'd and login was impossible. There is no Next.js rewrite proxy in `frontend/next.config.mjs`, so the web app must target the API origin on `:3001`; `.env.local.example` already said `:3001`. The file is gitignored, so a fresh clone reproduces this. **Hardened 2026-10-05:** the symptom resurfaced as `Connection error: Unexpected token ... "<!DOCTYPE" ... is not valid JSON` on the AI Connections test button — the request was hitting the web origin, which answers a Next.js **404 with `Content-Type: text/html`** whose body starts `<!DOCTYPE html>`. `client.ts` now checks `Content-Type` before parsing: an HTML body on an API call throws `ApiClientError` with code **`API_BASE_URL_MISCONFIGURED`** naming `NEXT_PUBLIC_API_URL`, instead of attempting to `JSON.parse` the page. A missing/JSON `Content-Type` is left alone so 204s and test doubles still work. `connection-form.tsx#onTest` also gained a `try/catch` (it previously let a rejected promise escape to the console). 4 regression tests pin the HTML case, the preserved JSON error case, the success case and the 204 case. | `frontend/lib/api/client.ts`, `frontend/features/ai-connections/connection-form.tsx` |
| 29 | **PARTIALLY CLOSED 2026-09-30 — OpenRouter proven live; the other five providers are still fixture-only.** A live run against a real OpenRouter key (base `https://openrouter.ai/api/v1`, `/chat/completions`) proved the adapter's wire format end to end: all **50** tool schemas serialise and are accepted, the model emits `tool_calls`, the adapter normalises them, and `get_tasks` / `get_courses` execute against the real DB and come back in the model's answer (it correctly reported the outstanding task, its missing course link, and that the only course was PSYC300). The write half was then driven through the real code path: `create_task` with a natural reference (`course: "PSYC300"`) returned `confirmation_required` with **zero** rows written, `prepare()` resolved the code to the real `courseId`, confirmation executed it, the re-read verified `title`, `status`, `priority` and `dueDate`, and another student could neither read nor write the record. 18/18 checks passed. **Still unproven:** Gemini, Anthropic, Ollama and the custom endpoint have never seen a live response, so `candidates[].content.parts[].text` and the Ollama `tool_calls` shape remain assertions against fixtures written from the docs. The local OpenRouter key is also out of credit, so only `:free` models are reachable from this machine. | `backend/tests/ai-provider-resolution.test.ts`, `backend/src/services/ai/provider.ts` |
| 33 | **The configured model will not drive a write, which strands the student in a dead end.** With `AI_MODEL=inclusionai/ling-3.0-flash-sante:free`, a request to add a task produced **0 proposals in 3 of 3 attempts**. This is not a harness fault: a wire-level probe showed all 50 tools (including `create_task`) are advertised, `supportsNativeTools` is true, and the model *does* emit tool calls — it just calls read tools, then narrates ("Shall I go ahead and create it?") instead of calling the write tool. The student then has no confirmation card to approve and the conversation waits forever. The prompt already forbids claiming success without a tool result, so nothing is written or falsely reported, but the feature is unusable on this model. Needs either a model with reliable tool calling for writes, or a fallback that surfaces "I could not prepare that change" when a turn expresses write intent but produced no proposal. | `backend/src/services/ai/system-prompt.ts`, `backend/src/services/ai/agent.ts` |
| 30 | **Confirmations are in-process and in-memory** (`confirmations.ts`). A pending proposal does not survive an API restart, and with more than one API instance a student could be shown a proposal on one instance and be unable to confirm it on another. Fixing this needs a table, and the migration history is baselined (gap #15). | `backend/src/services/ai/confirmations.ts` |
| 31 | **`get_notifications` exposes only the assistant-relevant types** (`ASSIGNMENT`, `EXAM`, `DEADLINE`, `REMINDER`). The `GENERAL` type the notifications module can also produce is not readable by the agent. | `backend/src/services/ai/tools/read-tools.ts` |
| 32 | **No bulk or delete tools exist**, by design. The agent can only create and update one record at a time, so "delete these three tasks" or "reschedule my whole week" is out of reach until a bounded bulk tool is designed. | `backend/src/services/ai/tools/action-tools.ts` |

---

## 14. Development conventions

### API

- One file per domain per layer: `src/routes/<domain>.ts` + `src/services/<domain>.ts` + `src/schemas/<domain>.ts`. Add a domain by creating the three files and mounting `src/routes/<domain>.ts` in `src/routes/index.ts`. Do not add a barrel `index.ts` — none of the layers have one.
- `routes/<domain>.ts` owns HTTP concerns only: `zValidator` wiring, `authenticate`, status codes, envelope. No Prisma.
- `services/<domain>.ts` owns data access. **Every query filters by `userId`.** This is what makes cross-user access 404 instead of 403 — do not add unscoped `findUnique`/`findFirst` on user-owned models.
- Response mapping happens in the service via a `map<Entity>` function; keep Prisma shapes (`Date` objects, nulls) out of the wire format.
- Throw typed errors from `src/config/errors.ts` (`notFoundError`, `conflictError`, `validationError`, …) rather than raw `Error`.
- Import the auth guard from `@/routes/auth` (all 17 route files do); it re-exports the implementation from `middlewares/auth.ts`.
- Tests live in `backend/tests/<domain>.test.ts`, flat, never next to source. Shared helpers are `tests/helpers.ts` and `tests/setup.ts`.
- Comments use `// ─────` section banners. The codebase is heavily commented; match that.

### Web

- **Never call `fetch` directly.** Use `api.get/post/patch/delete` from `lib/api/client.ts`.
- One feature folder per domain: `features/<domain>/{*-api.ts (transport), hooks.ts (TanStack Query), *-form.tsx (react-hook-form)}`.
- Shared DTO types live in `types/api-types.ts` and are imported as `@/types/api-types` from every layer. Domain-only types stay next to their feature.
- **Tests live in `frontend/tests/*.test.ts`, flat — not colocated with source.** The `tests/**/*.test.{ts,tsx}` glob in `frontend/vitest.config.ts` is the only place they are discovered, and the lint script is `next lint --dir app --dir components --dir features --dir lib --dir types --dir tests` so they stay covered.
- UI primitives go in `components/ui/` (Radix + CVA); domain composites in `components/domain/`. Pages compose these; they do not define new primitives inline.
- Use `cn()` from `@/lib/utils` for conditional classes; use theme CSS variables, not raw hex, in components.
- Add a nav entry in `app-shell.tsx` `NAV_ITEMS` if the page is primary; `MOBILE_NAV_HREFS` is a separate 5-item allowlist, so reordering `NAV_ITEMS` alone will not change the mobile bar.

### Shared

- Zod schemas and cross-app types live in `packages/shared/src/schemas/`, imported as `@studentos/shared/schemas/<name>`. That is the only exported subpath.
- Move code here **only** if both the API and the web app genuinely consume it. Do not park backend-only or frontend-only code in the shared package.
- Keep `zod` declared in `packages/shared/package.json` — removing it previously broke the API build.

### TypeScript

- API: `strictNullChecks` only (`backend/tsconfig.json`), `@/*` → `src/*`, ESM, `moduleResolution: "Bundler"`, `include: ["src/**/*.ts"]` — so `tests/` is **not** covered by the build's typecheck.
- Web: full `strict`, `@/*` → the frontend root (`./*`), bundler resolution, `noEmit`, `include: ["**/*.ts", "**/*.tsx"]` — so `tests/` **is** typechecked by `next build`.
- Both apps use the `@/` alias; the API mirrors it in `vitest.config.ts`, the web app in `frontend/vitest.config.ts`.

---

## 15. Git & workflow expectations

- Branch: `main`. History is only two commits, so there is no branching convention to infer — **establish one rather than assume it.** Feature branches for anything non-trivial.
- Commit style in history: Conventional Commits (`chore:`, and an `Initial commit:` for the root). Keep using `type: summary`.
- The `test` turbo task declares explicit `inputs` (`backend/{src,tests,prisma}/**`, `frontend/{app,components,features,lib,types,tests}/**`, `package.json`, `pnpm-lock.yaml`). Web changes now invalidate the cache too, but still do not trust a cached turbo result as verification — run the per-package commands when you need certainty.
- Keep the tree green before handing off: `pnpm --filter @studentos/api test`, `pnpm --filter @studentos/web test`, `pnpm --filter @studentos/web build`, `pnpm lint`.
- Update this file in the same change as any behaviour it describes. A stale `AI_CONTEXT.md` is worse than none — it is the first thing every agent reads.

---

## 16. Next planned work

There is **no roadmap file in the repository**, so this is inferred from the state of the tree, not from a plan document:

**All three phases are complete as of 2026-10-07.**

**Phase 1 (Database Foundation) is complete as of 2026-09-26** — Prisma migration history established, both dev and test databases verified, development seed run, test isolation confirmed.

**Phase 2 is complete as of 2026-10-07** — AI Connections end to end, the repository structure standardized, `docs/api/openapi.yaml` regenerated from the code, a cross-module contract-safety suite added, and production hardening (`x-powered-by`, `TRUST_PROXY`, `X-Request-Id`, error/timeout handlers) landed.

**Phase 3 (capstone) is complete as of 2026-10-07** — production config guardrails, the owner-index migration verified from an empty database, an IDOR sweep across every module, a live HTTP smoke run, and this file plus the README brought back in sync with reality.

Remaining work is optional polish, not phase work:

1. **Verify the AI agent against the remaining real providers** (gap #29) — OpenRouter is proven live (2026-09-30): 50 schemas accepted, `tool_calls` normalised, read tools answered from the real DB, write → confirm → verify passed 18/18. Gemini, Anthropic, Ollama and the custom endpoint are still fixture-only; the local OpenRouter key is out of credit, so only `:free` models are reachable and the free model will not call a write tool at all (gap #33).
2. **Persist confirmations** (gap #30) — a pending proposal does not survive an API restart. Needs a table (`migrate deploy` is the way to add one here; `migrate dev` has no shadow database, see gap #15).
3. **Resolve the auth inconsistencies** — collapse the duplicate JWT helpers onto the config-driven one, and either add `role`/`residency` to `User` or drop them from `CurrentUser`.
4. **Implement or remove the parked features** — S3 uploads, notification delivery/notification scheduler, recurring tasks.
5. **Fix the `.env.example` gitignore rule** so a fresh clone can copy it (gap #22), and decide the fate of the 3 unreferenced shared schemas (gap #21) and of `resolveUserConnection` (masked credential — `getActiveUserConnection` is the real one).
6. ~~**`AiProviderError` (502)** is declared but never thrown~~ — **resolved**: `provider.ts` throws it for a non-2xx upstream response and for an empty completion, and the chat persistence tests assert the 502 `AI_PROVIDER_ERROR` path (question kept, no reply stored).

---

## 17. Latest AI work / change log

### 2026-10-08 — Frontend product upgrade: command palette, deep links, real search, error states

Execution of the "StudentOS Frontend Product Upgrade" brief (P0 broken features → P1 product features → gates), built only from existing hooks/endpoints/components — no new framework, directory or design-system element.

**Command palette (P1).**
- **New `components/layout/command-palette.tsx`.** `CommandPaletteProvider` owns the ⌘K/Ctrl+K listener and renders a `CommandPaletteDialog` **only while open** (keeps every other screen's test free of a QueryClient). The combobox/listbox follows WAI-ARIA: arrow/Home/End/Enter keys, highlighted option, `scrollIntoView`, footer shortcut hints, "Searching…" / retry / empty rows.
- **Real server search**, debounced 250 ms, `limit: 5`, only on ≥2 characters: four `useQuery` calls (`["palette", domain, term]`) hitting the existing `search` params of `listTasks` / `listCourses` / `listNotes` / `listResources`. Goals and exams have no search endpoint, so they are deliberately excluded rather than faked client-side.
- **Result routing** to the pages that can actually open the record: `/tasks?task=`, `/courses/{id}`, `/notes?note=`, `/resources?resource=`.
- **Quick actions** (always visible, also filtering on the term): *Ask AI about "term"* → `/ai?prompt=…`, Add task / note / goal / course, Add calendar event → `/calendar?new=1`, Start study session — plus a *Go to* group built from the shell's own `NAV_ITEMS` (passed as a prop so the palette never imports the shell and creates a cycle).
- **Triggers wired into the shell** (`components/layout/app-shell.tsx`): a top-bar `Search` button with a `<kbd>⌘K</kbd>` label (the platform prefix is read from `userAgent` in a post-mount effect to avoid a hydration mismatch) and a ghost icon button in the mobile header.

**Deep links (P0/P1) — every palette entry lands somewhere that acts.**
- `/calendar?eventId=<id>` now really opens that event: an inline `useQuery(["events","jump",id], getEvent)` (enabled only while the param exists) anchors the month, selects the day, focuses the event and opens the day dialog, then strips the param with `router.replace`. `/calendar?new=1` opens the add-event dialog (new).
- `/tasks?task=<id>` opens that task's editor and strips the param, preserving any other params (`stripParam`); a dead id strips silently instead of spinning forever.
- `/resources?resource=<id>` deep-links to a record via a new `useResource(id)` hook in `features/resources/hooks.ts`.
- `/ai?prompt=<text>` prefills the composer and strips the param. It deliberately reads `window.location.search` in a mount effect rather than `useSearchParams` — the `next/navigation` mock in the test suite exports no `useSearchParams`, and pulling it in would force a Suspense boundary; two test suites caught this and the fix is what keeps `/ai` green.

**P0 broken features (audit findings).**
- **Dashboard 404:** note links went to `/notes/<id>`, a route that does not exist — now `/notes?note=<id>` (the page's own selector).
- **Academics:** a years/semesters failure rendered a blank area — now an `ErrorState` with both refetches.
- **Course detail:** tasks and notes failures showed stale empty lists — now `ErrorState` branches; the header gained an **Ask AI** button that opens `/ai?prompt=` with a course-specific question (existing endpoint, no new logic).
- **Study:** the three stat cards silently showed `0` when today's sessions failed — they now show *Unavailable* with a hint (`statsDown`).
- **Notes editor:** a failed note load gave no feedback — now an `ErrorAlert` with *Reload note*.

**Dashboard improvement.** A semester-progress panel (existing `Progress` component) between the stats grid and Quick actions: term name, `% through · N days left`, date range — computed only when the stored dates parse to a valid range, omitted otherwise (never invented data).

**Backend change (documented, as the brief requires).** The four searchable services (`tasks.ts`, `courses.ts`, `notes.ts`, `resources.ts`) added `mode: "insensitive"` to every `contains` filter. Live-reproduced defect first: `search=eigenval` → 0 hits while `Eigenval` → 1, i.e. search was case-sensitive and silently missed results; after the fix `eigenval` → 1, `ALGEBRA` → 1, `xyz` → 0. `backend/tests/notes.test.ts` gained a lowercase-search assertion. No other backend behaviour changed.

**New tests (web 230 → 236).** `tests/command-palette.test.tsx` (4): Ctrl+K opens / Escape closes, quick actions are visible, the term is debounced into a single `listTasks({search:"eigen",limit:5})` and Enter routes to `/tasks?task=task-1`, the Ask-AI entry routes to `/ai?prompt=indexing`. `tests/task-deep-link.test.tsx` (2): `?task=` opens the editor and strips the param; a dead id strips the param (keeping the others) and never opens a dialog.

**Concurrency note.** A second AI session working in this repo left `backend/src/services/ai/tools/action-tools.ts` referencing 14 delete/bulk tools whose definitions did not exist anywhere (its WIP file `_new_write_tools.ts` had been removed) — every one of the 29 API suites failed and `tsc` was red. Its patch was saved to `Temp\opencode\action-tools-wip.patch` and the file was restored to the last green state; `service.ts` kept its (additive, compiling) `addEntry`/`deleteEntry` methods.

**Gate after the upgrade:** API 435 tests / 29 files, `tsc` API 0 errors; web 236 tests / 20 files, `tsc` 0, `next lint` clean ("No ESLint warnings or errors"), `next build` clean (19 routes); 12 dashboard routes (`/dashboard`, `/tasks`, `/calendar`, `/notes`, `/academics`, `/courses`, `/resources`, `/study`, `/goals`, `/ai`, `/exams`, `/notifications`) all HTTP 200 on the running dev server.

**"It runs but I can't see it working" (2026-10-08) — the dev stack, not the code.** Every dashboard route hung forever on the "Loading your workspace…" spinner. Root cause found with a real headless-Chrome CDP session: `GET /_next/static/chunks/app/(dashboard)/dashboard/page.js` answered **404**, so the page bundle never loaded and `useAuth` never resolved. The machine had **5 × `turbo run dev`, 6 × `tsx watch` and 2 × `next dev`** processes (the oldest started 05:53, before today's edits) all over one `.next` directory — HTML referencing chunks the competing writers no longer had. Fix: killed every StudentOS dev process, deleted `frontend/.next`, started **one** `pnpm dev`. Re-verified in real Chrome (`Temp\opencode\browser-verify.cjs`, screenshots `01-dashboard`…`04-task-editor.png`): **7/7 checks pass** — dashboard renders past the spinner, app shell present, Ctrl+K opens the palette, quick actions + Ask AI present, typing searches the server (`CDP deep` → the created task, selected row `▶`), Enter routes to `/tasks` and opens **Edit task** for it (the page strips `?task=` after opening — by design). Only remaining console noise is a pre-existing `favicon.ico` 404 (no favicon has ever existed in the repo).

### 2026-10-08 — AI Assistant chat: history window, durable retry, recency, reload correctness

The chat already had optimistic messaging, history grouping and confirmation. What it did not have was a *correct* conversation memory: long conversations forgot their recent turns, a retry could store the question twice, the sidebar's ordering went stale while you typed, and a page about to restore a conversation flashed its empty state.

- **History window bug** (`backend/src/services/ai/service.ts`). The service fetched the newest 30 messages (`orderBy: "desc"`, `take: 30`) and passed that array straight to `runAgent`, whose `buildHistory` keeps only the **last 12** — i.e. the oldest 12 of the window. A long conversation therefore replayed its *oldest* turns. The window is now reversed into chronological order before `runAgent` (and the retried question is excluded — it is the live turn, not history). Pinned by "sends the most recent conversation history to the model".
- **Retry no longer duplicates, now enforced server-side.** The user message is persisted *before* the provider runs (so a 502 never loses the question), which meant re-posting the same unanswered text created a second copy. The newest stored row is now reused when it is a `USER` row with identical content: it is updated (with a fresh context snapshot) instead of inserted, and its id comes back as `data.message.id`. The client-side `retryOf` slot reuse from 2026-10-01 is now matched by the server.
- **`conversation.updatedAt` moves when a message lands.** Prisma does not touch a parent row on child create, so the `updatedAt`-ordered, date-grouped sidebar went stale while a student was actively writing. `touchConversation()` bumps it after the user message, after the assistant reply, and on the store-only path.
- **Frontend loading / empty-state gating** (`frontend/app/(dashboard)/ai/page.tsx`). `messagesLoading` now separates "history list not settled" (`conversations.isPending || !restored`) from "this transcript not loaded yet", so a page about to restore a conversation no longer advertises an empty one. `MessageList` reports a load failure when *either* query failed, its retry refetches the right query, and the empty branch also renders the pending proposal and the send-failure banner. This also removed the stale-DOM click target the empty-state tests were hitting while the messages query toggled loading.
- **Banner retry after the reconcile refetch.** The server's copy of a persisted-but-failed question carries no `failed` marker, so the banner's Retry had nothing to send. The page now remembers `failedText` alongside the error and reuses the matching cached slot's id.
- **New tests:** 5 API (`keeps every conversation's transcript to itself`; context snapshot carries the student's own courses and never another student's; the snapshot survives on the stored row; the context is rebuilt from the authenticated student's own records; store-only messages carry no snapshot) and 2 web (opening a conversation fetches *its* transcript and drops the previous one; a reload lands back in the remembered conversation).
- **Gate:** API 435 tests / 29 files, web 230 tests / 18 files, `tsc` both apps 0, `next lint` clean, `next build` 0.

**Found afterwards, in the running app (2026-10-08): every paginated list answered 500, so the AI history panel never loaded.**

- **Root cause** (`backend/src/utils/zod-validator-shim.ts`). The success path wrote the parsed query back with a plain assignment. Express 5 exposes `req.query` as a **getter-only property on the prototype**, and assigning to an accessor with no setter is a *silent no-op* — it does not throw — so the shim's `catch`-to-`defineProperty` fallback was dead code. The validated, coerced values were discarded: `?limit=100` reached the service as the string `"100"`, `take: limit + 1` became the string `"101"`, and Prisma threw — a 500 `INTERNAL_ERROR`. Omitting `limit` worked (the service default is a real number), which is why the failure looked selective: `/ai/conversations` 200, `/ai/conversations?limit=100` 500. Reproduced live against the dev API on notes, events, courses, grades, resources, goals, study-sessions, notifications and both AI lists.
- **The AI history was the visible casualty.** The page always requests `?limit=100`; the query failed, so `selectedId` was never restored, the sidebar showed its error/empty state and old conversations could not be opened — while sending still worked (an empty-state prompt creates its own conversation). Chat fine, history dead.
- **Fix:** `Object.defineProperty(req, target, …)` always — an own data property shadows the prototype getter, and it is correct for `body`, `params` and `headers` too. Verified live: `?limit=100` 200, `?limit=101` still 400, 5 conversations with `?limit=2` returns the 2 newest with `hasMore: true`.
- **Regression test:** `contract-safety.test.ts` → "applies a valid pagination limit instead of discarding it" (creates 3 conversations, asserts `limit=2` bounds the page; plus `?limit=2` probes on tasks/notes/events/study-plans). The old suite only ever asserted the **rejection** paths (`limit=0`, `limit=101` → 400), which is why 432 green tests never noticed.
- **Gate after the fix:** API 435 tests / 29 files, web 230 tests / 18 files, `tsc` both apps 0, `next lint` clean.

**Found on the next live check (2026-10-08): a send answered 502 with a cryptic TypeError.**

- **Root cause** (`backend/src/services/ai/provider.ts`). OpenRouter replies **HTTP 200** with an in-body `error` and **no `choices`** when a route fails upstream — reproduced with `nvidia/nemotron-3-ultra-550b-a55b:free`: `{"error":{"message":"Upstream error from Nvidia: Service temporarily overloaded","code":503,…}}`. `OpenAiAdapter.chatCompletions` returned any 200 body unchecked, so `response.choices[0]` threw `Cannot read properties of undefined (reading '0')`, which the controlled-502 wrapper surfaced verbatim to the student.
- **Fix:** the adapter now throws the provider's own message when `json.error` is present and rejects a body with no `choices`; `chat()` and `chatWithTools()` additionally read `response.choices?.[0]` and fail with `AI provider returned no choices` instead of indexing blindly. The message stays redacted by the existing `sanitizeMessage` path, so the 502 now says *what* the provider reported (e.g. "Service temporarily overloaded") rather than a JS error.
- **Regression tests:** `ai-provider-resolution.test.ts` → "surfaces an in-body 200 error payload instead of crashing on choices" and "reports a 200 response with neither error nor choices as unusable" (both assert 502 + provider text + no `Cannot read properties`). The existing `failingFetch()` helper only ever mocked `ok: false`, which is why the suite missed the 200-with-error shape.
- **Live verification after the fix:** register → create conversation → list `?limit=100` (200, items present) → send a message → real grounded reply (`You have **no tasks** in StudentOS right now.`) stored with `contextSnapshot`, transcript reloads as `USER, ASSISTANT`, `?limit=1` bounds the page.
- **Gate:** API 435 tests / 29 files, web 230 tests / 18 files, `tsc` both apps 0, `next lint` clean.

**Frontend fixes (2026-10-08): the cut history boxes and the parallel dashboard upgrade.**

- **Chat History boxes cut on the left** (`components/domain/ai-conversation-sidebar.tsx`). The list carries `-mx-1`, so every row overhangs its scrollport by 4px on each side; the container only had `pr-1`, which absorbed the right overhang and **clipped the left one** — the rows read as uneven boxes. Changed to `px-1` (symmetric). Applies to the desktop column and the History drawer (same component).
- **Dashboard upgrade repaired rather than reverted** (`app/(dashboard)/dashboard/page.tsx`). The parallel upgrade left it unbuildable once (missing closing tag, imports deleted while still referenced) and then shipped functional defects: dead quick actions (`/notes?new=1`, `/study?new=1` are ignored by those pages — now `/notes?note=new` and `/study`), a duplicate "Quick task", a nested padded box inside a padded box in `ActivityRow`, `hover:bg-black/5` (invisible in dark themes), a Resources section with no link, a nonsense "Duration" term line, and no `?? 0` on `byStatus.COMPLETED`.
- **Restored functionality the rewrite had dropped:** an **Overdue** section, an **Exams** section (`/exams`), a **Courses** section with real per-course task progress, unread-notification and overdue chips, and the **AI Study Assistant** block (kept separate from Analytics). Quick actions now cover Add task / Add note / Add goal / Add course / Start study / Calendar / Ask AI, every one landing somewhere that acts.
- **Quick completion is real:** Overdue and What's next rows have a check button wired to `useCompleteTask`, and every task mutation now also invalidates `["dashboard"]` (`features/tasks/hooks.ts`), so the stat cards move without a reload. Page refresh calls `refetch()` instead of `window.location.reload()`.
- **Gate:** `tsc` 0, `next lint` clean, web 230/230, `next build` 20 routes clean.

### 2026-10-07 — Phase 3 (capstone): production safety, database safety, verification, docs

- **Production config guardrails** (`config/index.ts`): `validateConfig()` still fails fast on missing variables, and in `NODE_ENV=production` it now also rejects placeholder or short (<32 char) `JWT_SECRET`/`ENCRYPTION_KEY` and an unset/empty `CORS_ORIGINS` (the localhost default would silently block a real web origin). `productionConfigErrors()` is exported and pure, so it is unit-tested without booting anything — `tests/production-config.test.ts` (9 tests).
- **Database safety.** 17 owner/hot-path indexes added to `schema.prisma` (owner+status/date on tasks, courses, goals, academic years, semesters; `userId` on refresh tokens; ordered children; sort keys on notes/resources/events/study sessions/grades/AI lists) and shipped as `prisma/migrations/20261007000000_add_owner_indexes/migration.sql`. Two real defects fixed along the way: `init_from_schema/migration.sql` was **UTF-16LE**, which made `migrate deploy` fail on any fresh database ("string contains embedded null"), and `_prisma_migrations` on both databases still listed the deleted Phase 0 baseline names. **Verified from an empty database**: create DB → `migrate deploy` → `migrate status` clean → drop; also clean on `studentos` and `studentos_test`. Gap #15 closed. `prisma migrate dev` still cannot run here (shadow DB unreachable, P1001), so migrations are hand-written and applied with `migrate deploy`.
- **`tsx` promoted from devDependencies to dependencies** — `pnpm install --frozen-lockfile` still passes, and a production install can now actually run `start` (`tsx src/server.ts`). `tsc` remains a typecheck gate only; `dist/` is not runnable under plain node because of `moduleResolution: Bundler` + path aliases.
- **IDOR sweep** (`tests/cross-user.test.ts`): Alice creates a note, event, goal, grade, resource, study session, AI conversation, study plan and connection; Bob's GET/PATCH/DELETE against every one returns **404 `NOT_FOUND`** (never 403), and Alice can still read all of them afterwards. Plus the existing per-module ownership tests.
- **Live HTTP smoke** against a real server (`tsx src/server.ts`, port 3001): `/health` 200 with `database: connected`; register 201; duplicate register 409; login 200 with token; `GET /auth/me` 200; task create 201 → read 200 → patch 200 → delete 200 → read 404; anonymous read 401; validation failure 400 `VALIDATION_ERROR`; unknown path outside `/api/v1` 404 with the query string stripped; unknown path under `/api/v1` 401; `X-Request-Id` present, `X-Powered-By` absent; **rate limit 429 after 100 requests** with `Retry-After` and `X-RateLimit-*` headers.
- **CI actually creates its schema.** The api job generated the Prisma client and then ran tests against an empty `studentos_test` — it never applied the migrations, so it could only have failed with `P2021`. Added a `prisma migrate deploy` step and replayed the whole path locally (drop DB → create → deploy → 422/29 green).
- **Docs**: README (test counts, migration/deploy instructions, production run-book, `TRUST_PROXY`/`ENCRYPTION_KEY`/32-char secrets, "stale OpenAPI" line gone) and this file (status table, git log, CI exists, migration history, test/build table, gaps #11 and #15, next-work list).
- **Gate:** API 422 tests / 29 files, web 227 tests / 18 files, `tsc` both apps 0, `prisma validate` valid, `migrate status` up to date, `next lint` and root `pnpm lint` clean, `next build` 0, API `tsc -p tsconfig.json` 0, `pnpm install --frozen-lockfile` 0.

### 2026-10-07 — Phase 2: backend hardening for capstone review (docs, tests, production readiness, contract safety)

- **`docs/api/openapi.yaml` regenerated** (gap #2 resolved): real YAML, OpenAPI 3.1.1, **60 paths / 111 operations / 92 schemas / 759 `$ref`s, 0 broken**, verified against the 100 registered route operations (11 are the `/academics/years` alias plus the 5 public `/auth` + `/health` ops). Carries `bearerAuth`, shared 400/401/404/409/429 (+`Retry-After`)/500/502/503 responses, Zod-derived request constraints, `operationId`s, and the honest deviations (404-not-403 ownership, bare-array lists, `UPLOAD_STORAGE_UNAVAILABLE`, provider failures as 200 `success:false`, 1 MB body, in-memory pending actions).
- **New `backend/tests/contract-safety.test.ts` (15 tests)** — the cross-module regression net: standard 401 envelope on 26 protected probes in every module; success envelope on 16 list endpoints (would have caught the "Request failed (200)" envelope bug); cursor page shape; validation boundaries (`limit=0`/`limit=101`, 65-char `ai-connections` cursor, unparseable date); no DB internals in 409/404 bodies; 404 no longer echoes the query string; `X-Request-Id` present and `X-Powered-By` absent; login does not reveal whether an email exists; ownership answers 404, never 403.
- **Production readiness:** `x-powered-by` disabled; new `TRUST_PROXY` env (default `0`) drives Express `trust proxy`, so the rate limiter keys on the real client IP only when a proxy is declared; `X-Request-Id` returned on every response; `server.on("error")` (EADDRINUSE) and `unhandledRejection` / `uncaughtException` handlers in `server.ts`; the 404 message no longer reflects `req.originalUrl`'s query string.
- **Contract:** `courses/routes.ts` `withEntity()` no longer spreads the entity onto the envelope root — `{success, data}` only, the last envelope anomaly besides `/health`.
- **Gate:** API 411 tests / 28 files, web 227 tests / 18 files, `tsc` both apps 0, `prisma validate` valid, `next lint` and root `pnpm lint` clean, `next build` 0.

### 2026-10-01 — AI chat UX rebuilt: optimistic messages, modern history, verified in a real browser

The `/ai` page was functional but had the defects a student notices first: the message you just sent was invisible until the reply came back, history was an undifferentiated list of generic titles, and a brand-new account could not start a conversation at all.

**Optimistic messaging (`features/ai/hooks.ts`).** `useSendMessage` writes the user's message into the cached transcript in `onMutate`, so it is on screen before the request leaves the browser. On success the optimistic entry is replaced in place by the stored message plus the reply; on failure it is kept and marked `failed` so it can be retried in place. Client-only `optimistic` / `failed` flags were added to `AiMessage` — the API never sends them. Abort is now distinguished from failure in `lib/api/client.ts`: a stop-button abort propagates as an `AbortError` instead of becoming a `NetworkError` the student is asked to retry.

**Backend (additive only).** `PATCH /ai/conversations/:id` renames a conversation, ownership-scoped like every other AI route, and `GET /ai/conversations` now returns the newest message as `preview` so the history list can show real content. New conversations default to "New conversation" rather than "Chat". No schema change, no migration.

**History (`components/domain/ai-conversation-sidebar.tsx`, `features/ai/chat-utils.ts`).** Rows grouped by Today / Yesterday / Previous 7 days / Older with previews, active-state marking, inline rename with rollback on failure, delete, a New chat action, and the same component served as a drawer below `lg`. Titles are derived from the first message (`generateConversationTitle`) — filler stripped, proper nouns preserved, truncation bounded — and persisted through the new endpoint, so a reload keeps a meaningful list.

**One real bug, found only in the browser.** On a fresh account there were zero conversations, `selectedId` was `null`, and `send()` returned early — so the empty-state suggestions and the composer did **nothing**. Fixed with `handlePrompt`, which creates a conversation and queues the prompt, then fires it once the new conversation's transcript has loaded. The queue waits on `messages.data` rather than "not fetching": waiting on the fetch flag let the messages refetch land *after* the optimistic insert and flash the student's own message away. Covered by a new test, `first prompt with no existing conversations`.

**Everything else.** Truthful generation state that shows only tool events the API actually returned, safe minimal markdown, copy-response, distinct user/assistant bubbles, auto-scroll that yields to reading with a scroll-to-latest button, multiline composer with Enter/Shift+Enter and an over-limit counter, stop while generating, and a non-blocking error with Retry that leaves the transcript intact. The pending-action confirmation card and its per-step verified/unverified reporting were preserved unchanged.

**Retry no longer duplicates.** Both Retry entry points re-posted the failed text as a new message while the failed bubble stayed put, so the student's question appeared twice. `useSendMessage` gained `retryOf` and reuses the failed message's slot instead of appending.

### 2026-09-30 — AI Agent Core closed out. 50 tools, reference resolution, and post-write verification

The agent already read and analysed data and could propose writes, but three things were missing for a trustworthy `PROPOSE → CONFIRM → ACT` loop: the tool surface had holes (no updates for events, grades, resources or courses; no way to reach subtasks, tags, milestones, notifications or the academic structure), a write could only be aimed at a record by raw id, and a service returning `ok` was reported to the student as a completed change without ever being read back.

**Tool surface: 14 → 50.** READ 21, ANALYZE 7, WRITE 22.

- New READ tools: `get_note` (bounded full content), `search_notes` (with excerpts), `get_task_subtasks`, `get_task_tags`, `get_goal_milestones`, `get_academic_structure`, `get_notifications`.
- New WRITE tools: `create_subtask`, `update_subtask`, `create_task_tag`, `create_milestone`, `update_milestone`, `update_note`, `update_resource`, `create_event`, `update_event`, `create_grade`, `update_grade`, `update_course`.
- Existing writes gained the same treatment: every one now takes a natural reference alongside its id.
- Fixed `get_notifications`, which called `notificationsService.list` with `{ unread }` while the tool named the argument `unreadOnly` — the filter was silently dropped.
- Fixed a latent bug this exposed: milestone status offered `CANCELLED`, which the goal service does not accept, so any milestone write failed schema validation at the service boundary.

**Natural references (`tools/resolver.ts`, new).** Every tool that touches an existing record now accepts what the student said — a course code, a task title, "the Database exam" — and resolves it through the existing services. Ambiguity is refused with the candidate list attached so the model asks a question instead of guessing; a miss is refused rather than substituted. A subtask only resolves inside its own task and a milestone only inside its own goal. Course codes match with or without a space (`PSYC300` / `PSYC 300`).

**Resolution happens before approval, not after.** The new optional `prepare(args, ctx)` hook on a tool definition is called by the registry before a write is parked as a proposal, and the *resolved* arguments are what get stored and shown. Without this, the confirmation card would have said "add a task to `PSYC300`" as an unexpanded reference, and a bad reference would only have surfaced after the student clicked Confirm. This was found by a test, not by inspection: the first run of the new natural-reference suite failed with `confirmation_required` on every case, because the registry intercepts writes before the handler ever runs.

**Verification (`tools/verify.ts`, new).** After each confirmed step, the changed record is re-read **through the same domain service that wrote it** and the approved fields are compared; 96 field mappings cover the 21 mutation tools, and `complete_task` is checked with an `expect` predicate because its outcome is a status it never receives as an argument. `ok && verified` is the only state the assistant may call a success; a write that returned `ok` but did not match on re-read is reported as unverified with the mismatch named. Outcomes are per action and never abort the batch, and `summarizeOutcomes()` is shared by the REST and chat paths so both describe the same outcome identically. The REST confirm endpoint returns `PARTIAL` unless every step is applied **and** verified.

**Three defects found in the verifier by reviewing it after writing it, and fixed:**

- `complete_task` mapped `status` in its field table but the tool takes **no** `status` argument, so the comparison loop skipped it and the action verified on its title alone — a task that was never completed would have been reported as done. Verifiers now take an optional `expect` predicate for an outcome the tool exists to produce.
- 17 approved tool/field pairs were never re-read: task `description`/`type` (create and update), `focusRating` and `endedAt` (create and update), tag `color`, and `description` on goal, resource (create and update), event (create and update) and course, plus grade `recordedAt` (create and update). Each write verified on the strength of its other fields. All are now mapped: the 21 mutation tools carry 96 approved field mappings between them, and a test compares every WRITE tool's declared arguments against its verifier's fields so this cannot recur.
- Timestamps were compared **to the day**, so an exam approved for 14:00 and stored at 09:00 on the same day verified. Date-only approvals still compare the day (the tool normalises `"2026-01-15"` to 09:00 local, and only the day was asked for); anything carrying a time now compares the exact instant.

**Bounded loop (`agent.ts`, `config/index.ts`).** Added `MAX_TOOL_CALLS` (12) and `MAX_PROPOSED_ACTIONS` (8) alongside the existing round limit, each with an `AI_AGENT_MAX_*` env override that can only *lower* it. Tool calls past the budget are dropped with the model told, and writes past the proposal budget are refused with `proposal_limit` rather than silently dropped.

**UI.** The confirmation card now renders the API's real per-step results — applied and verified, applied but unverified, or not applied — from a new `AiActionOutcome[]` cache written only by a confirm response. The toast reports the server's own count instead of a blanket "Change applied", and a `PARTIAL` result is an error toast. Added `useActionOutcomes()` and the `notes`/`resources`/`events`/`grades`/`courses` cache invalidations the wider tool surface now needs.

**Verification run (all re-run after the last edit, 2026-09-30):** API 26 files / 377 tests, 0 fail. Web 15 files / 136 tests, 0 fail. API and web typecheck pass, both builds pass, web lint clean.

**Still not verified:** anything against a real provider (gap #29). Confirmations remain in-memory (gap #30).

### 2026-09-29 — Phase 3 (Integration QA) begun. Gap #25 closed; 3 more runtime defects found by the browser

The per-package suites were fully green and the AI Connections feature was still **unusable in a browser**. Running the two apps together and driving them with Chromium exposed four defects that no existing test covered. This is the payoff of Phase 3 and the reason gap #11 (no CI) matters: every one of these was invisible to `pnpm test`.

#### Environment / database (gap #25)

- `prisma migrate deploy` is a **no-op** against the dev DB: both migrations sit in `_prisma_migrations` with `applied_steps_count = 0` (they were baselined with `resolve --applied`, gap #15), so Prisma believes the work is done. The dev DB had no `ai_connections` table.
- `prisma migrate diff` was run first to prove the change was additive — one `CREATE TABLE`, one unique index, one FK, no `DROP` or `ALTER` — then `prisma db push` applied it to `studentos`. Table now has all 10 columns; `prisma.aiConnection.count()` succeeds; the table was left empty (the UI test fixtures were deleted afterwards).

**Bug 1 — missing `ENCRYPTION_KEY` (gap #26)**

- `POST /ai-connections` returned `500 INTERNAL_ERROR_DEV: ENCRYPTION_KEY environment variable is not set`. `vitest.config.ts` supplies the key, so all 261 tests were green.
- Added a random key to the gitignored `backend/.env` and a documented blank to `.env.example`.
- `config.encryptionKey` added and checked in `validateConfig()`, so a missing key is now a **boot** failure with the standard message. Verified by temporarily stripping the key from `.env` and confirming the throw, then restoring it. `encryption.ts` still reads `process.env.ENCRYPTION_KEY` directly — `config` exists purely so the value can be validated.

#### Bug 2 — the response envelope (gap #27) — the one that broke the UI

- All 8 AI Connections success responses returned `{"data": …}` with **no `success` field**. `frontend/lib/api/client.ts:110-113` only unwraps a 2xx body when `success === true`, so the Settings panel rendered `Request failed (200)` plus a retry button on a completely successful response.
- All 8 now send `{ success: true, data }`. The 404 on `GET /ai-connections/active` now throws `NotFoundError` instead of an ad-hoc `res.status(404).json({ error })` body, so it uses the shared error envelope.
- **The tests could not have caught this:** they asserted `res.body.data` and never `res.body.success`. 8 regression tests now pin the envelope on every endpoint, including the error shape. API 261 → 269.
- Audited every other module for the same class of bug — AI Connections was the only offender; all other domains already conformed.

#### Bug 3 — wrong API URL (gap #28)

- `frontend/.env.local` set `NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1`, i.e. the web server itself, and `next.config.mjs` defines no rewrite proxy. Every API call 404'd and login was impossible. `.env.local.example` already had the correct `:3001`.

#### Verification

- API **269/269**, web **77/77**, `tsc --noEmit` clean in both apps, `next lint` clean, `pnpm build` 2/2, `prisma migrate status` up to date.
- Browser E2E (Chromium, `pnpm dev`): login → Settings → empty state → create Ollama connection → row renders → persists across reload → activate → delete → empty state restored. No credential material present in the DOM.

**Method note.** Three early UI checks produced false readings and were discarded: `items=` counts were wrong because the list returns `{items, hasMore, nextCursor}` rather than a bare array (a PowerShell bug on my side, not a product bug); a selector missed because the provider field is a Radix `Select`, not a native `<select>`; and a screenshot was unreadable because this model has no image input. Switching to raw response bodies and DOM assertions is what actually surfaced the envelope bug. Do not trust a green UI check you have not read the raw payload for.

**Still unfixed.** Gaps #26 and #28 exist only in gitignored files, so a fresh clone still fails to boot and cannot log in. Closing gap #22 (`.env.example` gitignored) is now a prerequisite, not a nicety.

### 2026-09-28 — Phase 2 closed out. 3 test failures fixed + the AI Connections settings UI

#### Environment

- `backend/.env` pointed at a PostgreSQL role `elyassql` that does not exist on this machine (only `postgres` does). Every API suite failed in `beforeAll`, so 261 tests reported as **skipped** and 0 actually ran. Both URLs now use the `postgres` role. New gap #24 records the failure mode.

#### Contract decisions (both were previously undecided; see gap #20)

- *Ollama needs no key.* `credentials` became optional in the type and is required at runtime for every other provider. `isCredentialFreeProvider()` + `CREDENTIAL_FREE_PROVIDERS` live in `ai-connections/schema.ts`; the same rule is restated in `superRefine` in `CreateAiConnectionSchema`, `TestConnectionInputSchema` **and** the shared `createBodySchema` route validator, so a bad request is rejected at the edge with the usual 400 either way. `createConnection` stores an encrypted empty string because `credentialsEncrypted` is non-nullable; `parseProviderCredentials("")` already returns `{}`.
- *One connection per provider is intended.* `@@unique([userId, provider])` stays. The "activates only one connection at a time" test now builds its two fixtures from **different** providers (openai + anthropic), which still proves that activating one deactivates the other.

#### Bug fix

- `AiProviderNotConfiguredError` extended plain `Error`, so the documented 503 fell through `globalErrorHandler` as a 500 `INTERNAL_ERROR_DEV`. It now extends `ApiError` (503 `AI_PROVIDER_NOT_CONFIGURED`), and a sibling `AiProviderError` (502 `AI_PROVIDER_ERROR`) was added so provider failures are also controlled rather than 500s.

#### New — frontend AI Connections (the last unimplemented Phase 2 item)

- `features/ai-connections/ai-connections-api.ts` — transport only, via `api.*`.
- `features/ai-connections/hooks.ts` — TanStack Query hooks under the `["ai-connections"]` key.
- `features/ai-connections/connection-form.tsx` — create/edit dialog. Exports `connectionFormSchema` so it can be unit-tested without rendering, matching the `academic-forms` precedent. Sends a bare key string, which the API's `parseProviderCredentials` already accepts as the key itself.
- `features/ai-connections/connection-list.tsx` — `AiConnectionsPanel`, the rows plus enable/activate/edit/delete.
- `AiConnection`/`AiConnectionTestResult`/`AiProviderName` added to `types/api-types.ts`; `AI_PROVIDER_LABELS`, `CREDENTIAL_FREE_PROVIDERS`, `ENDPOINT_REQUIRED_PROVIDERS` added to `lib/labels.ts`.
- `AiConnectionsPanel` is a **section on `/settings`**, not a nav item and not a separate page.
- Keys are write-only by design: the API never returns them, so the edit form leaves the field blank and `toPayload` omits an empty `credentials` to preserve the stored key.

#### Tests

- `frontend/tests/ai-connections.test.ts` — 9 new tests over the provider-label helpers and `connectionFormSchema` (per-provider key requirement, ollama without a key, endpoint requirement for ollama/custom, blank-as-absent).
- `tests/ai-connections.test.ts` — the activate test's fixtures changed to two providers. No assertions were weakened.

Verification (see §12 for the full table)

- API **261/261**, web **77/77**, `tsc` clean in both apps, `pnpm build` 2/2, `next lint` clean.

### 2026-09-27 — Structure cleanup (Phase 2 → pre-Phase-3). No behaviour changed

Moved

- `frontend/features/api-types.ts` → `frontend/types/api-types.ts`; 55 import sites rewritten `@/features/api-types` → `@/types/api-types`.
- 11 colocated web tests + `src/test/setup.ts` → flat `frontend/tests/`; `vitest.config.ts` `include`/`setupFiles` and the `lint` script updated.
- `backend/verify_phase1.sh` → `scripts/verify-prisma-baseline.sh` (absolute machine path replaced with a script-relative one).
- `QA_FINAL_REPORT.md`, `frontend/FRONTEND_PROGRESS.md`, `Phase2-Audit.md` → `docs/audits/`; `backend/openapi.yaml` → `docs/api/`. Each archived doc got a one-line "Archived historical snapshot" banner.

Deleted (each proven unreferenced or duplicated — see §13 for the full audit trail)

- `backend/types/semesters.ts` — zero importers; duplicated types already derived from Zod.
- `backend/src/schema/academics.ts` — 113-line duplicate Zod layer; the real validation is in `academic-years/schema.ts` and `semesters/schema.ts`. Its two live type exports moved into `academic-years/schema.ts`.
- `apps/api/src/modules/ai-connections/index.ts` (old layout; deleted, no replacement) — orphan barrel; no other module has one, nothing imported it.
- `frontend/components/domain/goal-card.tsx` — orphan duplicate of `features/goals/goal-card.tsx`, which is what the goals page actually renders.
- `frontend/components/domain/event-card.tsx` — orphan; the calendar and exams pages render event markup inline.
- `package-lock.json` and `backend/pnpm-lock.yaml` (a 6-line empty stub) — `pnpm-lock.yaml` is the only lockfile.
- 11 empty directories: `apps/mobile/`, `packages/config/`, `packages/ui/`, `packages/shared/src/{types,utils,constants}/`, `docs/{architecture,database,decisions,product}/`, `.github/`.

Config

- `package.json`: removed the npm `workspaces` array (duplicate of `pnpm-workspace.yaml`); `start` now uses pnpm.
- `packages/shared/package.json`: dropped the three dead export subpaths.
- `turbo.json`: `test.inputs` now covers `frontend/{src,tests}/**`.
- `frontend/package.json`: `lint` is `next lint --dir src --dir tests` so the relocated tests stay linted.
- `backend/src/routes/ai-connections.ts`: auth import aligned with the other 16 route files.

Deliberately **not** done

- No new `src/middleware/`, `src/utils/`, `types/`, `features/hooks/` or `schemas/` folder — nothing warranted them.
- `src/routes/index.ts` kept as the single router aggregator.
- Duplicate JWT implementations (gap #4), the 3 unused UI primitives, and the 3 unreferenced shared schemas left in place and documented rather than deleted.

Verification (see §12 for the full table)

- Web: 68/68 tests, `tsc --noEmit` clean, `next build` 20 routes, `next lint` clean.
- API: 249/261 tests pass, 12 failures and 4 `tsc` errors — **all pre-existing**, proven by restoring the pre-cleanup files and reproducing them identically.
- Prisma: schema valid; `migrate status` up to date with 2 migrations.

### 2026-09-27 — Phase 2 AI Connections compile fix (4 errors, no behaviour change)

The four `tsc` errors were real, not cosmetic: the AI runtime could never have loaded a user's connection.

- `ai-connections/schema.ts` — `credentials` was `.optional().nullable()` in `CreateAiConnectionSchema` and `TestConnectionInputSchema` while `credentialsEncrypted` is a **non-nullable** column and both route validators already required it. Made it `z.string().min(1).max(2000)`, matching the HTTP contract. `POST /:id/test` is unaffected because that branch reads credentials from the DB and never parses this schema.
- `ai-connections/service.ts` — imported `type ProviderCredentials`; `maskProviderCredentials` now takes the output of `parseProviderCredentials()` instead of a raw string, and reads the 3 undeclared extra keys (`password`/`portal`/`orgId`) through a `Record<string, unknown>` view so no credential masking is lost and the interface is not widened.
- `ai-connections/service.ts` — **added `getActiveUserConnection(userId)`**, the function `ai/provider.ts:641` was already destructuring. It returns `{ provider, decryptedCredentials, endpoint }` for the active, enabled connection, or `null`. This is the only path that returns decrypted credential material and it is not exposed over HTTP. `ai/provider.ts` needed no change: it already expected exactly this shape, so the chat path now really does authenticate with the user's saved key.
- Result: `tsc` exit 0, `pnpm --filter @studentos/api build` passes, full API suite unchanged at 249/261 (the 12 failures are test/contract bugs, now itemised in gap #20 — 9 of them are bugs in `tests/ai-connections.test.ts` itself).

---

## Unverified

Could not be confirmed from the repository, so treat as unknown rather than assuming:

- **Product roadmap / phase definitions.** "Phase 1/2/3" appear only in `INSTRUCTIONS_FOR_AGENT.md` and the archived `docs/audits/qa-final-report.md` prose. There is no authoritative phase document; `docs/` holds the current OpenAPI contract plus the archived audits. The phase labels in this file are inferred from the code, not quoted from a spec.
- **Deployment / infrastructure.** No Dockerfiles, no compose files, no hosting config — only `.github/workflows/ci.yml`. How this is intended to be deployed beyond the README run-book is undocumented.
- **Intended mobile client.** The OpenAPI description mentions "web and mobile clients", but only a web client exists in this monorepo. No mobile code, no API versioning/deprecation policy.
- **Seed credentials beyond the demo user.** `prisma/seed.ts` creates `demo@studentos.dev` with password `StudentPass123!` (Alex Rivera) and at least one further user (Bob), but the full seeded roster and its credentials were not enumerated.
- **Database contents of the local dev database** (`studentos` on port 5432) and whether the local PostgreSQL instance is meant to be shared or per-developer.
- **Whether the AI provider was ever exercised against a real endpoint.** Superseded: a real OpenRouter completion was seen on the wire on 2026-10-01 (see [§12](#12-test--build-status-verified-2026-10-07)), though the free model was intermittently 429 and does not reliably call write tools (gap #33). Gemini, Anthropic, Ollama and the custom endpoint remain unverified against a live endpoint.
