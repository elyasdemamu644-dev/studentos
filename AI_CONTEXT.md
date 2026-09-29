# AI_CONTEXT — StudentOS source of truth

> **Snapshot:** 2026-09-27, verified after the structure cleanup. Every claim below was read from code or produced by running a command in this repo. Anything not verifiable is listed in [Unverified](#unverified).
> **Scope:** this file is the onboarding document for AI agents. Human setup lives in [README.md](README.md); agent workflow rules live in [INSTRUCTIONS_FOR_AGENT.md](INSTRUCTIONS_FOR_AGENT.md).
> **Latest AI work:** structure cleanup completed — see [§17 Change log](#17-latest-ai-work--change-log).

---

## READ ONLY WHAT YOU NEED

**Do not scan the whole repository.** This file already tells you the architecture, the conventions, and where things live. Reading all ~280 source files wastes time and tokens and tends to *reduce* accuracy.

Read in this order, and stop as soon as you have what you need:

1. **This file** (always, in full — it is the map).
2. **[INSTRUCTIONS_FOR_AGENT.md](INSTRUCTIONS_FOR_AGENT.md)** (the workflow contract).
3. **`docs/api/openapi.yaml`** — only for route-surface questions, and it is stale (gap #2). `docs/audits/` is archived history, never current state.
4. **Only the files your task touches** — use the lookup tables below to resolve names to paths.
5. **The matching test file** — tests encode the contract better than the code does.
6. **Only if still blocked**, widen the search.

### Task → files to read

| Task | Read these | Nothing else unless blocked |
|---|---|---|
| Add/change an API endpoint | `src/modules/<domain>/{routes,service,schema}.ts` | `src/routes/index.ts` (only if mounting), `tests/<domain>.test.ts` |
| Change list pagination / response envelope | `src/modules/<domain>/service.ts` | `packages/shared/src/schemas/api.ts` |
| Change error codes / status mapping | `src/config/errors.ts`, `src/config/http.ts` | `packages/shared/src/schemas/api.ts` (`ERROR_CODES`) |
| Change auth / tokens / login | `src/modules/auth/routes.ts`, `src/modules/auth/middleware.ts` | `src/lib/jwt.ts` (see [Known issue #4](#known-gaps--issues)) |
| Change DB schema | `prisma/schema.prisma` | `prisma/seed.ts`, `tests/helpers.ts` (table list) |
| Add a web page | `src/app/(dashboard)/<name>/page.tsx`, `src/components/layout/app-shell.tsx` | `src/features/<domain>/` |
| Change HTTP transport / token refresh | `apps/web/src/lib/api/client.ts` | `apps/web/src/lib/api/auth-session.ts`, `apps/web/src/lib/api/errors.ts` |
| Change data fetching on web | `apps/web/src/features/<domain>/hooks.ts` | `*-api.ts` in same folder |
| Change AI behaviour | `src/modules/ai/{service,context,provider}.ts` | `tests/ai.test.ts` |
| Change AI provider connections | `src/modules/ai-connections/{routes,service,schema}.ts`, `src/lib/encryption.ts` | `tests/ai-connections.test.ts`, `src/modules/ai/provider.ts` (error classes + `getActiveUserConnection`) |
| Change theme / styling tokens | `apps/web/src/lib/theme/themes.ts` | `apps/web/tailwind.config.ts`, `apps/web/src/app/globals.css` |
| Change a shared frontend type | `apps/web/src/types/api-types.ts` | — |

### Anti-patterns

- Do not read `node_modules/`, `.next/`, `dist/`, `.turbo/` — never useful.
- Do not read every file in `apps/web/src/features/*` to learn "the pattern". Read **one** feature folder; the pattern is uniform.
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
|---|---|
| Phase | Post-Phase-2. **Phase 2 is now closed out** (2026-09-28): all 261 API tests and 77 web tests pass, and the AI Connections settings UI exists. Phase 3 (Integration QA) has not been started. |
| Last committed checkpoint | `a07ae08` — *chore: stabilize current studentos baseline* |
| Working tree | **DIRTY — large uncommitted change set (see [§3](#3-git--checkpoint-state))** |
| Tests | API **261/261 pass**, Web **77/77 pass** — 0 failures. Gap #20 is closed. |
| Builds | `tsc` (API) **passes**; `pnpm build` (root, both apps) **passes**; `next build` (Web) 20 routes |
| Lint | `next lint` **clean** (web only, `src` + `tests`). No lint config exists for the API — `tsc` is its only gate. |
| CI | **None.** There is no `.github/` directory. |
| Overall | Structure is standardized, the API compiles, every package test suite is green, and the root build passes. Still nothing committed. |

---

## 3. Git & checkpoint state

Branch `main`. Two commits total:

```
a07ae08  chore: stabilize current studentos baseline      <- HEAD
f7fb172  Initial commit: StudentOS monorepo (Express API + Next.js web + shared schemas)
```

**The working tree is not clean.** The committed tree and the working tree differ. When a task says "the current state", it means the **working tree** unless it says otherwise. `git diff` before you assume a file is unchanged.

Uncommitted work in progress:

- New pages: `(dashboard)/academics/`, `(dashboard)/exams/`, `(dashboard)/notifications/`, `(dashboard)/resources/`
- New features: `features/academics/`, `features/notifications/`, `features/resources/`, `components/domain/notification-bell.tsx`, `features/events/exam-utils.ts`
- New API module: `modules/ai-connections/` (+ `src/lib/encryption.ts`) — compiles; 2 of its tests need a contract decision, see gap #20
- Modified: `app-shell.tsx`, `dashboard/page.tsx`, `courses/[id]/page.tsx`, `labels.ts`, `api-types.ts`, plus API `routes.ts`/`service.ts` files, `ai/provider.ts` and `api/tsconfig.json`
- New tests: API `ai-connections`, `course-summary`, `dashboard-command-center`, `malformed-body`; Web `app-shell`, `academic-forms`, `exam-utils`, `notification-utils`

**Consequence for agents:** a `git checkout`/clean would destroy in-flight work.

---

## 4. Monorepo structure

pnpm workspaces + Turborepo. 3 packages. This is the **verified actual layout** after the 2026-09-27 cleanup.

```
StudentOS/
├── AI_CONTEXT.md                  <- you are here
├── INSTRUCTIONS_FOR_AGENT.md      <- agent workflow contract
├── README.md                      <- human setup
├── package.json                   <- root scripts (turbo passthrough, pnpm only)
├── pnpm-workspace.yaml            <- packages: apps/*, packages/*
├── pnpm-lock.yaml                 <- the only lockfile
├── turbo.json                     <- task graph
├── docs/
│   ├── api/openapi.yaml           <- STALE OpenAPI 3.1.1 doc, see gap #2
│   └── audits/                    <- archived historical reports, not current state
│       ├── qa-final-report.md         (was QA_FINAL_REPORT.md)
│       ├── frontend-progress.md       (was apps/web/FRONTEND_PROGRESS.md)
│       └── phase-2-ai-connections-audit.md (was Phase2-Audit.md)
├── scripts/
│   └── verify-prisma-baseline.sh  <- manual Prisma/migration verification
├── apps/
│   ├── api/                       <- @studentos/api  (Express 5 + Prisma + PostgreSQL)
│   │   ├── prisma/                <- schema.prisma, seed.ts, migrations/
│   │   ├── src/                   <- app.ts, server.ts, config/, lib/, modules/, routes/
│   │   └── tests/                 <- 23 *.test.ts + helpers.ts + setup.ts (flat)
│   └── web/                       <- @studentos/web  (Next.js 14 App Router)
│       ├── src/                   <- app/, components/, features/, lib/, types/
│       └── tests/                 <- 12 *.test.ts + setup.ts (flat)
└── packages/
    └── shared/                    <- @studentos/shared (Zod schemas)
        └── src/schemas/           <- the only source folder
```

There is **no** `.github/`, no `apps/mobile/`, no `packages/config/`, no `packages/ui/`, and no `apps/api/src/types/` — those were empty or orphaned and have been removed.

| Package | Name | Stack |
|---|---|---|
| `apps/api` | `@studentos/api` | Express 5, TypeScript (ESM), Prisma 6, PostgreSQL, Zod, jose, `@node-rs/argon2`, Vitest + supertest |
| `apps/web` | `@studentos/web` | Next.js 14.2.30 (App Router), React 18, TypeScript `strict`, Tailwind 3.4, Radix UI, TanStack Query v5, react-hook-form + Zod, Recharts, lucide-react, sonner, Vitest + jsdom + Testing Library |
| `packages/shared` | `@studentos/shared` | Zod schemas. Depends on `zod` — **do not remove it** (it caused a past build break) |

`packages/shared` exports raw TS via a single `exports` entry: `@studentos/shared/schemas/<name>` → `./src/schemas/<name>.ts`. The dead `./types/*`, `./utils/*` and `./constants/*` entries were removed (gap #17 resolved). Only 9 of the 12 schema files are imported — see gap #21.

---

## 5. Backend architecture

```
src/server.ts    bootstrap: validateConfig() -> prisma.$connect() -> app.listen(port)
                 graceful shutdown on SIGTERM/SIGINT (10s force-exit); only runs when executed directly
src/app.ts       express app: helmet -> cors -> compression -> json(1mb) -> urlencoded
                 -> requestLogger -> /health -> /api/v1 -> notFoundHandler -> globalErrorHandler
src/routes/index.ts   the apiRouter: mounts every domain router under /api/v1 (single aggregator file)
src/config/      index.ts (env + validateConfig), errors.ts (ApiError), http.ts (logging + handlers)
src/lib/         prisma.ts, jwt.ts, zod-validator-shim.ts, encryption.ts   (cross-cutting infra only)
src/modules/<domain>/  routes.ts + service.ts + schema.ts (+ auth: middleware.ts; ai: context.ts, provider.ts)
```

There is deliberately **no** `src/middleware/`, `src/utils/` or `src/types/` — nothing warranted them. The auth guard lives with its feature in `src/modules/auth/middleware.ts` and is re-exported from `auth/routes.ts`; all 17 route files import it from `@/modules/auth/routes`.

**Module layout convention:** `routes.ts` (HTTP: validation, auth, status codes) → `service.ts` (Prisma queries, ownership scoping, `map*` response mappers) → `schema.ts` (Zod). Services are also imported directly by tests and, for auth, by other modules. No module has a barrel `index.ts`; import the specific file.

**Nested features:** `modules/academics/` is the only two-level module — it aggregates `academic-years/` and `semesters/`, each with its own complete `{routes,service,schema}.ts`.

**Mounting quirk:** `subtasks` and `task-tags` are mounted at `/` (not `/tasks`) because their routers declare the full `/tasks/:taskId/...` paths themselves. Do not "fix" this.

**Validation:** `zValidator` is imported from `@/lib/zod-validator-shim` (a shim over `zod-express`, which is unmaintained). Prefer the shim; do not swap in `express-zod-api` casually.

**Rate limiting is NOT implemented.** `config.rateLimitMaxRequests` / `rateLimitWindowSeconds` are parsed from env but no rate-limit middleware is mounted in `app.ts`. See [Known issue #5](#known-gaps--issues).

### API conventions (enforced by tests)

| Rule | Detail |
|---|---|
| Base path | `/api/v1` (mounted in `app.ts:44`); health is outside it at `/health` |
| Public routes | `/health`, and `/api/v1/auth/{register,login,refresh,logout}` |
| Everything else | Requires `Authorization: Bearer <access token>` |
| Success envelope | `{ success: true, data: T }` |
| Error envelope | `{ success: false, error: { code, message } }` |
| Pagination | **Cursor-based.** Query: `limit` (int 1–100, default **50**) + `cursor` (id). Response: `{ items, hasMore, nextCursor }`. Implemented via `take: limit + 1` then slice. |
| Cross-user access | Returns **404**, never 403 — ownership is part of the query filter, so other users' rows simply do not match. |
| Duplicate create | 409 `CONFLICT` / `DUPLICATE_VALUE` |
| Validation failure | 400 `VALIDATION_ERROR` |
| Server error | 500 `INTERNAL_ERROR` in production; `INTERNAL_ERROR_DEV` (leaks the raw message) otherwise |

**Dead code warning:** `packages/shared/src/schemas/api.ts` defines `PaginationInput`/`PaginationOutput` on a `page`/`limit`/`total` model. **Nothing uses them.** The real convention is the cursor scheme above. Do not build on the page-based types.

### Error code mapping (`src/config/http.ts`)

| Source | HTTP | Code |
|---|---|---|
| `ApiError` | as constructed | as constructed |
| `ZodError` | 400 | `VALIDATION_ERROR` |
| Prisma `P2002` | 400 | `DUPLICATE_VALUE` |
| Prisma `P2025` | 400 | `NOT_FOUND` |
| Prisma `P2003`/`P2007` | 400 | `FOREIGN_KEY_VIOLATION` |
| Prisma other `P2xxx` | 400 | `DATABASE_ERROR` |
| anything else | 500 | `INTERNAL_ERROR` / `INTERNAL_ERROR_DEV` |

Note Prisma errors are flattened to **400**, including `P2025` (not found). Standard codes live in `ERROR_CODES` in `packages/shared/src/schemas/api.ts`; auth-specific codes (`AUTH_*`) are defined in `src/modules/auth/middleware.ts`.

### Route surface

| Domain | Endpoints (under `/api/v1`) |
|---|---|
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

`POST /notifications/generate` and `GET /courses/:id/summary` are recent additions in the uncommitted working tree.

**`GET /ai-connections/active` must be registered before `GET /ai-connections/:id`**, otherwise Express matches the literal `active` as an `:id` and 404s it. Same trap applies to any future literal-path route in a `/:id` router.

---

## 6. Frontend architecture

```
src/app/
  layout.tsx  globals.css  providers.tsx
  (auth)/     layout, /login, /register
  (dashboard)/ layout (AppShell + auth guard), and pages:
               /  /dashboard  /courses  /courses/[id]  /academics  /tasks
               /calendar  /exams  /notes  /notifications  /resources
               /study  /goals  /analytics  /ai  /settings
src/lib/      api/{client,auth-session,errors}.ts  theme/{themes,theme-provider}.tsx
              format.ts  labels.ts  utils.ts
src/features/ <domain>/{*-api.ts, hooks.ts, *-form.tsx}
src/components/ ui/ (Radix primitives)  domain/ (course-card, task-card, event/goal cards removed — see §17)
              layout/app-shell.tsx  page-header.tsx  states.tsx  feedback.tsx  theme-toggle.tsx
              error-boundary.tsx
src/types/    api-types.ts   <- shared frontend DTO types, imported by 55 files across all layers
tests/         12 *.test.ts + setup.ts   (NOT colocated — see §12)
```

There is deliberately **no** `src/hooks/` or `src/schemas/`: every hook is feature-local (`features/<domain>/hooks.ts`) and every Zod schema is feature-local (`features/<domain>/schemas.ts` or beside the form). Do not create top-level folders for these.

| Concern | Implementation |
|---|---|
| Transport | **Only** `src/lib/api/client.ts`. Components never call `fetch`. Exposes `api.get/post/patch/put/delete`, injects the bearer token, unwraps the envelope, and maps failures to `ApiClientError` / `NetworkError` / `SessionExpiredError`. |
| Token refresh | Automatic, **retry-once**: a 401 with code `AUTH_TOKEN_EXPIRED` or `AUTH_INVALID_TOKEN` triggers `POST /auth/refresh`, then one replay. Concurrent refreshes share a single in-flight promise. Failure → `SessionExpiredError`. |
| Session storage | `src/lib/api/auth-session.ts` — `localStorage` (survives reload). **Not** httpOnly cookies; see gap #6. |
| Server state | TanStack Query v5, one `QueryClient` in `providers.tsx` (`retry: 1`, `staleTime: 15s`, `refetchOnWindowFocus: false`). |
| Forms | react-hook-form + `@hookform/resolvers` + Zod. Schemas live in `features/<domain>/schemas.ts` or next to the form. |
| AI connections UI | `features/ai-connections/` — `AiConnectionsPanel` is a section on `/settings` (not a nav item). `connection-list.tsx` owns the rows and the enable/activate/edit/delete actions; `connection-form.tsx` owns the create/edit dialog and exports `connectionFormSchema` for tests. Keys are write-only: the API never returns them, so the edit form leaves the field blank to preserve the stored key. |
| Theme | `ThemeProvider` (own implementation, not `next-themes`): 8 presets, 11 accents, light/dark/system, driven by a `data-theme` attribute. Bootstrap script prevents flash. |
| Notifications (UI) | `sonner` via `Toaster` in `providers.tsx`; `NotificationBell` in the header; `NotificationBootstrap` calls `POST /notifications/generate` **once per browser session** after sign-in (guarded by `sessionStorage`). |
| Rendering | Pages are server-rendered shells around client data. `next build` prerenders 19 routes statically; `/courses/[id]` is dynamic (ƒ). |

Navigation (`app-shell.tsx`): 12 sidebar items — Dashboard, Courses, Academics, Tasks, Calendar, Exams, Notes, Resources, Study, Goals, Analytics, AI Assistant — plus Settings in the sidebar footer. Mobile bottom bar shows 5: Dashboard, Tasks, Courses, Study, Exams. `/notifications` has **no** nav entry; it is reached via the bell.

---

## 7. Database / Prisma

- PostgreSQL. Generator `prisma-client-js`. Schema: `apps/api/prisma/schema.prisma`.
- **Migration history exists**: `prisma/migrations/20260926004652_baseline/` and `prisma/migrations/20260926010000_add_ai_connections/`. `prisma migrate status` reports "Database schema is up to date!" against the local dev database. `prisma validate` passes.
- 22 models, all `@@map`-ed to snake_case plural tables; 17 enums.
- Prisma client singleton lives in `src/lib/prisma.ts` **and** `src/server.ts` (the server one is cached on `globalThis` in development). Tests import it as `prisma` from `@/server`.
- All child models cascade from `User`. Optional course/task relations use `onDelete: SetNull`.

| Group | Models |
|---|---|
| Identity | `User`, `RefreshToken`, `UserSetting` (`@@unique([userId,key])`) |
| Academics | `AcademicYear`, `Semester` |
| Courses | `Course` |
| Tasks | `Task`, `TaskSubtask`, `TaskTag` (`@@unique([taskId,name])`) |
| Content | `Note`, `Resource`, `Event` |
| Tracking | `StudySession`, `Goal`, `GoalMilestone`, `Grade` |
| Notifications | `Notification` (indexed `[userId,status]`, `[userId,createdAt]`) |
| AI | `AiConversation`, `AiMessage` (indexed `[conversationId,createdAt]`), `AiStudyPlan`, `AiStudyPlanEntry`, `AiConnection` (`@@unique([userId,provider])`, uncommitted) |

Notable column-level facts: `Task.estimatedMinutes` + `Task.completedAt`; `Course.instructor`; `StudySession.durationMinutes` (stored, not derived at read); `Resource` has both URL fields and S3 fields (`fileKey`/`fileName`/`fileSize`/`mimeType`); `AiMessage.contextSnapshot` stores the JSON context actually sent to the model.

`TaskRecurrenceRule` and `RecurrenceFrequency` are **commented out** in the schema — recurring tasks are deferred to v1.1.

`User` has **no `role` and no `residency` column** (see gap #3).

Seed: `apps/api/prisma/seed.ts` (`pnpm --filter @studentos/api db:seed`). It `deleteMany`s all 21 tables in FK order, then creates `demo@studentos.dev` plus `createMany` sample data. **It is destructive.** There is no root-level `db:seed` script.

---

## 8. Authentication & security

| Concern | Implementation |
|---|---|
| Password hashing | `@node-rs/argon2` (`hashPassword` / `verifyPassword` in `src/modules/auth/routes.ts`) |
| Token signing | `jose`, HS256 |
| Access token | Claims `{ sub, email, type: "access" }`, plus `iss`/`aud` = `studentos`, a `jti`, and **hardcoded `1h` expiry** |
| Refresh token | Claims `{ sub, type: "refresh" }`, `7d`. Persisted in the `RefreshToken` table, so rotation and server-side revocation are possible |
| Guard | `authenticate` / `authenticateOptional` in `src/modules/auth/middleware.ts`; attaches `currentUser` + `tokenPayload` |
| Transport | `Authorization: Bearer <token>` |
| Security headers | `helmet` |
| CORS | origins from `CORS_ORIGINS` (comma-separated, default `http://localhost:3000`), `credentials: true` |
| Body limit | 1 MB JSON / urlencoded |
| Password storage on web | `localStorage` — **not** httpOnly cookies |

**Two competing JWT implementations exist.** `src/lib/jwt.ts` is config-driven (access TTL from `config.jwtAccessExpiresInSeconds`, default 900 s) and is what `middleware.ts` verifies with. `src/modules/auth/routes.ts` defines its own local `signAccessToken` / `signRefreshToken` / `verifyToken`, and *those* are what actually mint tokens at register/login/refresh. Consequences: the real access-token TTL is **1 hour**, not the configured 15 minutes, and `config.jwtAccessExpiresInSeconds` is effectively dead. See gap #4.

---

## 9. AI architecture

`apps/api/src/modules/ai/` — `provider.ts`, `context.ts`, `service.ts`, `routes.ts`, `schema.ts`.

**Provider abstraction.** `AIProvider` = `{ name, isConfigured(), chat(ChatRequest) }`. `OpenAIProvider` calls `${OPENAI_BASE_URL ?? "https://api.openai.com"}/v1/chat/completions` with **plain `fetch` — no SDK** — at `temperature: 0.7`, so any OpenAI-compatible endpoint works. `createAIProvider()` switches on `AI_PROVIDER` (only `openai` implemented, and it is the default); `getAIProvider()` caches a process-lifetime singleton. Adding a provider means implementing the interface and adding one `case`.

**Grounding.** `studentContextBuilder.build(userId)` runs 7 bounded parallel queries and `toPrompt()` serializes them as `{"studentos": {...}}`, injected as a `system` message. Hard caps:

| Slice | Cap | Filter / order |
|---|---|---|
| courses | 30 | newest first |
| tasks | 30 | `status != COMPLETED`, soonest `dueDate` first |
| upcoming events | 20 | `startAt >= now`, soonest first |
| study sessions | 10 | most recent |
| active goals | 20 | `status = ACTIVE`, newest first |
| notes | 10 | recently updated |
| grades | 20 | most recently recorded |

**Service behaviour.** Conversations, messages and study plans are fully DB-backed and ownership-scoped (cross-user → 404). Posting a message with `generateReply: true` (default) stores it, builds context + recent history, calls the provider, and persists the assistant reply together with `contextSnapshot`. `generateReply: false` stores the message only and returns `reply: null`.

**Failure modes (deliberate, not bugs).**

| Condition | Result |
|---|---|
| No provider configured | 503 `AI_PROVIDER_NOT_CONFIGURED`; **no message persisted** |
| Provider returns non-2xx or empty | 502 `AI_PROVIDER_ERROR` |
| `AI_ENABLED=true` + provider `openai` + no `OPENAI_API_KEY` | `validateConfig()` **throws at boot** |

Both AI failure codes are produced by `ApiError` subclasses in `provider.ts` (`AiProviderNotConfiguredError` → 503, `AiProviderError` → 502), so `globalErrorHandler` maps them through the normal envelope. Do **not** reintroduce a plain-`Error` class here — that silently becomes a 500. `AI_PROVIDER_ERROR` is declared but currently only `AiProviderNotConfiguredError` is thrown; provider-level HTTP failures surface through the adapter's own result object instead.

**Credential-free providers.** `isCredentialFreeProvider()` in `ai-connections/schema.ts` marks `ollama` as needing no API key, because it runs locally. `credentials` is therefore *optional in the type* but required at runtime for every other provider — enforced in `superRefine` in both the Zod schema and the route validator. An ollama connection stores an encrypted empty string (the `credentialsEncrypted` column is non-nullable), and `parseProviderCredentials("")` returns `{}`.

| Env var | Default | Notes |
|---|---|---|
| `AI_ENABLED` | `true` (`!== "false"`) | test config forces `false` so no external call is ever made |
| `AI_PROVIDER` | `openai` | only value implemented |
| `AI_MODEL` | `gpt-4o-mini` | |
| `OPENAI_API_KEY` | — | required at boot when AI is enabled |
| `OPENAI_BASE_URL` | `https://api.openai.com` | for compatible endpoints |

The whole rest of the API stays fully functional when no provider is configured.

---

## 10. Ports & environment

| Service | Port | Binding |
|---|---|---|
| API | `3001` (`PORT`, default) | `0.0.0.0` (`HOST`, default) |
| Web | `3000` | `next dev -p 3000` |
| PostgreSQL | `5432` | dev DB `studentos`, test DB `studentos_test` |

| File | Purpose | Gitignored |
|---|---|---|
| `apps/api/.env` | API runtime config (loaded by `src/config/index.ts` via `process.loadEnvFile`, and parsed by `vitest.config.ts`) | yes |
| `apps/api/.env.example` | 4 documented keys: `DATABASE_URL`, `JWT_SECRET`, `PORT`, `HOST`, `NODE_ENV` | **yes — and that is a bug**: root `.gitignore` has a blanket `.env.example` rule, so this file is **not in the repository** even though the README tells you to copy it. See gap #22. |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL` | yes |
| `apps/web/.env.local.example` | `NEXT_PUBLIC_API_URL` only | yes |

Full key set: `NODE_ENV`, `PORT`, `HOST`, `DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN_SECONDS`, `JWT_REFRESH_EXPIRES_IN_SECONDS`, `COOKIE_DOMAIN`, `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_USE_PATH_STYLE`, `CORS_ORIGINS`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_SECONDS`, `UPLOAD_MAX_FILE_SIZE_BYTES`, `UPLOAD_ALLOWED_MIME_TYPES`, plus `ENCRYPTION_KEY` and `TEST_DATABASE_URL` (uncommitted, added by AI Connections).

Boot fails fast via `validateConfig()` if `DATABASE_URL` or `JWT_SECRET` are missing (see [§9](#9-ai-architecture) for the AI condition and the S3 pair rule). The checked-out local `.env` contains a placeholder `OPENAI_API_KEY=sk-local-placeholder`, which satisfies boot validation but will not produce real completions.

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
pnpm --filter @studentos/web lint         # next lint --dir src --dir tests
pnpm --filter @studentos/web test         # vitest run  (tests/**/*.test.ts)
```

Type-check only: `npx tsc --noEmit` in `apps/web`. There is no `typecheck` script.

### Local setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env          # NOTE: this example file is gitignored — see gap #22
cp apps/web/.env.local.example apps/web/.env.local
pnpm --filter @studentos/api db:push             # create the schema
pnpm --filter @studentos/api db:seed             # optional demo data
pnpm dev
```

---

## 12. Test & build status (verified 2026-09-28, after the Phase 2 close-out)

| Suite | Command | Result | Time |
|---|---|---|---|
| API | `pnpm --filter @studentos/api test` | **23 files, 261 tests — 0 fail** | ~48 s |
| Web | `pnpm --filter @studentos/web test` | **12 files, 77 tests, 0 failures** | ~40 s |
| API typecheck | `pnpm --filter @studentos/api exec tsc -p tsconfig.json --noEmit` | **pass** (exit 0) | ~8 s |
| API build | `pnpm --filter @studentos/api build` | **pass** — `dist/` emitted | ~8 s |
| Web typecheck | `pnpm --filter @studentos/web exec tsc --noEmit` | **pass** (exit 0) | ~20 s |
| Web build | `pnpm --filter @studentos/web build` | **pass** — 20 routes (19 static ○, `/courses/[id]` dynamic ƒ) | ~55 s |
| Lint | `pnpm --filter @studentos/web lint` | **pass** — "No ESLint warnings or errors" | ~5 s |
| Both | `pnpm build` | **pass** — 2/2 turbo tasks (API `tsc` + Web `next build`) | ~70 s |

**`pnpm test` at the root should now pass**, since the turbo `test` task dependsOn `build` and nothing is red any more. Per-package commands still give a faster, more specific signal.

**API tests need a live PostgreSQL.** They are integration tests against a real database, not mocks. `vitest.config.ts` resolves `DATABASE_URL = TEST_DATABASE_URL ?? postgresql://postgres@localhost:5432/studentos_test`, forces `NODE_ENV=test` and `AI_ENABLED=false`.

**Destructive and non-parallel-safe.** `tests/setup.ts` calls `cleanupDb()` in `beforeAll` for every file, and `cleanupDb()` issues `TRUNCATE TABLE ... CASCADE` over all tables. `fileParallelism: false` keeps files sequential within one run. **Two concurrent API test runs will deadlock** (PostgreSQL `40P01`, observed live during this verification) because both hold `ACCESS EXCLUSIVE` locks. Never run the API suite in parallel with another one, and point `TEST_DATABASE_URL` at a throwaway database.

Prisma `createMany` stamps all rows with a single `now()`, so tests that assert `createdAt` ordering must insert explicit timestamps.

### Test inventory

Both suites are **flat**, next to the app they test, never colocated with source.

**API** (`apps/api/tests/`, 23 files + `helpers.ts` + `setup.ts`): `academics`, `ai`, `ai-connections`, `auth`, `course-summary`, `courses`, `cross-user`, `dashboard`, `dashboard-command-center`, `events`, `goals`, `grades`, `health`, `integration`, `malformed-body`, `notes`, `notifications`, `resources`, `settings`, `study-sessions`, `subtasks`, `task-tags`, `tasks`.

**Web** (`apps/web/tests/`, 12 files + `setup.ts`): `academic-forms`, `ai-connections`, `app-shell`, `calendar-page`, `errors`, `exam-utils`, `format`, `labels`, `notification-utils`, `task-form`, `themes`, `utils`.

Test style: API uses supertest against the real `app` with helpers from `tests/helpers.ts` (`registerAndLogin`, `authRequestJson`, `authRequest`, `logout`). `authRequestJson`/`authRequest` are **overloaded** and accept two different call shapes; read the overloads before using them. Web tests are jsdom + Testing Library, setup in `apps/web/tests/setup.ts`, matched by the `tests/**/*.test.{ts,tsx}` glob in `apps/web/vitest.config.ts`.

---

## 13. Known gaps & issues

Ordered by how likely they are to bite you.

| # | Issue | Evidence |
|---|---|---|
| 1 | **Working tree is uncommitted.** A `git checkout`/clean would destroy in-flight work, including the whole AI Connections feature. | `git status` |
| 2 | **`openapi.yaml` is JSON, not YAML, and badly stale.** Despite the extension it is a JSON OpenAPI 3.1.1 doc covering only **12 paths** (auth, academic-years, semesters, courses, tasks). Missing notes, resources, events, study-sessions, goals, grades, notifications, settings, ai, ai-connections, subtasks, task-tags, `/courses/{id}/summary`, `/notifications/generate`, `/notifications/read-all`, and the `instructor` / `estimatedMinutes` / `completedAt` fields. It also documents cross-user access as `FORBIDDEN` while the code returns **404**. | `docs/api/openapi.yaml` |
| 3 | **`CurrentUser.role`, `.residency`, `.name` are always `undefined`.** The types and the middleware require them, but the access token only carries `{sub,email,type}` and the `User` model has no `role`/`residency` column. Only `id` and `email` are real. | `auth/routes.ts:25`, `auth/middleware.ts:31-55`, `prisma/schema.prisma` |
| 4 | **Duplicate JWT implementations with divergent TTLs.** `auth/routes.ts` hardcodes `1h`; `config.jwtAccessExpiresInSeconds` (default 900) is ignored on the real login path. `lib/jwt.ts` is a second, config-driven implementation used only for verification, and it skips issuer/audience checks. | `auth/routes.ts:17-55` vs `lib/jwt.ts` |
| 5 | **Rate limiting is configured but not implemented.** Env keys parse into `config`, no middleware is mounted. | `config/index.ts:66-67` vs `app.ts` |
| 6 | **Web stores tokens in `localStorage`**, not httpOnly cookies — any XSS yields a full session. Deliberate (survives reload) but worth knowing. | `apps/web/src/lib/api/auth-session.ts` |
| 7 | **S3 / `UPLOAD` resources not implemented.** The enum, the DB columns and the `S3_*` config exist, but `storageType: "UPLOAD"` on create/update returns 400 `UPLOAD_STORAGE_UNAVAILABLE`. URL resources only. | `prisma/schema.prisma`, `config/index.ts:51-57` |
| 8 | **Notification delivery is `IN_APP` only.** `PUSH`/`EMAIL`/`SMS`/`TELEGRAM` enum values exist but are unimplemented, and there is **no scheduler/job** — generation is client-triggered via `POST /notifications/generate`, fired once per browser session. | `prisma/schema.prisma`, `app-shell.tsx:266-282` |
| 9 | **Recurring tasks deferred to v1.1.** `TaskRecurrenceRule` / `RecurrenceFrequency` are commented out in the schema. | `prisma/schema.prisma:263-287` |
| 10 | **Dead pagination types.** `PaginationInput`/`PaginationOutput` (page/limit/total) in shared are unused; the real convention is cursor-based. | `packages/shared/src/schemas/api.ts:39-48` |
| 11 | **No CI.** There is no `.github/` directory at all; nothing runs on commit or PR. | repo root |
| 12 | **PARTIALLY RESOLVED 2026-09-27.** The npm `workspaces` array and the two stray lockfiles (`package-lock.json`, `apps/api/pnpm-lock.yaml` — the latter a 6-line empty stub) were removed. `pnpm-lock.yaml` is now the only lockfile and the root `start` script uses pnpm. | repo root |
| 13 | **Three archived docs are stale and contradict reality.** `docs/audits/qa-final-report.md` claims ~95% done and lists 166 API tests; `docs/audits/frontend-progress.md` claims 40 web tests, 10 pages, and — wrongly — that the project "is not a git repo"; `docs/audits/phase-2-ai-connections-audit.md` says no test file exists. All three are frozen snapshots, each carrying an "Archived historical snapshot" banner. This file is authoritative. | `docs/audits/` |
| 14 | **500 responses leak internals outside production** (`INTERNAL_ERROR_DEV` returns the raw error message). | `config/http.ts:125-131` |
| 15 | **PARTIALLY RESOLVED.** Baseline migration `prisma/migrations/20260926004652_baseline/` created; `prisma migrate resolve --applied` run against both `studentos` and `studentos_test`. A second migration `20260926010000_add_ai_connections` exists. `prisma migrate status` reports "Database schema is up to date!". **Caveat: both migrations record `applied_steps_count = 0`** — they were baselined with `resolve --applied`, so **neither has ever been executed**. A fresh `prisma migrate deploy` would have failed: `add_ai_connections` used `DATETIME` (SQLite syntax; PostgreSQL rejects it with `42704 type "datetime" does not exist`) and declared a phantom `active_at` column absent from the schema. Fixed 2026-09-28 — `DATETIME` → `TIMESTAMP(3)`, `active_at` removed; verified by replaying the file against a throwaway schema on `studentos_test`. **`prisma/migrations/migration_lock.toml` now sits at the migrations root** (Prisma's expected location); two stray per-migration copies were deleted. Still not verified: a full `migrate deploy` from empty, since both DBs already carry these names in `_prisma_migrations`. New developers with an empty database: seed schema via `db push`, then `prisma migrate resolve --applied 20260926004652_baseline`. | `apps/api/prisma/migrations/` |
| 16 | **API has no linter.** `tsc` under `strictNullChecks` is the only static gate; there is no ESLint config for `apps/api`. | `apps/api/package.json` |
| 17 | **RESOLVED 2026-09-27.** The dead `./types/*`, `./utils/*`, `./constants/*` export entries were removed from `packages/shared/package.json`; only `./schemas/*` remains, matching the single real source folder. | `packages/shared/package.json` |
| 18 | `zod-express@0.0.8` is unmaintained and wrapped by a local shim. Upgrading means replacing the shim, not the dependency. | `apps/api/src/lib/zod-validator-shim.ts` |
| 19 | **`authService.updateProfile` and `authService.changePassword` are implemented but unrouted.** `updateProfileSchema` and `changePasswordSchema` are defined and unused. There is no way to change a profile or password over HTTP. | `auth/routes.ts:141,163,202,212` vs the 5 registered routes at `auth/routes.ts:231-269` |
| 20 | **RESOLVED 2026-09-28 — Phase 2 is closed.** All 3 failures fixed. (a) **Ollama needs no key** — `credentials` is now optional in the type but required at runtime for every other provider, via `isCredentialFreeProvider()` in `ai-connections/schema.ts` plus a matching `superRefine` in the route validator; an ollama connection stores an encrypted empty string. (b) **`@@unique([userId, provider])` kept** — one connection per provider is the product rule, so the test now exercises "activating one deactivates the others" with two *different* providers (openai + anthropic) instead of two openai ones. (c) **`AiProviderNotConfiguredError` now extends `ApiError`** (503 `AI_PROVIDER_NOT_CONFIGURED`) instead of plain `Error`, so `globalErrorHandler` maps it instead of leaking a 500. A matching `AiProviderError` (502) was added alongside it. | `apps/api/src/modules/ai/provider.ts`, `apps/api/src/modules/ai-connections/{schema,routes,service}.ts`, `apps/api/tests/ai-connections.test.ts` |
| 21 | **3 of 12 `packages/shared` schemas are imported by nobody**: `academics.ts`, `auth.ts`, `course.ts`. The web app re-declares the same shapes locally in `features/courses/courses-api.ts`. Either wire them up or delete them — do not leave two sources of truth. | `packages/shared/src/schemas/` |
| 22 | **`.env.example` files are gitignored, so the documented setup cannot work from a fresh clone.** Root `.gitignore` has a blanket `.env.example` rule, but `README.md` says `cp apps/api/.env.example apps/api/.env`. Needs a `!.env.example` negation. | `.gitignore:10` |
| 23 | **`components/ui/checkbox.tsx`, `skeleton.tsx` and `tabs.tsx` are unused.** Left in place deliberately — they are part of a uniform 17-file Radix primitive set, and pruning them would break the pattern. | `apps/web/src/components/ui/` |
| 24 | **The local `.env` pointed at a PostgreSQL role that did not exist** (`elyassql`; only `postgres` exists on this machine), so all 23 API suites failed in `beforeAll` with `PrismaClientInitializationError` and **0 tests actually ran** — 261 reported as "skipped". Fixed 2026-09-28 by switching both URLs to the `postgres` role. Worth knowing because a green-looking run of *nothing* is the failure mode: if the whole suite reports skipped, suspect the database credentials before anything else. | `apps/api/.env` |
| 25 | **The dev database `studentos` has no `ai_connections` table** — verified 2026-09-28: `prisma.aiConnection.count()` fails with `P2021` (table does not exist) and `information_schema` lists no such table. `studentos_test` does have it (10 columns, no `active_at`), which is why the API suite is green. The dev DB was seeded with `db push` at a point before the model existed. The migration is marked applied in both DBs but never ran (gap #15), so nothing reconciles them. **The AI Connections UI will error against the dev database until `db push` or `migrate deploy` is run against `studentos`.** | `apps/api/.env` vs `prisma/schema.prisma` |

---

## 14. Development conventions

### API

- One folder per domain: `src/modules/<domain>/{routes,service,schema}.ts`. Add a domain by creating the folder and mounting it in `src/routes/index.ts`. Do not add a barrel `index.ts` to a module — no module has one.
- `routes.ts` owns HTTP concerns only: `zValidator` wiring, `authenticate`, status codes, envelope. No Prisma.
- `service.ts` owns data access. **Every query filters by `userId`.** This is what makes cross-user access 404 instead of 403 — do not add unscoped `findUnique`/`findFirst` on user-owned models.
- Response mapping happens in the service via a `map<Entity>` function; keep Prisma shapes (`Date` objects, nulls) out of the wire format.
- Throw typed errors from `src/config/errors.ts` (`notFoundError`, `conflictError`, `validationError`, …) rather than raw `Error`.
- Import the auth guard from `@/modules/auth/routes` (all 17 route files do); it re-exports the implementation from `auth/middleware.ts`.
- Tests live in `apps/api/tests/<domain>.test.ts`, flat, never next to source. Shared helpers are `tests/helpers.ts` and `tests/setup.ts`.
- Comments use `// ─────` section banners. The codebase is heavily commented; match that.

### Web

- **Never call `fetch` directly.** Use `api.get/post/patch/delete` from `src/lib/api/client.ts`.
- One feature folder per domain: `features/<domain>/{*-api.ts (transport), hooks.ts (TanStack Query), *-form.tsx (react-hook-form)}`.
- Shared DTO types live in `src/types/api-types.ts` and are imported as `@/types/api-types` from every layer. Domain-only types stay next to their feature.
- **Tests live in `apps/web/tests/*.test.ts`, flat — not colocated with source.** The `tests/**/*.test.{ts,tsx}` glob in `apps/web/vitest.config.ts` is the only place they are discovered, and the lint script is `next lint --dir src --dir tests` so they stay covered.
- UI primitives go in `src/components/ui/` (Radix + CVA); domain composites in `src/components/domain/`. Pages compose these; they do not define new primitives inline.
- Use `cn()` from `@/lib/utils` for conditional classes; use theme CSS variables, not raw hex, in components.
- Add a nav entry in `app-shell.tsx` `NAV_ITEMS` if the page is primary; `MOBILE_NAV_HREFS` is a separate 5-item allowlist, so reordering `NAV_ITEMS` alone will not change the mobile bar.

### Shared

- Zod schemas and cross-app types live in `packages/shared/src/schemas/`, imported as `@studentos/shared/schemas/<name>`. That is the only exported subpath.
- Move code here **only** if both the API and the web app genuinely consume it. Do not park backend-only or frontend-only code in the shared package.
- Keep `zod` declared in `packages/shared/package.json` — removing it previously broke the API build.

### TypeScript

- API: `strictNullChecks` only (`apps/api/tsconfig.json`), `@/*` → `src/*`, ESM, `moduleResolution: "Bundler"`, `include: ["src/**/*.ts"]` — so `tests/` is **not** covered by the build's typecheck.
- Web: full `strict`, `@/*` → `src/*`, bundler resolution, `noEmit`, `include: ["**/*.ts", "**/*.tsx"]` — so `tests/` **is** typechecked by `next build`.
- Both apps use the `@/` alias; the API mirrors it in `vitest.config.ts`, the web app in `apps/web/vitest.config.ts`.

---

## 15. Git & workflow expectations

- Branch: `main`. History is only two commits, so there is no branching convention to infer — **establish one rather than assume it.** Feature branches for anything non-trivial.
- Commit style in history: Conventional Commits (`chore:`, and an `Initial commit:` for the root). Keep using `type: summary`.
- The `test` turbo task declares explicit `inputs` (`apps/api/{src,tests,prisma}/**`, `apps/web/{src,tests}/**`, `package.json`, `pnpm-lock.yaml`). Web changes now invalidate the cache too, but still do not trust a cached turbo result as verification — run the per-package commands when you need certainty.
- Keep the tree green before handing off: `pnpm --filter @studentos/api test`, `pnpm --filter @studentos/web test`, `pnpm --filter @studentos/web build`, `pnpm lint`.
- Update this file in the same change as any behaviour it describes. A stale `AI_CONTEXT.md` is worse than none — it is the first thing every agent reads.

---

## 16. Next planned work

There is **no roadmap file in the repository**, so this is inferred from the uncommitted working tree, not from a plan document:

**Phase 1 (Database Foundation) is complete as of 2026-09-26** — Prisma migration history established, both dev and test databases verified, development seed run, test isolation confirmed.

**Phase 2 is complete as of 2026-09-28** — AI Connections is implemented end to end (API module, encrypted credential storage, per-user provider resolution, the Settings-page UI) and the whole suite is green. The repository structure was standardized 2026-09-27 (see [§17](#17-latest-ai-work--change-log)). Phase 3 (Integration QA) has **not** been started.

1. **Finish and commit the in-flight work** — the Academics, Exams, Notifications and Resources screens, the dashboard command center, `GET /courses/:id/summary`, AI Connections, and the new tests. All still uncommitted. Nothing is committed since `a07ae08`.
2. **Run Phase 3 (Integration QA).** Everything green here is a per-package signal against a local database; nothing exercises the two apps talking to each other in a browser, and there is no CI (gap #11).
3. **Regenerate the OpenAPI spec** (`docs/api/openapi.yaml`) so it covers the real surface, is actually YAML (or is renamed `.json`), and documents 404-not-403 ownership masking. It does not list `/ai-connections/*` at all.
4. **Resolve the auth inconsistencies** — collapse the duplicate JWT helpers onto the config-driven one, and either add `role`/`residency` to `User` or drop them from `CurrentUser`.
5. **Implement or remove the parked features** — rate limiting, S3 uploads, notification delivery/notification scheduler, recurring tasks.
6. **Add CI**, and fix the `.env.example` gitignore rule so a fresh clone can follow the README (gap #22).
7. Decide the fate of the 3 unreferenced shared schemas (gap #21), and of `resolveUserConnection` — it is unreferenced and returns a **masked** credential string, so it cannot be used to actually call a provider. `getActiveUserConnection` is the real one.
8. `AiProviderError` (502) is declared but never thrown — either wire provider HTTP failures to it or drop it.

---

## 17. Latest AI work / change log

### 2026-09-28 — Phase 2 closed out. 3 test failures fixed + the AI Connections settings UI.

**Environment**
- `apps/api/.env` pointed at a PostgreSQL role `elyassql` that does not exist on this machine (only `postgres` does). Every API suite failed in `beforeAll`, so 261 tests reported as **skipped** and 0 actually ran. Both URLs now use the `postgres` role. New gap #24 records the failure mode.

**Contract decisions (both were previously undecided; see gap #20)**
- *Ollama needs no key.* `credentials` became optional in the type and is required at runtime for every other provider. `isCredentialFreeProvider()` + `CREDENTIAL_FREE_PROVIDERS` live in `ai-connections/schema.ts`; the same rule is restated in `superRefine` in `CreateAiConnectionSchema`, `TestConnectionInputSchema` **and** the shared `createBodySchema` route validator, so a bad request is rejected at the edge with the usual 400 either way. `createConnection` stores an encrypted empty string because `credentialsEncrypted` is non-nullable; `parseProviderCredentials("")` already returns `{}`.
- *One connection per provider is intended.* `@@unique([userId, provider])` stays. The "activates only one connection at a time" test now builds its two fixtures from **different** providers (openai + anthropic), which still proves that activating one deactivates the other.

**Bug fix**
- `AiProviderNotConfiguredError` extended plain `Error`, so the documented 503 fell through `globalErrorHandler` as a 500 `INTERNAL_ERROR_DEV`. It now extends `ApiError` (503 `AI_PROVIDER_NOT_CONFIGURED`), and a sibling `AiProviderError` (502 `AI_PROVIDER_ERROR`) was added so provider failures are also controlled rather than 500s.

**New — frontend AI Connections (the last unimplemented Phase 2 item)**
- `features/ai-connections/ai-connections-api.ts` — transport only, via `api.*`.
- `features/ai-connections/hooks.ts` — TanStack Query hooks under the `["ai-connections"]` key.
- `features/ai-connections/connection-form.tsx` — create/edit dialog. Exports `connectionFormSchema` so it can be unit-tested without rendering, matching the `academic-forms` precedent. Sends a bare key string, which the API's `parseProviderCredentials` already accepts as the key itself.
- `features/ai-connections/connection-list.tsx` — `AiConnectionsPanel`, the rows plus enable/activate/edit/delete.
- `AiConnection`/`AiConnectionTestResult`/`AiProviderName` added to `src/types/api-types.ts`; `AI_PROVIDER_LABELS`, `CREDENTIAL_FREE_PROVIDERS`, `ENDPOINT_REQUIRED_PROVIDERS` added to `src/lib/labels.ts`.
- `AiConnectionsPanel` is a **section on `/settings`**, not a nav item and not a separate page.
- Keys are write-only by design: the API never returns them, so the edit form leaves the field blank and `toPayload` omits an empty `credentials` to preserve the stored key.

**Tests**
- `apps/web/tests/ai-connections.test.ts` — 9 new tests over the provider-label helpers and `connectionFormSchema` (per-provider key requirement, ollama without a key, endpoint requirement for ollama/custom, blank-as-absent).
- `tests/ai-connections.test.ts` — the activate test's fixtures changed to two providers. No assertions were weakened.

Verification (see §12 for the full table)
- API **261/261**, web **77/77**, `tsc` clean in both apps, `pnpm build` 2/2, `next lint` clean.

### 2026-09-27 — Structure cleanup (Phase 2 → pre-Phase-3). No behaviour changed.

Moved
- `apps/web/src/features/api-types.ts` → `apps/web/src/types/api-types.ts`; 55 import sites rewritten `@/features/api-types` → `@/types/api-types`.
- 11 colocated web tests + `src/test/setup.ts` → flat `apps/web/tests/`; `vitest.config.ts` `include`/`setupFiles` and the `lint` script updated.
- `apps/api/verify_phase1.sh` → `scripts/verify-prisma-baseline.sh` (absolute machine path replaced with a script-relative one).
- `QA_FINAL_REPORT.md`, `apps/web/FRONTEND_PROGRESS.md`, `Phase2-Audit.md` → `docs/audits/`; `apps/api/openapi.yaml` → `docs/api/`. Each archived doc got a one-line "Archived historical snapshot" banner.

Deleted (each proven unreferenced or duplicated — see §13 for the full audit trail)
- `apps/api/src/types/semesters.ts` — zero importers; duplicated types already derived from Zod.
- `apps/api/src/modules/academics/schema.ts` — 113-line duplicate Zod layer; the real validation is in `academic-years/schema.ts` and `semesters/schema.ts`. Its two live type exports moved into `academic-years/schema.ts`.
- `apps/api/src/modules/ai-connections/index.ts` — orphan barrel; no other module has one, nothing imported it.
- `apps/web/src/components/domain/goal-card.tsx` — orphan duplicate of `features/goals/goal-card.tsx`, which is what the goals page actually renders.
- `apps/web/src/components/domain/event-card.tsx` — orphan; the calendar and exams pages render event markup inline.
- `package-lock.json` and `apps/api/pnpm-lock.yaml` (a 6-line empty stub) — `pnpm-lock.yaml` is the only lockfile.
- 11 empty directories: `apps/mobile/`, `packages/config/`, `packages/ui/`, `packages/shared/src/{types,utils,constants}/`, `docs/{architecture,database,decisions,product}/`, `.github/`.

Config
- `package.json`: removed the npm `workspaces` array (duplicate of `pnpm-workspace.yaml`); `start` now uses pnpm.
- `packages/shared/package.json`: dropped the three dead export subpaths.
- `turbo.json`: `test.inputs` now covers `apps/web/{src,tests}/**`.
- `apps/web/package.json`: `lint` is `next lint --dir src --dir tests` so the relocated tests stay linted.
- `apps/api/src/modules/ai-connections/routes.ts`: auth import aligned with the other 16 route files.

Deliberately **not** done
- No new `src/middleware/`, `src/utils/`, `src/types/`, `features/hooks/` or `schemas/` folder — nothing warranted them.
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

- **Product roadmap / phase definitions.** "Phase 1/2/3" appear only in `INSTRUCTIONS_FOR_AGENT.md` and the archived `docs/audits/qa-final-report.md` prose. There is no authoritative phase document; `docs/` now holds only the archived audits and the stale spec. The phase labels in this file are inferred from the code, not quoted from a spec.
- **Deployment / infrastructure.** No Dockerfiles, no compose files, no CI config, no hosting config. How this is intended to be deployed and run in production is undocumented.
- **Intended mobile client.** The OpenAPI description mentions "web and mobile clients", but only a web client exists in this monorepo. No mobile code, no API versioning/deprecation policy.
- **Seed credentials beyond the demo user.** `prisma/seed.ts` creates `demo@studentos.dev` with password `StudentPass123!` (Alex Rivera) and at least one further user (Bob), but the full seeded roster and its credentials were not enumerated.
- **Database contents of the local dev database** (`studentos` on port 5432) and whether the local PostgreSQL instance is meant to be shared or per-developer.
- **Whether the AI provider was ever exercised against a real endpoint.** All local config uses a placeholder key; AI tests force `AI_ENABLED=false`, so no live completion has been verified in this environment.
