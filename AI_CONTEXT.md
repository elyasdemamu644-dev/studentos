# AI_CONTEXT — StudentOS source of truth

> **Snapshot:** 2026-10-10, after the Final AI Integration (capstone completion). Every claim below was read from code or produced by running a command in this repo. Anything not verifiable is listed in [Unverified](#unverified).
> **Scope:** this file is the onboarding document for AI agents. Human setup lives in [README.md](README.md); agent workflow rules live in [INSTRUCTIONS_FOR_AGENT.md](INSTRUCTIONS_FOR_AGENT.md).
> **Latest AI work:** Final StudentOS AI Integration — all eight completion criteria satisfied: enriched StudentContext (currentSemester, courseId on all entities, estimatedMinutes, endAt/location, semesterId/credits, weight), dual-path context delivery (tool-path + grounded-path), conflict-aware `build_study_plan`, two-gate confirmation with post-write verification, provider timeout/error handling (504/502/503), frontend courseId/semesterId handoff, 568 API + 260 web tests passing, eight acceptance scenarios verified. See [§17 Change log](#17-latest-ai-work--change-log).

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
| Change file upload / download | `frontend/features/resources/resources-api.ts`, `frontend/features/resources/hooks.ts` | `frontend/lib/api/client.ts` (`api.upload`/`api.download`), `frontend/features/resources/{material-upload,course-materials}.tsx`, `src/{routes,services}/resources.ts` |
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
| Working tree | **Uncommitted (intentionally).** `18b4f3a` (the folder migration) is the last commit; everything since is uncommitted. `git status --short` currently shows **47 modified** and **19 untracked** files spanning several recorded workstreams (AI Assistant fixes, frontend product upgrade, file uploads, email, Google OAuth, AI structured extraction, token security, AI Chat Phase 1 — see §17) plus this session's course-materials work. Untracked includes backend services/utils without a home in the commit (`ai/structured.ts`, `email.ts`, `email-templates.ts`, `google-oauth.ts`, `storage.ts`, `utils/file-validation.ts`, `utils/multipart.ts`) and their tests, and the new web files `features/resources/{course-materials,material-upload}.tsx` + `tests/{api-client-multipart,course-materials,ai-chat-flow}` fixtures. Nothing pushed. |
| Tests | API **560/560 pass** (38 files) — 0 failures, re-verified 2026-10-10 after the AI Chat Phase 1 work (§17). Web **260/260 pass** (22 files), re-verified 2026-10-10 after the AI Chat Phase 1 Markdown work (§17). |
| Builds | `tsc` (API) **passes**; `next build` (Web) **passes**, 19 routes. Web re-verified 2026-10-10. |
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
│   └── tests/                    <- 38 *.test.ts + helpers.ts + setup.ts (flat, 40 files)
├── frontend/                     <- @studentos/web  (Next.js 14 App Router)
│   ├── app/  components/  features/  lib/  types/
│   └── tests/                    <- 22 *.test.ts/tsx + setup.ts (flat, 23 files)
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
| resources | `GET/POST /resources`, `GET/PATCH/DELETE /resources/:id`, `POST /resources/upload` (multipart), `GET /resources/:id/download` (raw file bytes) |
| events | `GET/POST /events`, `GET/PATCH/DELETE /events/:id`; filters `courseId`, `type`, date range |
| study sessions | `GET/POST /study-sessions`, `GET/PATCH/DELETE /study-sessions/:id`, `POST /study-sessions/:id/complete`; list returns a `summary` (count + total minutes) |
| goals | `GET/POST /goals`, `GET/PATCH/DELETE /goals/:id`; `GET/POST /goals/:goalId/milestones`, `PATCH/DELETE /goals/:goalId/milestones/:id` |
| grades | `GET/POST /grades`, `GET/PATCH/DELETE /grades/:id` (`score` ≤ `maxScore` enforced) |
| notifications | `GET /notifications` (newest first + `unreadCount`), `GET /notifications/:id`, `POST /notifications/:id/read`, `PATCH /notifications/:id`, `POST /notifications/read-all`, `POST /notifications/generate` |
| settings | `GET /settings`, `PATCH /settings` (upsert; `null` value deletes a key; **strings only**) |
| ai | `GET/POST /ai/conversations`, `GET/DELETE /ai/conversations/:id`, `GET/POST /ai/conversations/:id/messages`, `GET/POST /ai/study-plans`, `GET/PATCH/DELETE /ai/study-plans/:id`, `GET /ai/study-plans/:id/entries`, `PATCH /ai/study-plans/:id/entries/:entryId`, `POST /ai/structured` (schema-validated JSON extraction, read-only) |
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
              layout/app-shell.tsx  page-header.tsx  panel.tsx  states.tsx  feedback.tsx  theme-toggle.tsx
              error-boundary.tsx
types/    api-types.ts   <- shared frontend DTO types, imported by 55 files across all layers
tests/         22 *.test.ts/tsx + setup.ts   (NOT colocated — see §12)
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
| AI chat rendering | `components/domain/ai-chat.tsx` renders assistant replies through the hand-rolled Markdown parser in `features/ai/chat-utils.ts` (no Markdown dependency) — headings, blockquotes, fenced code, bullet/numbered lists, and tables (honouring `:---` alignment), plus inline bold/italic/code/links. Link targets pass `safeHref()` first (only `http:`/`https:`/`mailto:` survive; anything else renders as plain text) and open with `rel="noopener noreferrer"`. No `dangerouslySetInnerHTML`. 2026-10-10 |
| Theme | `ThemeProvider` (own implementation, not `next-themes`): 8 presets, 11 accents, light/dark/system, driven by a `data-theme` attribute. Bootstrap script prevents flash. |
| Notifications (UI) | `sonner` via `Toaster` in `providers.tsx`; `NotificationBell` in the header; `NotificationBootstrap` calls `POST /notifications/generate` **once per browser session** after sign-in (guarded by `sessionStorage`). |
| Rendering | Pages are server-rendered shells around client data. `next build` prerenders 19 routes statically; `/courses/[id]` is dynamic (ƒ). |

Navigation (`app-shell.tsx`): 12 sidebar items — Dashboard, Courses, Academics, Tasks, Calendar, Exams, Notes, Resources, Study, Goals, Analytics, AI Assistant — plus Settings in the sidebar footer. Mobile bottom bar shows 5: Dashboard, Tasks, Courses, Study, Exams. `/notifications` has **no** nav entry; it is reached via the bell.

**Shared UI kit (2026-10-08 visual upgrade).** Every page is composed from the same primitives, all styled with `hsl(var(--token))` theme values — never hardcoded colours:

| Primitive | Where | Role |
| --- | --- | --- |
| `Panel` + `Chip` | `components/panel.tsx` | The section shell every page uses: `IconChip` + title + optional `actions` + optional `href`/`linkLabel` + collapse control (`aria-expanded`/`aria-controls`). Panels stretch to fill equal-height grid rows; a **collapsed** panel sets `self-start` so it hugs its header instead of stretching into an empty box. `Chip` is the outline pill; tones are **static** class strings (`primary/success/warning/danger/neutral`) because Tailwind cannot see template-literal classes. |
| `PageHeader` | `components/page-header.tsx` | `variant="hero"` (default): gradient surface, blur blob, kicker/title/description, `chips` (stat pills) and actions. `variant="plain"` for prose/workspace screens. All app pages use hero + per-page stat chips. |
| Cards | `components/domain/` | `StatCard`, `TaskCard` (checkbox, overdue rail, course swatch), `CourseCard` (square swatch, hover lift), `CourseSwatch` (id-derived hue), `PriorityBadge`. |
| States | `feedback.tsx`, `states.tsx` | `EmptyState`, `GridSkeleton`, `ListSkeleton`, `PanelSkeleton`, `ErrorState`, `ErrorAlert`. |
| Workspace | `components/ui/surface.tsx` | `Surface`, `SectionCard`, `WorkspacePanel` — workspace layouts (AI) and settings-style blocks; new pages should prefer `Panel`. |

Chart colours come only from `lib/theme/chart-theme.ts` (`CHART_SERIES`, `chartGridStyle`, `chartAxisStyle`, `chartTooltipStyle`, `barRadius`); `var()` does not resolve in SVG presentation attributes — use `style` objects/classes.

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

Notable column-level facts: `Task.estimatedMinutes` + `Task.completedAt`; `Course.instructor`; `StudySession.durationMinutes` (stored, not derived at read); `Resource` carries both URL fields and the file fields (`fileKey`/`fileName`/`fileSize`/`mimeType`) — an `UPLOAD` resource has `url: null` and populates the file columns (`storageType: UPLOAD`); `AiMessage.contextSnapshot` stores the JSON context actually sent to the model.

`TaskRecurrenceRule` and `RecurrenceFrequency` are **commented out** in the schema — recurring tasks are deferred to v1.1.

`User` has **no `role` and no `residency` column** (see gap #3).

Seed: `backend/prisma/seed.ts` (`pnpm --filter @studentos/api db:seed`). It `deleteMany`s all 21 tables in FK order, then creates `demo@studentos.dev` plus `createMany` sample data. **It is destructive.** There is no root-level `db:seed` script.

---

## 8. Authentication & security

| Concern | Implementation |
| --- | --- |
| Password hashing | `@node-rs/argon2` (`hashPassword` / `verifyPassword` in `src/routes/auth.ts`) |
| Token signing | `jose`, HS256 |
| Access token | Claims `{ sub, email, type: "access" }`, plus `iss`/`aud` = `studentos`, a `jti`, and expiry from `JWT_ACCESS_EXPIRES_IN_SECONDS` (default 900 s) |
| Refresh token | Claims `{ sub, type: "refresh" }`, `7d`. Persisted in the `RefreshToken` table, so rotation and server-side revocation are possible |
| Guard | `authenticate` / `authenticateOptional` in `src/middlewares/auth.ts`; attaches `currentUser` + `tokenPayload`, and accepts **only** `type: "access"` tokens (a refresh token as a Bearer credential is a 401, 2026-10-09) |
| Google sign-in | `POST /auth/google` verifies a Google OIDC `id_token` server-side (JWKS, RS256, iss/aud/`email_verified`); account linking is **case-insensitive by email**, since registration stores the address as typed |
| File uploads | `POST /resources/upload` (multipart) only — a JSON create with `storageType: "UPLOAD"` is rejected so a client cannot invent a `fileKey`/`fileSize`. Size cap from `UPLOAD_MAX_FILE_SIZE_BYTES` (stream-enforced); MIME type **sniffed from the content** (magic bytes), never trusted from the client, against `UPLOAD_ALLOWED_MIME_TYPES`; filename validated (no path separators/`..`/control chars) and the stored key is `resources/{userId}/{uuid}/{name}` under a root-contained provider (local disk or S3). Download (`GET /resources/:id/download`) and delete are owner-scoped like every other resource; a failed DB write rolls the stored object back, and delete removes storage first so it cannot orphan a file. 2026-10-09 |
| Transport | `Authorization: Bearer <token>` |
| Security headers | `helmet` |
| CORS | origins from `CORS_ORIGINS` (comma-separated, default `http://localhost:3000`), `credentials: true` |
| Body limit | 1 MB JSON / urlencoded |
| Password storage on web | `localStorage` — **not** httpOnly cookies |

**One JWT implementation.** `src/utils/jwt.ts` is the only place tokens are minted or verified: `signAccessToken` / `signRefreshToken` / `verifyJwt`, all driven by `config.jwtAccessExpiresInSeconds` (default 900 s) and `config.jwtRefreshExpiresInSeconds` (default 604800 s), with `iss` / `aud` (`"studentos"`) enforced on verify and a `type` claim distinguishing access from refresh. `auth/routes.ts` and `auth/middleware.ts` both import it. Refresh also checks the stored `RefreshToken.expiresAt` row, not just the JWT, so a lapsed or revoked session cannot be renewed. The guard enforces the `type` claim too: a validly-signed *refresh* token (same key, so a valid JWT) presented as `Bearer` now answers 401 `AUTH_INVALID_TOKEN` — before 2026-10-09 it authenticated the request. The 2026-10-09 review also pinned the full forgery surface in `tests/token-security.test.ts` (wrong key, `alg: none`, wrong iss/aud, tampered payload, missing `type`, expired access → `AUTH_TOKEN_EXPIRED`, refresh rotation/reuse/revocation). Access tokens carry only `{ sub, email, type, iat, exp }` — no `role`, `residency` or `name` (see gap #3).

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

**58 tools: 21 READ, 8 ANALYZE, 29 WRITE** (28 mutations + `confirm_pending_actions`).

| Kind | Tools |
| --- | --- |
| READ (21) | `get_courses`, `get_active_courses`, `get_tasks`, `get_upcoming_tasks`, `get_overdue_tasks`, `get_calendar_events`, `get_upcoming_exams`, `get_study_sessions`, `get_study_history`, `get_goals_and_milestones`, `get_goal_milestones`, `get_grades`, `get_notes`, `get_note`, `search_notes`, `get_task_subtasks`, `get_task_tags`, `get_resources`, `get_academic_structure`, `get_notifications`, `get_academic_dashboard` |
| ANALYZE (8) | `analyze_academic_progress`, `identify_weak_courses`, `identify_at_risk_work`, `analyze_study_consistency`, `calculate_workload`, `identify_upcoming_priorities`, `build_study_plan`, `push_daily_agenda` |
| WRITE (29) | `create_task`, `update_task`, `complete_task`, `create_subtask`, `update_subtask`, `create_task_tag`, `create_study_session`, `update_study_session`, `delete_study_session`, `create_goal`, `update_goal_progress`, `create_milestone`, `update_milestone`, `create_note`, `update_note`, `delete_note`, `create_resource`, `update_resource`, `create_event`, `update_event`, `create_grade`, `update_grade`, `create_course`, `update_course`, `delete_task`, `create_study_plan`, `add_study_plan_entry`, `bulk_update_task_status`, `confirm_pending_actions` |

Every write is still bounded and confirmed: one record, or one explicit list of ids, gated by the confirmation store and re-read by a verifier. The read/analysis tools live in `read-tools.ts` / `analyze-tools.ts`, and the creates and updates (including `create_course`) in `action-tools.ts`. The later additions live in `missing-tools.ts`: the three deletes (`delete_task`, `delete_note`, `delete_study_session`), the study-plan writers (`create_study_plan`, `add_study_plan_entry`), and the bounded `bulk_update_task_status`. There is still **no free-form/arbitrary-field update tool and no unbounded bulk delete**; every bulk operation takes a bounded id list.

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

`tools/verify.ts` re-reads every changed record **through the same domain service that wrote it** and compares the fields the student approved. `ok && verified` is the only state the assistant may call a success; an action that returned `ok` but did not match on re-read is reported as unverified, with the mismatch named. Every confirmable WRITE tool has a verifier, a test asserts every argument such a tool can change is re-read by it, and a tool whose whole purpose is an outcome (`complete_task`) asserts that outcome directly. The one exception is `confirm_pending_actions` itself: it is the approval mechanism, so it owns no verifier of its own — it runs each approved action back through these same verifiers. Timestamps compare the **exact instant** when the approval carried a time, and the **day** when it was date-only (the tool normalises a bare date to 09:00 local).

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

Resolution order: the student's active personal AI connection (encrypted at rest) → the environment default → 503 `AI_PROVIDER_NOT_CONFIGURED`. If the active connection exists but its stored credentials cannot be decrypted (typically because `ENCRYPTION_KEY` changed after they were saved), resolution **stops** with 409 `AI_CONNECTION_UNREADABLE`; it deliberately does **not** fall through to a different provider, because the student explicitly chose that connection.

**Grounding snapshot** (`context.ts`, used only on the no-tools path) runs bounded parallel queries: courses 30, tasks 30 (`status != COMPLETED`, soonest due first), upcoming events 20, study sessions 10, active goals 20, notes 10, grades 20. `toPrompt()` serializes them as `{"studentos": {...}}` as a `system` message.

**Service behaviour.** Conversations, messages and study plans are fully DB-backed and ownership-scoped (cross-user → 404). Posting a message with `generateReply: true` (default) stores it, runs the agent, and persists the assistant reply with `reply.toolActivity` / `reply.agent` alongside `contextSnapshot`. `generateReply: false` stores the message only and returns `reply: null`.

**Structured extraction (`POST /ai/structured`).** A separate, read-only path (`service.ts` `structured()` → `services/ai/structured.ts` `extractStructured`) that reuses the grounded no-tools pipeline: resolves the provider (active connection → env default → 503), builds the context snapshot via `studentContextBuilder.toPrompt()` when `ground: true` (default), and returns only output that validates against the JSON Schema the client supplied. The schema is converted to a Zod validator by `jsonSchemaToZod()` in `tools/json-schema.ts` (depth cap `MAX_SCHEMA_DEPTH = 6`); object schemas strip unknown keys like the tool layer, `anyOf: [X, { "type": "null" }]` collapses to `.nullable()`, and string-only enums become `z.enum`. The meta-schema (`structuredFieldSchema` in `schemas/ai.ts`, recursive `z.lazy().strict()`) admits only `type`/`description`/`properties`/`required`/`items`/`enum`/`anyOf`/`additionalProperties: false` — `$ref`, `oneOf`, `pattern`, `format` etc. are rejected with 400. The model's text is parsed (markdown fences tolerated) and validated; a non-conforming reply triggers **one** corrective retry that re-sends the task, the bad reply and a repair instruction; still no match → 502 `AI_STRUCTURED_OUTPUT_INVALID`. Raw model text never reaches the client. Runs no tools, writes nothing, and never enters confirmation machinery.

**Request timeout.** Every provider HTTP call goes through `fetchWithTimeout()` (`provider.ts`), which aborts a stalled request after `AI_REQUEST_TIMEOUT_MS` (default **60000 ms**, `config.aiRequestTimeoutMs`) and throws `AiProviderTimeoutError` — a controlled **504 `AI_PROVIDER_TIMEOUT`** mirroring `EmailTimeoutError`. `chat()` and `chatWithTools()` re-throw it (exempt from the 502 redaction), so `POST /ai/conversations/{id}/messages` and `POST /ai/structured` can answer 504. The connection-test endpoints do **not**: each adapter's `testConnection` catches the abort and returns `200 { success: false }`, matching their existing contract. Added 2026-10-10.

**Failure modes (deliberate, not bugs).**

| Condition | Result |
| --- | --- |
| No provider configured | 503 `AI_PROVIDER_NOT_CONFIGURED`; **no message persisted** |
| Provider returns non-2xx or empty | 502 `AI_PROVIDER_ERROR` |
| Active connection exists but its credentials cannot be decrypted (`ENCRYPTION_KEY` changed) | 409 `AI_CONNECTION_UNREADABLE` with an actionable message ("re-enter its credentials in Settings"); **no message persisted**, **no fallback** to another provider |
| Provider stalls past `AI_REQUEST_TIMEOUT_MS` | 504 `AI_PROVIDER_TIMEOUT` (retryable); **no reply persisted** on the chat path |
| `AI_ENABLED=true` + provider `openai` + no `OPENAI_API_KEY` | `validateConfig()` **throws at boot** |
| Ambiguous / missing reference | Tool failure (`ambiguous` / `not_found`) with candidate details; the model asks |
| Model exceeds a limit | Turn is truncated or the call is refused; the student is told in plain language |

The AI failure codes (`AI_PROVIDER_NOT_CONFIGURED`, `AI_PROVIDER_ERROR`, `AI_STRUCTURED_OUTPUT_INVALID`, `AI_CONNECTION_UNREADABLE`) are produced by `ApiError` subclasses in `provider.ts`, so `globalErrorHandler` maps them through the normal envelope. Do **not** reintroduce a plain `Error` class there — that silently becomes a 500. A decryption/auth failure is signalled by `CredentialDecryptionError` (`utils/encryption.ts`), which `getActiveUserConnection` catches and converts; any other failure (e.g. `parseProviderCredentials` or a DB error) propagates unchanged.

**Credential-free providers.** `isCredentialFreeProvider()` in `ai-connections/schema.ts` marks `ollama` as needing no API key. `credentials` is *optional in the type* but required at runtime for every other provider — enforced in `superRefine` in both the Zod schema and the route validator. An ollama connection stores an encrypted empty string (`credentialsEncrypted` is non-nullable), and `parseProviderCredentials("")` returns `{}`.

| Env var | Default | Notes |
| --- | --- | --- |
| `AI_ENABLED` | `true` (`!== "false"`) | test config forces `false` so no external call is ever made |
| `AI_PROVIDER` | `openai` | all six values implemented; see 9.6 |
| `AI_MODEL` | `gpt-4o-mini` | |
| `AI_BASE_URL` | — | base URL of the environment-default provider |
| `AI_REQUEST_TIMEOUT_MS` | `60000` | Hard per-request deadline for every provider call; a stall aborts to 504 `AI_PROVIDER_TIMEOUT` (added 2026-10-10) |
| `AI_AGENT_MAX_TOOL_ROUNDS` | `4` | clamped to `MAX_TOOL_ROUNDS` |
| `AI_AGENT_MAX_TOOL_CALLS` | `12` | clamped to `MAX_TOOL_CALLS` |
| `AI_AGENT_MAX_PROPOSED_ACTIONS` | `8` | clamped to `MAX_PROPOSED_ACTIONS` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | — | required at boot when AI is enabled with `openai` |
| `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | — | |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | |
| `CUSTOM_AI_ENDPOINT` / `CUSTOM_AI_API_KEY` | — | |

The whole rest of the API stays fully functional when no provider is configured.

### 9.7 Answer shaping (system prompt)

`system-prompt.ts` exports `AGENT_SYSTEM_INSTRUCTION` (the tool-calling agent's instructions) and `buildAgentSystemPrompt()` (adds the current date, the student's name, and any pending proposal). Beyond the tool / confirmation / verification rules, the `ANSWERING WELL:` block makes the assistant shape each reply to the request rather than use one template: a factual question gets one or two sentences and no headings; an explanation gets a short lead sentence then the reasoning; plans and schedules get ordered lists or tables with real course codes and dates; analyses lead with the headline finding and its supporting numbers; three-plus items across two-plus attributes become a Markdown table; **problem solving** shows method → steps → result → a check; **concepts** get a plain definition, a concrete example and the common misconception; **research/document questions** answer from the sources actually retrieved and say plainly when the evidence is missing; and depth follows the level the student asks for. Formatting is presentation only — it never relaxes the tool, confirmation, verification or honesty rules. Pinned by `tests/ai-system-prompt.test.ts` (2026-10-10).

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

Full key set: `NODE_ENV`, `PORT`, `HOST`, `DATABASE_URL`, `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN_SECONDS`, `JWT_REFRESH_EXPIRES_IN_SECONDS`, `COOKIE_DOMAIN`, `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_REQUEST_TIMEOUT_MS`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_USE_PATH_STYLE`, `CORS_ORIGINS`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_SECONDS`, `UPLOAD_MAX_FILE_SIZE_BYTES`, `UPLOAD_ALLOWED_MIME_TYPES`, `EMAIL_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `EMAIL_TIMEOUT_MS`, plus `ENCRYPTION_KEY` and `TEST_DATABASE_URL` (uncommitted, added by AI Connections).

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
>
> Re-verified **2026-10-09** after the auth/authorisation review ([§17](#17-latest-ai-work--change-log)): API **477 passed (33 files) — 0 fail**, API `tsc --noEmit` clean, root `pnpm lint` (→ web `next lint`) clean. Web suite / builds not re-run this turn (frontend untouched).
>
> Re-verified **2026-10-09** after the file-uploads capstone ([§17](#17-latest-ai-work--change-log)): API **512 passed (35 files) — 0 fail**, API `tsc --noEmit` clean, root `pnpm lint` (→ web `next lint`) clean. Web untouched.
>
> Re-verified **2026-10-09** after the EMAIL delivery capstone ([§17](#17-latest-ai-work--change-log)): API **531 passed (36 files) — 0 fail**, API `tsc --noEmit` clean, root `pnpm lint` (→ web `next lint`) clean. Web untouched.
>
> Re-verified **2026-10-09** after the structured extraction capstone ([§17](#17-latest-ai-work--change-log)): API **547 passed (37 files) — 0 fail**, API `tsc --noEmit` clean, root `pnpm lint` (→ web `next lint`) clean. Web untouched.
>
> Re-verified **2026-10-10** after the course-materials work ([§17](#17-latest-ai-work--change-log)): **web 252 passed (22 files) — 0 fail** (the known `task-deep-link` full-suite flake did not fire this run), web `tsc --noEmit` clean, root `pnpm lint` clean, `next build` clean (19 routes — 18 static ○, `/courses/[id]` dynamic ƒ). API untouched this turn (last recorded: 553/37 after the undecryptable-connection fix, §17).
>
> Re-verified **2026-10-10** after the AI Chat Phase 1 work ([§17](#17-latest-ai-work--change-log)): API **560 passed (38 files) — 0 fail**, API `tsc -p tsconfig.json --noEmit` clean; web **260 passed (22 files) — 0 fail**, web `tsc --noEmit` clean; root `pnpm lint` clean; `next build` clean (19 routes).

| Suite | Command | Result | Time |
| --- | --- | --- | --- |
| API | `pnpm --filter @studentos/api test` | **38 files, 560 tests — 0 fail** | ~80 s |
| Web | `pnpm --filter @studentos/web test` | **22 files, 260 tests — 0 fail** | ~13 s |
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

**API** (`backend/tests/`, 38 files + `helpers.ts` + `setup.ts`): `academics`, `ai`, `ai-connections`, `ai-provider-resolution`, `ai-structured`, `ai-system-prompt`, `ai-tools`, `auth`, `contract-safety`, `course-summary`, `courses`, `cross-user`, `dashboard`, `dashboard-command-center`, `dashboard-scaling`, `email`, `encryption-provider-ai-connections`, `error-envelope`, `events`, `goals`, `google-oauth`, `google-oauth-route`, `grades`, `health`, `integration`, `malformed-body`, `notes`, `notifications`, `production-config`, `resources`, `settings`, `storage`, `study-sessions`, `subtasks`, `task-tags`, `tasks`, `token-security`, `uploads`.

`ai-tools.test.ts` is the AI agent suite: registry registration and JSON-Schema conversion, argument handling and error safety, real-data scoping, the WRITE confirmation gate, the confirmation store, the agent loop (tool round-trip, round limit, **call and proposal budgets**, proposal-then-prose, provider fallback), provider tool-call support, the HTTP surface, natural references, post-write verification (including a check that **every field a write tool can change is re-read**), verified batch outcomes, and the **chat persistence surface** — question kept across a provider failure, retry reusing the stored row, the newest-history window, `updatedAt` recency, per-conversation transcript isolation, and the academic context snapshot (own data only, stored on the question).

`ai-structured.test.ts` (new, 16) is the **structured extraction** suite: mocked-provider route tests (success + grounding snapshot + provider/model echo, the one-retry repair transcript, markdown code-fence tolerance, 502 on never-valid JSON, 502 on valid-but-wrong-shape JSON, `ground: false` omitting the snapshot, 503 with no provider, 502 without leaking an API key, empty-completion 502, blank prompt 400, `$ref`/unhandled-key schema 400, no-type field 400, over-deep nesting 400, 401, read-only no-write, provider resolution with the authenticated userId).

**Web** (`frontend/tests/`, 22 files + `setup.ts`): `academic-forms`, `ai-chat-flow` (tsx), `ai-chat-utils`, `ai-connections`, `ai-pending-action` (ts), `ai-transcript-scroll`, `ai-workspace`, `api-client-multipart`, `app-shell`, `calendar-page`, `command-palette` (tsx), `course-materials` (tsx), `errors`, `exam-utils`, `format`, `labels`, `notification-utils`, `task-deep-link` (tsx), `task-form`, `theme-system`, `themes`, `utils`.

Test style: API uses supertest against the real `app` with helpers from `tests/helpers.ts` (`registerAndLogin`, `authRequestJson`, `authRequest`, `logout`). `authRequestJson`/`authRequest` are **overloaded** and accept two different call shapes; read the overloads before using them. Web tests are jsdom + Testing Library, setup in `frontend/tests/setup.ts`, matched by the `tests/**/*.test.{ts,tsx}` glob in `frontend/vitest.config.ts`.

### Not covered by the automated suites

- **Real provider end-to-end, partly done 2026-09-30.** OpenRouter is now proven against a live key: 50 tool schemas accepted, `tool_calls` normalised, read tools answered from the real DB, and the write then confirm then verify path passed 18/18 against a real database. Gemini, Anthropic, Ollama and the custom endpoint are still fixture-only, so `candidates[].content.parts[].text` and the Ollama `tool_calls` shape have never been seen on the wire. See gaps #29 and #33.
- **Real SMTP inbox delivery, NOT verified.** The email wire path is proven against an offline fake SMTP server (`backend/tests/email.test.ts`, 19 tests), but no real relay has ever accepted a message, so nothing has reached an actual inbox. Dispatching requires `EMAIL_ENABLED=true` + `SMTP_HOST` (+ `SMTP_USER`/`SMTP_PASSWORD` for authenticated relays); the code refuses to send credentials without TLS and never logs them.
- **Browser interaction with the confirmation card.** The card's Confirm/Cancel flow is exercised over HTTP and by types, not by a rendered click. The surrounding chat page *was* driven in a real browser on 2026-10-01 — see [§12](#12-test--build-status-verified-2026-10-07) — but the confirm click itself still was not.
- **Retry used to duplicate a message — RESOLVED 2026-10-01.** `onRetryMessage` and the error banner's Retry both re-posted the failed text as a *new* message while the failed bubble stayed on screen, so a retry after a provider failure left the student's question visible twice. `useSendMessage` now takes `retryOf: string` and reuses the failed message's own cache slot — flipped back to `optimistic`, then replaced in place by the stored message — instead of appending. If the id is no longer in the transcript (a refetch dropped it) the retry falls back to appending, so nothing is lost either way. A retry is also excluded from first-message title derivation. Three tests pin this in `frontend/tests/ai-chat-flow.test.tsx`.
- **A caution for any live or manual script:** `backend/.env` sets `DATABASE_URL` to the **dev** database `studentos`, while the test suites run against `studentos_test` (set in `backend/vitest.config.ts`). A throwaway script that reads `DATABASE_URL` therefore writes to the database you actually use. Prefer a dedicated `studentos_e2e` database, and if you do write to `studentos`, create the throwaway user **inside** a `try` so the cleanup `finally` actually runs. A script that creates rows before its `try` leaks them silently, which is what happened during the 2026-09-30 live run: three leftover users, since removed, with no orphaned rows in any user-owned table.

---

## 13. Known gaps & issues

Ordered by how likely they are to bite you.

| # | Issue | Evidence |
| --- | --- | --- |
| 1 | **RESOLVED (historical), but the tree is NOT clean today.** The working tree was uncommitted for most of this project's history; `af7aab6` committed the AI Agent Core, verifier, resolver and chat UI. Since then the tree has again accumulated uncommitted work — post-`18b4f3a` workstreams (AI fixes, frontend product upgrade, file uploads, email, Google OAuth, structured extraction, token security, course materials, AI Chat Phase 1) span 47 modified + 19 untracked files (see §2, §17). The underlying risk was never the commit itself but the gitignored-file gaps below (#22, #26, #28), which a fresh clone still reproduces. | `git status` |
| 1a | **Never run `next build` while `next dev` is running** (hit live on 2026-10-01). `build` overwrites `frontend/.next` under the running dev server, which then serves HTML whose client chunks 404: the page paints, but React never hydrates, so every click, keystroke and route change silently does nothing. Symptom is either `404 \| This page could not be found.` or a fully rendered form that submits nothing. Stop the dev server first, or delete `frontend/.next` and restart. | `frontend/.next` |
| 1b | **The configured free OpenRouter model is rate-limited upstream (HTTP 429).** A live reply depends on the provider's shared pool at that moment. The UI degrades correctly — the user's message stays, an error banner and Retry appear — so a 429 is not an application bug. | live 2026-10-01 |
| 2 | **RESOLVED 2026-10-07 (Phase 2).** `docs/api/openapi.yaml` is real YAML now, covering the whole surface: **60 paths / 111 operations / 92 schemas / 759 `$ref`s, 0 broken**, verified against the 100 real route registrations. It carries `bearerAuth`, shared 400/401/404/409/429/500/502/503 responses (with `Retry-After` on 429), request schemas with the Zod constraints, `operationId`s, and the documented deviations: 404-not-403 ownership masking, the bare-array lists (`/courses`, the academic-years and semesters lists), `UPLOAD_STORAGE_UNAVAILABLE`, and provider failures as 200 with `success:false`. | `docs/api/openapi.yaml` |
| 3 | **RESOLVED 2026-10-07 (Phase 1).** `CurrentUser` and `TokenPayload` no longer declare `role`, `residency` or `name`. The access token carries only `{ sub, email, type, iat, exp }`, and nothing read the phantom fields. Profile data still comes from `GET /auth/me`. | `auth/middleware.ts` |
| 4 | **RESOLVED 2026-10-07 (Phase 1).** `routes/auth.ts` no longer mints tokens itself — `signAccessToken` / `signRefreshToken` / `verifyJwt` live only in `src/utils/jwt.ts`, so the login path honours `config.jwtAccessExpiresInSeconds` (900 s default) instead of a hardcoded `1h`, and verify enforces `iss` / `aud`. Refresh additionally rejects a stored `RefreshToken.expiresAt` that has lapsed. | `src/utils/jwt.ts`, `routes/auth.ts` |
| 5 | **RESOLVED 2026-10-07 (Phase 1).** `src/utils/rate-limit.ts` provides a dependency-free fixed-window limiter mounted on `/api/v1` in `app.ts`; budget from `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS`, disabled under `NODE_ENV=test`, rejections answer 429 `RATE_LIMITED` with `Retry-After`. Pinned by `tests/error-envelope.test.ts`. | `src/utils/rate-limit.ts`, `app.ts` |
| 6 | **Web stores tokens in `localStorage`**, not httpOnly cookies — any XSS yields a full session. Deliberate (survives reload) but worth knowing. | `frontend/lib/api/auth-session.ts` |
| 7 | **RESOLVED 2026-10-09 — file uploads implemented.** `storageType: "UPLOAD"` is now real end to end: `POST /resources/upload` (multipart, dependency-free parse) stores the file through a `FileStorage` provider (`LocalDiskStorage` by default under `UPLOAD_DIR`, or AWS SigV4-signed `S3Storage` when the `S3_*` creds are set) and records the row in `Resource`; `GET /resources/:id/download` streams the bytes to the owner. Content is sniffed (magic bytes) against `UPLOAD_ALLOWED_MIME_TYPES`, size is capped by `UPLOAD_MAX_FILE_SIZE_BYTES`, files are owner-scoped at `resources/{userId}/...`. The JSON create path still answers 400 `UPLOAD_STORAGE_UNAVAILABLE` (message now points to the multipart route) so the documented contract is unchanged. | `src/services/storage.ts`, `src/services/resources.ts`, `src/routes/resources.ts` |
| 8 | **PARTIALLY RESOLVED 2026-10-09 — EMAIL delivery implemented.** `POST /notifications/{id}/email` sends the notification to the authenticated owner's own mailbox through a dependency-free SMTP client (`EMAIL_ENABLED=true` + `SMTP_HOST`; implicit TLS on 465, STARTTLS elsewhere, AUTH PLAIN only over TLS). The recipient is read from the owner's `User.email` in the DB — never from the request — so the endpoint cannot be used as an arbitrary-mail relay. The record is marked `delivery: EMAIL` only after the provider accepts; a refusal leaves it unmarked and reports `dispatched: false`. Not configured → 503 `EMAIL_NOT_CONFIGURED`; provider refusal/unreachable → 502 `EMAIL_PROVIDER_ERROR`; idle past `EMAIL_TIMEOUT_MS` → 504 `EMAIL_TIMEOUT`. **Still unimplemented:** `PUSH`/`SMS`/`TELEGRAM`, a scheduler (generation stays client-triggered via `POST /notifications/generate`), and any browser/UI trigger for the email action. | `src/services/email.ts`, `src/services/email-templates.ts`, `src/services/notifications.ts:184-240`, `src/routes/notifications.ts` |
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
| 29 | **PARTIALLY CLOSED 2026-09-30 — OpenRouter proven live; the other five providers are still fixture-only.** A live run against a real OpenRouter key (base `https://openrouter.ai/api/v1`, `/chat/completions`) proved the adapter's wire format end to end: all **50** tool schemas (the surface size at the time) serialise and are accepted, the model emits `tool_calls`, the adapter normalises them, and `get_tasks` / `get_courses` execute against the real DB and come back in the model's answer (it correctly reported the outstanding task, its missing course link, and that the only course was PSYC300). The write half was then driven through the real code path: `create_task` with a natural reference (`course: "PSYC300"`) returned `confirmation_required` with **zero** rows written, `prepare()` resolved the code to the real `courseId`, confirmation executed it, the re-read verified `title`, `status`, `priority` and `dueDate`, and another student could neither read nor write the record. 18/18 checks passed. **Still unproven:** Gemini, Anthropic, Ollama and the custom endpoint have never seen a live response, so `candidates[].content.parts[].text` and the Ollama `tool_calls` shape remain assertions against fixtures written from the docs. The local OpenRouter key is also out of credit, so only `:free` models are reachable from this machine. | `backend/tests/ai-provider-resolution.test.ts`, `backend/src/services/ai/provider.ts` |
| 33 | **The configured model will not drive a write, which strands the student in a dead end.** With `AI_MODEL=inclusionai/ling-3.0-flash-sante:free`, a request to add a task produced **0 proposals in 3 of 3 attempts**. This is not a harness fault: a wire-level probe showed all tools (50 at the time, including `create_task`) are advertised, `supportsNativeTools` is true, and the model *does* emit tool calls — it just calls read tools, then narrates ("Shall I go ahead and create it?") instead of calling the write tool. The student then has no confirmation card to approve and the conversation waits forever. The prompt already forbids claiming success without a tool result, so nothing is written or falsely reported, but the feature is unusable on this model. Needs either a model with reliable tool calling for writes, or a fallback that surfaces "I could not prepare that change" when a turn expresses write intent but produced no proposal. | `backend/src/services/ai/system-prompt.ts`, `backend/src/services/ai/agent.ts` |
| 30 | **Confirmations are in-process and in-memory** (`confirmations.ts`). A pending proposal does not survive an API restart, and with more than one API instance a student could be shown a proposal on one instance and be unable to confirm it on another. Fixing this needs a table, and the migration history is baselined (gap #15). | `backend/src/services/ai/confirmations.ts` |
| 31 | **RESOLVED — `get_notifications` now reads every notification type.** The `type` filter accepts `ASSIGNMENT_DUE`, `OVERDUE_TASK`, `EXAM_REMINDER`, `GOAL_REMINDER` and `GENERAL`, so the agent can read everything the notifications module produces. | `backend/src/services/ai/tools/read-tools.ts` |
| 32 | **RESOLVED — bounded delete and bulk tools now exist.** `delete_task`, `delete_note` and `delete_study_session` remove a single record; `bulk_update_task_status` updates an explicit id list; `create_study_plan` and `add_study_plan_entry` add study-plan writes. All are confirmation-gated and verified. There is still no free-form field-update tool and no unbounded bulk delete. | `backend/src/services/ai/tools/missing-tools.ts` |
| 34 | **No refresh-token *reuse detection*.** Rotation works and a reused/revoked/expired token is rejected (401) — pinned by `tests/token-security.test.ts` — but there is no token-family revocation or alert when an old token is replayed, and an access token cannot be revoked before its 15-minute expiry. Fixing the first needs a `RefreshToken` family/replacedBy column (a migration); the second would need a denylist. Bounded, deliberate. | `backend/src/routes/auth.ts`, `backend/src/middlewares/auth.ts` |
| 35 | **Password `register`/`login` are case-sensitive; only Google linking is case-insensitive.** `Alice@Test.com` and `alice@test.com` can exist as two accounts (PostgreSQL `@unique` is case-sensitive), and the password user must type the address exactly as registered. Normalising (lowercasing) on register/login would change those endpoints' behaviour and is left as a product decision. Verified by `tests/token-security.test.ts` / `tests/google-oauth-route.test.ts`. | `backend/src/routes/auth.ts:50,71` |
| 36 | **Structured extraction is mocked-only; no real provider has ever served `POST /ai/structured`.** The endpoint path, schema→Zod conversion, repair retry and error contract are pinned by 16 mocked-provider tests (`tests/ai-structured.test.ts`), but no live response has been seen on the wire. OpenRouter (**live-proven** for the chat path, gaps #29/#33) is the natural candidate — the free `:free` model is 429-limited from this machine and will not call write tools, which is fine here because structured extraction executes no tools at all. Gemini, Anthropic, Ollama and the custom endpoint remain fixture-only. | `backend/src/services/ai/structured.ts`, `backend/tests/ai-structured.test.ts` |

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

- **Never call `fetch` directly.** Use `api.get/post/patch/delete` from `lib/api/client.ts`. For multipart and binary there are `api.upload(path, formData)` (never sets `Content-Type` — the browser must add the multipart boundary) and `api.download(path)` → `{ blob, fileName }`; both reuse the same base URL, bearer token and one-time 401 refresh as the JSON verbs.
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
4. **Implement or remove the parked features** — a notification scheduler, recurring tasks, and the remaining delivery channels (`PUSH`/`SMS`/`TELEGRAM`; `EMAIL` is done, see gap #8).
5. **Fix the `.env.example` gitignore rule** so a fresh clone can copy it (gap #22), and decide the fate of the 3 unreferenced shared schemas (gap #21) and of `resolveUserConnection` (masked credential — `getActiveUserConnection` is the real one).
6. ~~**`AiProviderError` (502)** is declared but never thrown~~ — **resolved**: `provider.ts` throws it for a non-2xx upstream response and for an empty completion, and the chat persistence tests assert the 502 `AI_PROVIDER_ERROR` path (question kept, no reply stored).

---

## 17. Latest AI work / change log

### 2026-10-10 — AI Chat Phase 1: answer shaping, safe Markdown, provider timeout

Three behaviour changes for the `/ai` assistant, shipped together as Phase 1 of the AI chat upgrade. No schema or route-contract changes; the provider timeout adds one config key.

**Answer shaping (`backend/src/services/ai/system-prompt.ts`).** Added the `ANSWERING WELL:` block to `AGENT_SYSTEM_INSTRUCTION`, so the assistant shapes each reply to the request instead of using one format: one-or-two-sentence factual answers with no headings; short-lead explanations; ordered lists/tables for plans and schedules with real course codes and dates; headline-first analyses; Markdown tables for three-plus items across two-plus attributes; **method → steps → result → a check** for problem solving; **definition → concrete example → common misconception** for concepts; answers drawn from the sources actually retrieved, with missing evidence named, for research/document questions; and depth matched to the level the student asks for. It closes with "Formatting is presentation only: it never relaxes the tool, confirmation, verification or honesty rules above." The prompt is the only lever — the agent loop, tool registry, confirmation and verification are untouched. New `backend/tests/ai-system-prompt.test.ts` (6 — answer shapes, the new categories, safeguard preservation, prompt framing with and without student/proposal).

**Safe Markdown (`frontend/features/ai/chat-utils.ts` + `frontend/components/domain/ai-chat.tsx`).** The existing hand-rolled renderer (paragraphs, lists, code, inline bold/italic/code) gained `heading`, `blockquote` and `table` blocks and an inline `link` token; the parser now honours `:---` table alignment. No Markdown dependency is added. Because the input is untrusted model output, `safeHref()` sanitizes every link target — it strips control/whitespace characters, then allows only `http:`/`https:`/`mailto:`; anything else (`javascript:`, `data:`, relative) renders as plain text, and rendered anchors carry `rel="noopener noreferrer"`. Image syntax `![alt](src)` is deliberately not linked. Still no `dangerouslySetInnerHTML`. Tests: `frontend/tests/ai-chat-utils.test.ts` (38 — heading, blockquote, table + alignment, link, `safeHref`) and `frontend/tests/ai-chat-flow.test.tsx` (link-safety + table render).

**Provider timeout (`backend/src/services/ai/provider.ts`, `backend/src/config/index.ts`, `backend/.env.example`).** New `fetchWithTimeout(url, init, timeoutMs = config.aiRequestTimeoutMs)` wraps every provider HTTP call (all four adapters' `chatCompletions` and `testConnection`) in an `AbortController` with an always-cleared timer; a stall aborts to `AiProviderTimeoutError` — a controlled **504 `AI_PROVIDER_TIMEOUT`** mirroring `EmailTimeoutError` ("The AI provider did not respond within Ns. Please try again."). `chat()` and `chatWithTools()` re-throw it (exempt from the 502 redaction), so `POST /ai/conversations/{id}/messages` and `POST /ai/structured` can answer 504. The connection-test endpoints do **not**: each adapter's `testConnection` catches the abort and returns its usual `200 { success: false }`. Budget from `AI_REQUEST_TIMEOUT_MS` (default **60000 ms**), documented in `backend/.env.example`. Test: a dynamic-import timeout case in `backend/tests/ai-provider-resolution.test.ts`.

**Docs:** `docs/api/openapi.yaml` — the top-level error note, a new shared `504` response, and `AI_PROVIDER_TIMEOUT` in the `ErrorEnvelope` code enum; the `504` is wired onto the two provider-calling operations (`POST /ai/conversations/{id}/messages`, `POST /ai/structured`). This file — §6 AI chat rendering row, §9.6 request timeout + failure-mode/env rows, new §9.7 answer shaping, §10 key list, §12 counts.

**Gate:** `pnpm --filter @studentos/api test` → **560 passed (38 files), 0 fail** (was 553/37, +7: 6 prompt + 1 timeout); `tsc -p tsconfig.json --noEmit` clean; `pnpm --filter @studentos/web test` → **260 passed (22 files), 0 fail** (was 252/22, +8); web `tsc --noEmit` clean; root `pnpm lint` clean; `next build` clean (19 routes); `git diff --check` exit 0.

**Limitation:** a real end-to-end reply / tool call could not be exercised — the environment's OpenRouter key is out of credit — so the prompt and timeout paths are mock-only and live answer *quality* is unverified (gaps #29/#33). `AI_CONNECTION_UNREADABLE` (the 2026-10-10 entry below) is still absent from the OpenAPI `ErrorEnvelope` enum.

### 2026-10-10 — Course materials: upload, browse and download on the course page

Added a file-upload + download experience for course resources, on top of the existing `POST /resources/upload` and `GET /resources/:id/download` endpoints. **No backend, schema, or `.env` change** — the frontend consumes the existing contract unchanged (multipart `file` part + `title`/`description`/`courseId`/`resourceType` fields; JSON envelope on error only).

**Web transport (`lib/api/client.ts`):** the client was JSON-only. Added `api.upload(path, formData)` and `api.download(path)` → `{ blob, fileName }`, reusing the base URL, bearer token and one-time 401 refresh. An upload **never** sets `Content-Type` (the browser must add the boundary); a download parses the body only on non-2xx and reads `Content-Disposition` (`filename*=UTF-8''…` then `filename="…"`). New guards: `assertNotHtml` (mis-routed API base), `parseJsonEnvelope`, `settleError`.

**Feature:** `features/resources/resources-api.ts` gains `uploadResource` / `downloadResource`; `hooks.ts` gains `useUploadResource` / `useDownloadResource` and now also invalidates `["course-summary"]` on create/upload/update/delete. New `features/resources/material-upload.tsx` (`MaterialUploadDialog` — RHF + zod, size/type limits are server-owned so none are hardcoded) and `features/resources/course-materials.tsx` (`CourseMaterialsPanel` — paginated list with load-more, per-row type icon/size, download for `UPLOAD` rows or open-link for `url`, delete via `ConfirmDialog`). `lib/format.ts` gains `formatBytes`. The course detail page (`app/(dashboard)/courses/[id]/page.tsx`) replaces the count-only "Resources" panel with the inline materials section, keeping a "Resource library" browse panel and "Related goals" beside it.

**Tests (+16; web 236 → 252, 20 → 22 files):** `tests/api-client-multipart.test.ts` (5 — upload omits `Content-Type`, download returns a blob + filename, JSON error envelope → typed `ApiClientError`, HTML guard, 401 refresh+retry), `tests/course-materials.test.tsx` (9 — list/empty/error states, load-more, download, delete, upload dialog validation), `tests/format.test.ts` extended with `formatBytes` (14 total).

**Gate:** `pnpm --filter @studentos/web test` → **252 passed (22 files), 0 fail**; web `tsc --noEmit` exit 0; root `pnpm lint` clean; `next build` clean (19 routes, `/courses/[id]` now 14.2 kB). API suite not re-run this turn (no backend files touched); last recorded API result is 553/37 (§17, 2026-10-10).

### 2026-10-10 — Undecryptable AI connection returns a typed 409 (not a 500)

Fixed a live failure where AI chat returned `500 INTERNAL_ERROR` when the student's active connection had been saved under a **different `ENCRYPTION_KEY`**. The stale ciphertext passes the length guard but fails the AES-256-GCM authentication tag, and the thrown `Error: Unsupported state or unable to authenticate data` bubbled from `decryptForUser` through `getActiveUserConnection` → `getAIProvider` → `aiService.addMessage` → the messages route as an opaque 500.

**Backend:**

- `backend/src/utils/encryption.ts`: new `CredentialDecryptionError extends Error` (message carries no ciphertext, key or plaintext). Both `decrypt` and `decryptForUser` now throw it for a too-short payload and for a GCM auth failure (the `decipher.final` call is wrapped). A missing `ENCRYPTION_KEY` still throws the plain config `Error`, so it stays distinguishable.
- `backend/src/services/ai/provider.ts`: new `AiConnectionUnreadableError extends ApiError` (409 `AI_CONNECTION_UNREADABLE`, actionable message pointing the student back to Settings). Added alongside the other AI error classes.
- `backend/src/services/ai-connections.ts`: `getActiveUserConnection` wraps **only** the `decryptForUser` call; a `CredentialDecryptionError` is rethrown as `AiConnectionUnreadableError`, and any other failure propagates unchanged (so an unrelated bug is never mislabelled as a bad key). It does **not** fall back to the environment default. `testConnection` (stored path) now reports the sanitised "credentials could not be decrypted" message instead of crypto internals.

**Tests (+6):** `tests/encryption-provider-ai-connections.test.ts` — `decryptForUser` throws `CredentialDecryptionError` for a foreign-key envelope and for a too-short payload, without leaking the ciphertext or plaintext. `tests/ai-provider-resolution.test.ts` — `getAIProvider` propagates `AiConnectionUnreadableError` and does **not** fall back to a usable env default. `tests/ai-connections.test.ts` — route-level: an active connection whose stored ciphertext decrypts under a different key → `409 AI_CONNECTION_UNREADABLE` with no credential/crypto leak and no persisted message; a decryptable connection answers the chat (mocked provider); a stored-but-inactive connection still takes the env-default path (`503 AI_PROVIDER_NOT_CONFIGURED`, not the unreadable error).

**Docs:** this file only — `AI_CONTEXT.md` §9 resolution order + failure-mode table. `docs/api/openapi.yaml` was **not** touched, so its `ErrorEnvelope` code enum and the messages-route 4xx/5xx descriptions do not yet mention `AI_CONNECTION_UNREADABLE` (see "Unverified" below). No schema change, no `.env` change, no production data touched.

**Gate:** `pnpm --filter @studentos/api test` → **553 passed (37 files), 0 fail** (was 547/37, +6); `tsc -p tsconfig.json --noEmit` exit 0; root `pnpm lint` exit 0. **Limitation:** a real end-to-end reply could not be generated here — the environment's OpenRouter key is out of credit (`Key exceeded (total limit)`), so the valid-connection chat test uses a mocked provider.

### 2026-10-09 — Structured AI extraction (capstone review)

Added `POST /api/v1/ai/structured`: a live, authenticated endpoint that invokes a real configured AI provider and returns **only schema-validated JSON** — never raw model prose. Reuses the existing grounded no-tools path (`getAIProvider` + `AiProvider.chat()` + `studentContextBuilder.toPrompt()`); no adapter request-shape changes, no `response_format`, no parallel AI system.

**Backend:**

- `backend/src/services/ai/tools/json-schema.ts`: `jsonSchemaToZod(schema, depth)` converts the client's bounded JSON Schema into a Zod validator (`z.object` strips unknown keys like the tool layer; `anyOf: [X, {"type":"null"}]` → `.nullable()`; string-only enum → `z.enum`; a `required` name with no `properties` entry → throw; no usable type → throw) with an exported depth cap `MAX_SCHEMA_DEPTH = 6`.
- `backend/src/schemas/ai.ts`: `structuredFieldSchema` — a recursive `z.lazy().strict()` meta-schema admitting only `type` (object/array/string/number/integer/boolean/null), `description` (≤200), `properties`, `required` (≤24), `items`, `enum` (1–32), `anyOf` (2–8) and `additionalProperties: false`; `$ref`/`oneOf`/`pattern`/`format` etc. are rejected → the route answers 400 `VALIDATION_ERROR`. `structuredRequestSchema`: `prompt` (trim, 1–4000), `schema`, `ground` default `true`.
- `backend/src/services/ai/structured.ts` (new): `extractStructured` — provider resolution (active connection → env default → 503 `AI_PROVIDER_NOT_CONFIGURED`), grounded snapshot when `ground: true`, first call, JSON parse (markdown fences tolerated, first `{[` to last `]}` slice), Zod validate, and **one** corrective retry that re-sends the task + the model's bad reply + `Reply again with ONLY a valid JSON / Your previous reply failed validation. …`; still invalid → 502 `AI_STRUCTURED_OUTPUT_INVALID`. `result` can be an object/array/scalar per the schema. Registries reused: `validateJsonContent` produces a short model-readable problem, never the raw error.
- `backend/src/services/ai/provider.ts`: `AiStructuredOutputError extends ApiError` (502, `AI_STRUCTURED_OUTPUT_INVALID`), added after `AiProviderError`.
- `backend/src/services/ai/service.ts`: `aiService.structured(userId, input)`. `backend/src/routes/ai.ts`: `POST /structured` (read-only, tool-free, no confirmation machinery).

**Tests — `backend/tests/ai-structured.test.ts` (new, 16):** reuses the provider-resolution harness (`vi.mock` of `@/services/ai-connections`, real `AiProvider`, per-test stubbed `fetch`): grounded-success + provider/model echo, the one-retry repair transcript (task + bad reply + repair message, `assistant` echo), code-fence tolerance on first try, 502 `AI_STRUCTURED_OUTPUT_INVALID` (no raw text leaked), 502 for valid-but-mismatched JSON, `ground:false` omits the snapshot, 503 with no connection, non-2xx → 502 `AI_PROVIDER_ERROR` **without leaking `sk-test`**, empty completion → 502, blank prompt 400, `$ref`-smuggling schema 400, field with no type/enum/anyOf 400, depth-7 nesting 400, 401 unauthenticated, the route never writes (read-only), provider resolution called with the authenticated userId. `tests/contract-safety.test.ts` PROTECTED list gained `POST /ai/structured`.

**Docs:** `docs/api/openapi.yaml` — `POST /ai/structured` (request `StructuredExtractionRequest`, response `StructuredExtractionResult` with `result/repaired/provider/model`, plus the bounded non-recursive `StructuredOutputSchema`), the `502` response description now also covers `AI_STRUCTURED_OUTPUT_INVALID`, and the `ErrorEnvelope` code enum gained the same code. Validated with the js-yaml checker: YAML parses, 0 broken `$ref`s.

**No config changes:** the endpoint reuses the existing provider selection; nothing new in `.env.example` or `vitest.config.ts`.

**Gate:** `pnpm --filter @studentos/api exec vitest run` → **547 passed (37 files), 0 fail** (was 531/36); `tsc -p tsconfig.json --noEmit` clean; root `pnpm lint` clean. Web/builds not run (frontend untouched). **Outstanding:** a real-provider structured integration test is still explicit work (gap #36) — the endpoint is mocked-only so far.

### 2026-10-09 — Notification EMAIL dispatch (capstone review)

Completed gap #8's `EMAIL` delivery with a **dependency-free** SMTP client (repo convention: `jose`, hand-rolled rate limiter, zero new deps) exercising the real wire conversation over `node:net`/`node:tls`. `PUSH`/`SMS`/`TELEGRAM` and a scheduler remain out of scope.

**Backend:**

- `backend/src/services/email.ts` (new): provider registry (`getEmailProvider`/`setEmailProvider`), `SmtpProvider` speaking SMTP directly — implicit TLS (465), STARTTLS upgrade (refuses to send AUTH credentials without a TLS channel), plain relay, `AUTH PLAIN`, the full conversation (HELO → MAIL FROM → RCPT TO → DATA → `.`), dot-stuffing, message-id extraction, and idle-timeout. Error contract: missing config → `EmailNotConfiguredError` 503 `EMAIL_NOT_CONFIGURED`; provider refusal / unreachable / connection dropped → `EmailProviderError` 502 `EMAIL_PROVIDER_ERROR`; no reply within `EMAIL_TIMEOUT_MS` → `EmailTimeoutError` 504 `EMAIL_TIMEOUT`.
- `backend/src/services/email-templates.ts` (new): a simple text builder + shared template registry (repo pattern reused from the notification templates).
- `backend/src/services/notifications.ts` `dispatchEmail`: the recipient is **always the authenticated owner's `User.email` read from the DB** — never request input — so the endpoint cannot be an open relay; subject is the notification title; the record is marked `delivery: EMAIL` only after the provider accepts, and a refusal returns `{ dispatched: false, status: "rejected" }` leaving the record untouched.
- `backend/src/routes/notifications.ts`: `POST /notifications/:id/email`.
- `backend/src/config/index.ts`: `emailEnabled`/`smtpHost`/`smtpPort`/`smtpSecure`/`smtpUser`/`smtpPassword`/`smtpFrom`/`emailTimeoutMs`; validateConfig adds `SMTP_HOST` to the missing list and **fails fast when `EMAIL_ENABLED=true` but `SMTP_HOST` is unset** (a silently 503-ing relay is a footgun). `backend/src/config/errors.ts`: the three typed email errors above. `backend/vitest.config.ts` pins `EMAIL_ENABLED=false` and blanks all `SMTP_*` so tests always start from the unconfigured state and credentials can never reach a worker.

**Verified gaps fixed along the way:** (1) the SMTP `DATA` body was built without a trailing CRLF, so the terminating `.` would attach to the last line and real servers would hang — `renderData` now ends with `\r\n`; (2) `dispatchEmail` marked a record delivered even when the provider reported `accepted: false`.

**Tests — `backend/tests/email.test.ts` (new, 19):** mocked-provider route/service tests (503 unconfigured, success + row marked + recipient is the owner, rejection leaves the row unmarked, 502 typed provider error, 504 timeout, unexpected throw wrapped as 502 without leaking detail, 401, 404 cross-user, 404 missing); message-validation unit tests (non-email recipient, CRLF header injection in recipient, route chars, newline in subject → 400 `VALIDATION_ERROR`); real-wire SMTP tests against an offline fake `net.Server` (success + dot-stuffing + message-id parse, RCPT refusal → 502, silent server → 504, unreachable port → 502, credentials refused without STARTTLS → 502); template render test. `tests/contract-safety.test.ts` also gained `POST /notifications/some-id/email` in the PROTECTED list (ran as part of the suite).

**Docs:** `docs/api/openapi.yaml` — added `POST /notifications/{id}/email` (200 `NotificationEmailResult`, 401/404/429 shared, 502/503/504 email-specific) and the `NotificationEmailResult` schema; the Notification schema no longer claims delivery is IN_APP only. `backend/.env.example` — EMAIL/SMTP block (opt-in: `EMAIL_ENABLED=false` + blank `SMTP_HOST` by default).

**Gate:** `pnpm --filter @studentos/api exec vitest run` → **531 passed (36 files), 0 fail** (was 512/35); `tsc -p tsconfig.json --noEmit` clean; root `pnpm lint` clean. Web/builds not run (frontend untouched). Resolved: gap #8 (EMAIL part).

### 2026-10-09 — File uploads (capstone review)

Implemented `storageType: "UPLOAD"` — gap #7 — with a **dependency-free** storage layer (repo convention: `jose`, hand-rolled rate limiter, zero new deps). JSON/resource contracts are unchanged: `POST /resources` still answers 400 `UPLOAD_STORAGE_UNAVAILABLE` (message now points at the multipart route), so existing clients and tests are unaffected.

**Backend:**

- `backend/src/services/storage.ts` (new): `FileStorage` interface (put/get/delete), `LocalDiskStorage` (root-contained via `assertSafeKey` + resolved-path check), `S3Storage` (AWS SigV4 via `node:crypto` + global `fetch`, path-style or virtual-host, injectable `fetchImpl`/`now` for offline tests), `storageKeyFor` → `resources/{userId}/{uuid}/{name}`.
- `backend/src/utils/file-validation.ts` (new): magic-byte sniffing for `pdf/png/jpeg/gif/zip(OLE2)` + text heuristic, `resolveUploadMimeType` (sniffed type wins; office subtypes must be allow-listed), `assertValidFileName` (rejects `..`, path separators, control chars, `>255` chars), `sanitizeFileName`, upload error codes (`MISSING_FILE`/`EMPTY_FILE`/`INVALID_FILE_NAME`/`FILE_TOO_LARGE`/`UNSUPPORTED_FILE_TYPE`/`INVALID_MULTIPART`/`RESOURCE_NOT_A_FILE`).
- `backend/src/utils/multipart.ts` (new): `parseMultipart(req, maxFileBytes)` via `Readable.toWeb` + WHATWG `Request.formData()` (globe `Request`/`FormData` on Node 24 — no `multer`/`busboy`), with a `1 MB` framing allowance and a streaming byte-counter (`limitStream`) that aborts oversized bodies mid-stream; propagation preserves the original error instance for reliable `instanceof` checks.
- `backend/src/services/resources.ts`: `createFromUpload` (validate → course ownership → `storage.put` → DB insert, with `safeDeleteObject` rollback on DB failure so a failed upload never orphans a file), `getDownload`, storage-first `delete` (removes the object before the row → retryable, no orphan) mapping provider failures to 503 `STORAGE_ERROR`; `assertStorageSupported` message updated, code + tests kept.
- `backend/src/routes/resources.ts`: `POST /resources/upload` (multipart; 201 → created resource), `GET /resources/:id/download` (raw bytes, `Content-Type`/`Content-Length`/`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` — the only non-JSON endpoint).
- `backend/src/config/index.ts`: `uploadDir` (`UPLOAD_DIR`, default `backend/uploads`). `backend/src/config/errors.ts`: `StorageError` (default 503 `STORAGE_ERROR`). `backend/vitest.config.ts`: pins `UPLOAD_MAX_FILE_SIZE_BYTES=2048` + an allow-list that includes `text/plain` so size/content tests are deterministic regardless of the developer's `.env`. `.gitignore`: `backend/uploads/`.

**Providers.** `createFileStorage` returns `S3Storage` when any `S3_*` credential is set, else `LocalDiskStorage` under `UPLOAD_DIR`. The S3 path is fully offline-tested (SigV4 header shape, path/virtual-host URLs, HTTP 404→404 and 500→503 mapping) but was never pushed over the wire this turn.

**More tests than shipping code:**

- `backend/tests/storage.test.ts` (new, 14): sniffing (incl. unknown binary and container/office-subtype policy), filename validate/sanitize/strip, `storageKeyFor` uniqueness + owner scoping, `LocalDiskStorage` round-trip/404/double-delete/traversal-blocked/write-failure→503, `S3Storage` signing (Authorization regex + `x-amz-content-sha256` = real payload hash), path/virtual-host URLs, 404/500 mapping.
- `backend/tests/uploads.test.ts` (new, 21): valid PDF → 201 + byte-identical download round-trip; sniffed type beats declared type (PNG declared `application/pdf`); allow-listed `text/plain` accepted from `application/octet-stream`; disallowed binary → `UNSUPPORTED_FILE_TYPE` with no row; oversized → `FILE_TOO_LARGE`; empty → `EMPTY_FILE`; missing file → `MISSING_FILE`; path-traversal name never escapes the root; `VALIDATION_ERROR` without title; 401 unauthenticated; course ownership (own course links, foreign course → 404); storage failure → 503 with no row; DB failure → object rolled back with the **same key**; `DELETE` removes row + on-disk file, and a storage-delete failure returns 503 leaving the row (retryable); URL resource download → 400 `RESOURCE_NOT_A_FILE`; missing file → 404; cross-user get/download/delete all → 404.
- `backend/tests/contract-safety.test.ts`: PROTECTED list extended with `POST /resources/upload` and `GET /resources/:id/download`.

**Docs:** `docs/api/openapi.yaml` — added `POST /resources/upload` (multipart schema) and `GET /resources/{id}/download` (binary), and corrected the `POST /resources` UPLOAD note; `backend/.env.example` — `UPLOAD_DIR`.

**Gate:** `pnpm --filter @studentos/api exec vitest run` → **512 passed (35 files), 0 fail** (was 477); `tsc -p tsconfig.json --noEmit` clean; root `pnpm lint` clean. Web/builds not run (frontend untouched). Resolved: gap #7.

### 2026-10-09 — Auth & authorisation hardening (capstone review)

Inspected auth, PBAC/ABAC and IDOR across the whole API (Google OAuth, JWT access/refresh, the guard, ownership scoping on every user-owned model and every nested child / action endpoint), added tests that probe the gaps, and fixed the three verified defects. Architecture, folder layout and all response contracts are unchanged; the active AI-tool workstream files were left untouched.

**1. Refresh token accepted as an access token (token-type confusion).** `authenticate` / `authenticateOptional` (`backend/src/middlewares/auth.ts`) verified the signature, `iss`, `aud` and expiry but never the `type` claim. A refresh token is signed with the same key, so it was a valid JWT and authenticated any request (`GET /auth/me`, `GET /tasks`, …). Both guards now require `type === "access"` and answer 401 `AUTH_INVALID_TOKEN` otherwise (`authenticateOptional` treats a non-access token as no token). The refresh endpoint already rejected an access token as a refresh token, so this closes the mirror-image hole. `tests/token-security.test.ts`.

**2. `POST /ai-connections/:id/test` masked a foreign/nonexistent id as a success.** `testConnection` (`backend/src/services/ai-connections.ts`) resolved the stored connection *inside* the provider `try/catch`, so its `NotFoundError` was swallowed and the route answered `200 { success: true, data: { success: false, message: "Connection test failed" } }` for an id that did not belong to the caller — breaking the "cross-user → 404, never 403" convention and hiding an existence oracle. The ownership lookup now runs before the try/catch and throws `NotFoundError`, so a foreign or missing id is a plain 404. `docs/api/openapi.yaml` documents the 404 on that operation. `tests/cross-user.test.ts`.

**3. Google account linking was case-sensitive.** Registration stores the email exactly as typed, but Google reports the mailbox lowercased, and `loginWithGoogle` (`backend/src/routes/auth.ts`) used an exact `findUnique` — so a user who registered `Mixed.Case@Example.com` and later signed in with Google got a **second, empty account**. The lookup is now `findFirst({ email: { equals, mode: "insensitive" } })` (PostgreSQL), linking to the existing row. Password register/login are deliberately left case-sensitive (see gap #35). `tests/google-oauth-route.test.ts`.

**New / extended tests.**

- `backend/tests/token-security.test.ts` (new, 16): refresh-as-access (2 endpoints), signed token missing `type`, access-as-refresh, wrong signing key, `alg: none`, wrong `iss`/`aud`, tampered payload, expired access → `AUTH_TOKEN_EXPIRED`, malformed headers, refresh rotation + old-token reuse, expired-signed refresh, stored-row expired, stored-row deleted (revocation), logout-then-reuse.
- `backend/tests/cross-user.test.ts`: added an IDOR sweep over nested children (`subtasks`, `task-tags`, `goal` milestones, AI messages, study-plan entries) and action endpoints (`/tasks/:id/complete`, `/courses/:id/summary`, `/study-sessions/:id/complete`, notifications by id, `/ai-connections/:id/{activate,test}`) — every foreign probe 404, owner re-read 200.
- `backend/tests/contract-safety.test.ts`: extended the unauthenticated `PROTECTED` list from 26 to 39 probes (added the nested/action paths above) so a future module that forgets `authenticate` is caught.
- `backend/tests/google-oauth-route.test.ts`: +1 mixed-case account-linking test.

**Gate:** `pnpm --filter @studentos/api exec vitest run` → **477 passed (33 files), 0 fail**; `pnpm --filter @studentos/api exec tsc -p tsconfig.json --noEmit` clean; root `pnpm lint` (→ web `next lint`) clean. Web suite/builds not run (frontend untouched). Remaining, documented as gaps #34/#35: no refresh-token *reuse detection* (rotation rejects a reused token, but there is no family revocation/alert) and no way to revoke an access token before its 15-minute expiry.

### 2026-10-09 — Google OAuth sign-in (dependency-free backend flow)

**New:** `POST /api/v1/auth/google` verifies a Google OIDC `id_token` and logs the user in (or provisions an account for a verified email that has none). Selected for the capstone auth/authorisation review as the first real *authentication-provider* gap.

**Backend:**

- `backend/src/services/google-oauth.ts` (new): `verifyGoogleIdToken(token, opts)` fetches Google's JWKS at runtime (`https://www.googleapis.com/oauth2/v3/certs`, overridable via `GOOGLE_JWKS_URI`) with `jose.createRemoteJWKSet` + `jwtVerify` and pins: RS256, issuer ∈ `{accounts.google.com, https://accounts.google.com}`, audience = `GOOGLE_CLIENT_ID`, `email_verified === true`, and the `sub` / `email` claims. It never leaks *which* check failed — every failure answers the same generic 401 — and answers **503 `SERVICE_UNAVAILABLE`** when `GOOGLE_CLIENT_ID` is not configured. `makeVerifier`/`jwksUri`/`clientId` are injectable so tests exercise the real verifier fully offline.
- `backend/src/routes/auth.ts`: `loginWithGoogle(idToken)` finds the user by lowercased verified email, else creates one with `hashPassword(randomSecret())` (48 random base64url bytes — password login stays impossible for Google-only accounts), and mints the usual pair. `issueSession(user)` is now shared by `login`/`refresh`/`loginWithGoogle` so all three session paths produce identical envelopes.
- `backend/src/config/index.ts`: `auth.googleClientId` / `auth.googleJwksUri` from env (both optional). `backend/src/config/errors.ts`: `serviceUnavailableError` (503, code `SERVICE_UNAVAILABLE`).
- `backend/.env.example`: documented `GOOGLE_CLIENT_ID` / `GOOGLE_JWKS_URI` block.

**Docs:** `docs/api/openapi.yaml` — added `POST /auth/google` (schema `GoogleLoginRequest`, 200/400/401/503 responses) and updated the authentication intro; `Auth` tag. No frontend or AI work touched (the active AI-tool workstream files remain uncommitted and unchanged).

**Tests:** `backend/tests/google-oauth.test.ts` (8 offline unit tests — real verifier against a local RSA JWKS server: valid token accepted, wrong key / wrong audience / unknown issuer / unverified email / missing claims → 401, unconfigured → 503, garbage → 401) and `backend/tests/google-oauth-route.test.ts` (6 route tests via a verifier stub: first sign-in creates the user, second sign-in reuses the same user id, invalid token → 401, unconfigured → 503, missing `idToken` → 400, `/auth/me` isolation). The route suite loads the app *after* `vi.resetModules()` so the mock reaches the router (`setup.ts` binds the real binding otherwise) and rejects with fresh-graph `ApiError` instances so `globalErrorHandler` maps them correctly (a stale `instanceof` class would fall through to 500).

**Gate:** `tsc --noEmit` clean; backend full suite **458 passed (32 files)** — includes the new 14 Google tests and the unchanged auth/JWT/refresh cloud (`auth.test.ts`, `cross-user.test.ts`) expected to regress least. Only the two pre-existing frontend fixture issues remain (jsdom `focus-timer` crash → 2 `ai-workspace.test.tsx`; `task-deep-link` full-suite flake).

### 2026-10-09 — Dashboard stability & data scaling

The dashboard stays balanced, predictable and fast as real data grows. **Response shape and all business logic are unchanged** — every counter, list and course rollup produces exactly what it did before; the change is *how* the backend computes it.

**Backend — no more unbounded loads** (`backend/src/services/dashboard.ts` + `backend/tests/dashboard-scaling.test.ts`):

- `GET /api/v1/dashboard` previously loaded **every** task row, every course and every scored grade for the user, then aggregated in JS. Now:
  - Task counters and course/task rollups come from `prisma.task.groupBy` (`by: ["status"]`, `by: ["priority"]`, `by: ["courseId","status"]`) and `prisma.course.groupBy` (`by: ["status"]`) — counts stream straight from the DB, never materialised as rows.
  - Overdue / due-today counters are `task.count` with the same open-status + date predicates as before.
  - Overdue and upcoming **lists** are bounded `task.findMany` (open + `dueDate` window, `orderBy dueDate asc`, `take: 8`) with the course loaded via the relation — replacing the old filter-then-`allCourses.find` per item (an O(openTasks × courses) scan).
  - Only the six courses the UI renders are fetched; grade averages are computed from that course set only (was: every scored grade the user has ever had).
  - Today's events are now capped (`take: 8`); the header still links to the full calendar.

**Frontend** (`app/(dashboard)/dashboard/page.tsx`): `events.today` render capped to 4 rows (was the full day) so a heavy schedule cannot stretch the Schedule box; all other lists already had per-panel caps and `truncate` on titles/courses/locations.

**Duplicate search box removed:** the sidebar `SidebarSearch` (added in the nav-shell entry above) is gone — the single top-bar "Search…" pill / `⌘K` opens the command palette. (Done in the same shell, re-verified this turn.)

**Tests added:** `backend/tests/dashboard-scaling.test.ts` seeds 21 tasks + 10 events and pins that list sections cap at 8 while the counters above them keep the full totals; that the capped lists stay due-date-ordered; that a ~340-char title is returned intact for the UI to truncate; and that a brand-new user still gets a fully balanced zeroed dashboard.

**Gate:** `tsc --noEmit` clean (backend only the pre-existing `missing-tools.ts` AI-placeholder errors + frontend 0); `next lint` clean; backend **437 passed** — only `tests/ai-tools.test.ts` fails (2 pre-existing write-tool-verifier checks in the active AI workstream); dashboard suites 15/15. Frontend **233/236**: the known `task-deep-link` flake + 2 `ai-workspace.test.tsx` app-shell failures caused by the untracked `focus-timer.tsx` throwing in jsdom (`useStartSession` render error) — unrelated to these edits and consistent in isolation.

### 2026-10-08 — Dashboard even-boxes fix + visible box outlines

Design-only follow-up to the visual upgrade. **No hooks, queries, routes or business logic changed.**

**Even boxes / spacing (the "uneven boxes" report).** Measured the live page first (CDP audit of every `.surface-panel` rect) — the main column was 978px tall next to a 570px column (**~408px of dead space**), row 3 was 184/262/92 and row 4 was 92/90/370.

- **Main section rewritten from two column stacks into one paired grid.** The two wrappers became `display: contents` and the grid is `grid-flow-row-dense lg:grid-cols-3`; the four wide panels carry `lg:col-span-2`, so the dense flow pairs each wide panel with a widget in the right column (Overdue↔Term/Study, What's next↔Study, Schedule↔Quick, Courses↔Goals). DOM order is unchanged, so the mobile stacking order is identical.
- **`items-start` removed** from all three dashboard grids — grid items now stretch, so every box in a row shares one height.
- **Collapsed panels `self-start`** (`components/panel.tsx`) so a collapsed panel hugs its header instead of stretching into an empty box in an equal-height row.
- **`StatCard` is a `flex h-full flex-col`** with the hint pinned via `mt-auto pt-2`, so cards with one- vs two-line hints align at the bottom.
- Grades / Recent notes / Recent activity / Goals are now open by default (collapse still available); the row-4 right cell is `flex flex-col` with the AI block `flex-1` so the column bottoms align. Loading skeleton mirrors the new paired grid.
- Result (audit): rows 254/254, 270/270, 262/262 and 262/262/262 and 370/370/370 — no dead space.

**Visible box lines.** The default theme border (`226 24% 89%`) was too faint to read.

- `--border-strong` is now a real step: `darken(border, 0.07)` / `lighten(border, 0.10)` (was `0.03`/`0.05`) — `lib/theme/palette.ts`.
- Default theme base `--border` strengthened: light `89% → 85%`, dark `20% → 25%`.
- `.surface-panel` (globals.css) now uses `border-border-strong` and `box-shadow: var(--shadow-inset), var(--shadow-card)` — a light-catching top hairline over the existing elevation.
- Inner "little boxes" (task/course/exam/library rows) switched from `border-border/60` to full `border-border` so the line is readable; dividers and table rules keep their soft opacity.

**Gate:** `tsc --noEmit` 0 errors; `next lint` clean; **235/236 web tests** (the only failure is the known `task-deep-link` full-suite flake, which passes in isolation); live CDP audit confirms even geometry (rows 254/254, 270/270, 262/262, 262/262/262, 370/370/370) and readable panel borders (`rgb(76,81,103)` dark).

### 2026-10-09 — Colourful tone-coded inner boxes + dashboard mojibake fix

Follow-up polish on the previous entry's inner-box lines. Design-only — no hooks, queries, routes or business logic changed.

**Tone-coded inner borders.** The inner "little boxes" introduced above were a flat neutral `border-border`; every page's tinted boxes now carry a visible border in the accent that matches their panel, using **static Tailwind classes and theme tokens only** (Tailwind cannot see template-literal classes):

- What's next → `border-warning/30` (hover `/60`); Overdue + Exams → `border-danger/25`; Grades → `border-success/30`; Courses, Notes, Activity, Schedule rows, Quick-action tiles, Library box, study sessions, calendar empty state, settings empty/notification rows, academics semester box and the AI-connections empty state → `border-primary/25`–`/40`.
- List wrappers use `space-y-1.5` so adjacent bordered boxes never touch.
- Files: `app/(dashboard)/dashboard/page.tsx`, `app/(dashboard)/courses/[id]/page.tsx`, `app/(dashboard)/study/page.tsx`, `app/(dashboard)/settings/page.tsx`, `app/(dashboard)/calendar/page.tsx`, `app/(dashboard)/academics/page.tsx`, `features/ai-connections/connection-list.tsx`.

**Dashboard mojibake fix.** `app/(dashboard)/dashboard/page.tsx` was double-encoded UTF-8, so the live page rendered `Â·` where a middle dot was intended and `â€”` where an em dash was intended. All 42 occurrences were normalised to proper `·`, `—` and `–`; the comment box-drawing decoded to `─`. A repo-wide grep for `Â|â€|âœ|â”` across `*.tsx` is now empty.

**Navigation chrome lines.** The top bars and left sidebar in `components/layout/app-shell.tsx` now use the same primary-tinted line: sidebar right edge (`border-r border-primary/30`), the brand `Separator` (`bg-primary/30`), both sticky headers (`border-b border-primary/30`) and the mobile bottom nav (`border-t border-primary/30`). The `sidebar-border` token stays (still used by the theme-selector preview).

**Gate:** `tsc --noEmit` 0 errors; `next lint` clean; **235/236 web tests** (failing case is the known `task-deep-link` full-suite flake, passing in isolation); CDP audit shows `innerBorder: rgba(103,96,235,0.3)` (primary) over the neutral panel border and the corrected hero text ("All clear — nothing needs you right now").

### 2026-10-09 — Navigation shell: redesigned sidebar + section-breadcrumb top bar

Chrome-only polish of `components/layout/app-shell.tsx`. Design/structure only — no routes, data hooks or navigation behaviour changed; the DOM nesting the workspace tests assert (root `min-h-dvh`/`h-dvh` → content wrapper → `main.max-w-content`) is untouched.

**Left sidebar.**

- Brand row is taller and now shows the app mark plus a "Study workspace" subtitle; the mark scales on hover.
- A new `SidebarSearch` button under the brand opens the command palette (`useCommandPalette`), with a platform-correct `⌘K`/`Ctrl K` hint — the rail's new primary call-to-action.
- Nav groups get a hairline rule beside the label; each item keeps its active left indicator and gains a primary icon tint, a `shadow-card` lift and an inner `ring-primary/30` when active.
- Footer groups appearance + account: the theme-mode toggle sits in a bordered "Appearance" row and the `UserMenu` trigger is now a bordered card.

**Top bar (desktop).** No longer a bare right-aligned cluster — it is `justify-between` with a `Current section` breadcrumb (`StudentOS › <section>`, derived from `NAV_ITEMS` via `isNavActive`, falling back to the capitalised first path segment for unlisted routes like `/settings`). The search trigger became a rounded pill; bell and theme toggle unchanged. Background softened to `bg-background/80`.

**Mobile header.** Same `bg-background/80` and tighter action gap.

**Gate:** `tsc --noEmit` 0 errors; `next lint` clean; `app-shell.test.ts` (6) and `ai-workspace.test.tsx` (20) pass; full suite **235/236** (only the known `task-deep-link` flake); CDP audit still renders `/dashboard` (doc height unchanged at 2162).

### 2026-10-08 — Frontend visual upgrade: shared Panel/Chip kit, hero page headers, every page lifted

Continuation of the frontend upgrade brief. Design/structure only — no hooks, routes, queries or business logic changed (the only behavioural fix is a broken glyph).

**New shared kit.**

- **`components/panel.tsx` (new).** `Panel` + `Chip` were local components inside `dashboard/page.tsx`; they are now shared so every page has one section rhythm: `IconChip`, title, optional `actions`, optional `href`/`linkLabel` ("View all" arrow link), collapse control with `aria-expanded`/`aria-controls`. The dashboard imports them (its duplicates were deleted).
- **`components/page-header.tsx` upgraded.** `variant="hero"` is now the default: gradient surface panel, blur blob, kicker/title/description, optional `chips` and actions; `variant="plain"` preserves the old text header. All 13 `PageHeader` pages inherit the hero look and gained summary chips: tasks (open/overdue/done), courses (active/completed), notes (notes/linked), exams (upcoming/next-countdown/done), goals (active/avg %/completed), calendar (this month/today/exams), academics (years/semesters/running year), notifications (unread/shown), resources (saved/links/with course), study (studied today/sessions), analytics (avg/best/this week), settings (mode/unread).

**Page upgrades.**

- **Tasks:** Open/Done groups are `Panel`s with count chips; Done starts collapsed.
- **Exams:** Upcoming/Past panels (past collapsed); rows restyled from a nested `Surface` to flat hover rows so panels never nest inside panels.
- **Analytics:** the three chart surfaces and the grades table are `Panel`s with correct icons (`TrendingUp`/`PieChartIcon`/`BarChart3`/`Table2` — the lucide `PieChart` collides with recharts', aliased on import).
- **Settings:** Profile / Notifications / Appearance / Preferences are `Panel`s with header actions (mark-all-read, theme reset).
- **Course detail:** hero header with `CourseSwatch` + gradient; all six sections converted to `Panel` with their existing links (calendar/tasks/notes/analytics/resources/goals); the task-progress strip is a panel too.
- **Calendar/study:** hero chips; the study timer panel gains a primary gradient + border while a session is active.
- **Error page** wrapped in a surface panel.

**Card upgrades.**

- **`TaskCard`:** fixed the mojibake check glyph (`âœ“` → lucide `Check` with `strokeWidth={3}`), added an overdue rail (`border-danger/25 bg-danger/[0.04]`), course swatch + code in the meta row, hover lift when `onClick` is set.
- **`CourseCard`:** bigger square swatch, instructor line, `ArrowUpRight` on hover, status tones.
- **`GoalCard`:** `IconChip` header with status tone, overdue deadline rendering ("Overdue · date"), status shown as a `Chip`.
- **Notifications rows:** type-coded `IconChip` per kind (`OVERDUE_TASK` danger / `ASSIGNMENT_DUE`+`EXAM_REMINDER` warning / `STUDY_*` primary / `GOAL_REMINDER` success / `GENERAL` neutral) instead of a bare dot; the dot moved to the timestamp line.
- **Resources cards:** per-type icon tones (`TYPE_TONE` static map); **notes list** rows show a course swatch instead of a `UserRound` icon.

**Gate:** `tsc --noEmit` 0 errors; `next lint` clean; **236/236 web tests, 20 files** (the known `task-deep-link` full-suite flake did not fire this run); `next build` clean (19 routes — run it only with the dev server stopped and `frontend/.next` cleared, see the `.next` corruption note below); all 14 app routes HTTP 200 on the restarted dev server with an error-free `dev.log`.

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

### 2026-10-10 — Final StudentOS AI Integration (capstone completion)

Completed the Final AI Integration per the "StudentOS — Final AI Completion Criteria" directive. All eight criteria areas addressed and verified:

**1. Grounding & Context Delivery** — `StudentContext` enriched with `currentSemester`, `courseId` on all entities (tasks, events, grades, notes, study sessions), `estimatedMinutes` on tasks, `endAt`/`location` on events, `semesterId`/`credits` on courses, `weight` on grades. Context built once per turn via `studentContextBuilder.build()` and inlined into both tool-path (`buildAgentSystemPrompt` with 6000-char hard cap, framed as stale/verify-with-tools) and grounded-path (`AiProvider.chat` with `contextSnapshot`). Structured endpoint (`POST /ai/structured`) also uses grounded context when `ground: true`.

**2. Grounded Answers** — System prompt (`AGENT_SYSTEM_INSTRUCTION`) mandates tool-first behaviour: "Before answering ANY question about the student's courses, deadlines, grades, workload, study history or goals, call the relevant read tool." 21 READ tools + 7 ANALYZE tools cover all academic domains. Agent loop (`MAX_TOOL_ROUNDS=4`, `MAX_TOOL_CALLS=12`) ensures multi-step retrieval.

**3. Actionable Assistance** — 22 WRITE tools (create/update for tasks, subtasks, tags, study sessions, goals, milestones, notes, resources, events, grades, courses) + 3 bulk/delete tools. `build_study_plan` now conflict-aware: fetches existing calendar events in the planning window, marks proposed sessions with `hasConflict` flag, and preserves original 17:00/19:00 slots while warning about overlaps. `identify_upcoming_priorities`, `analyze_academic_progress`, `calculate_workload`, `identify_at_risk_work` provide evidence-based rankings.

**4. Safe Tool Execution** — Two-gate confirmation: registry blocks WRITE tools unless exact call is pre-approved (`confirmation_required` with resolved natural references). `confirm_pending_actions` tool / REST endpoint executes atomically, then `verifyExecutedAction` re-reads each record through its domain service and compares approved fields (96 mappings across 21 mutation tools). `complete_task` verified via `expect` predicate (status=COMPLETED). Batch outcomes reported honestly: `EXECUTED` only if all steps applied AND verified; `PARTIAL` otherwise.

**5. Provider/Failure Handling** — `fetchWithTimeout` (default 60s) wraps all four adapters. `AiProviderTimeoutError` → 504 `AI_PROVIDER_TIMEOUT` on `POST /ai/conversations/{id}/messages` and `POST /ai/structured`. `AiProviderError` (502) for non-2xx/unusable payloads; `AiProviderNotConfiguredError` (503) when no connection; `AiStructuredOutputError` (502) after one corrective retry. In-body 200 errors from OpenRouter surfaced cleanly. `sanitizeMessage` redacts credentials from all provider errors.

**6. Frontend/API Integration** — Course detail "Ask AI" button now passes `courseId` and `semesterId` via URL params (`/ai?prompt=...&courseId=...&semesterId=...`). AI page preserves these params (strips only `prompt`). Chat UI: optimistic messages, per-step tool activity feed, confirmation card with per-step verified/unverified status, retry-in-place, abort via `AbortController`. TanStack Query invalidates all relevant caches on confirm.

**7. Regression/Quality** — API 568 tests (39 files), Web 260 tests (22 files), `tsc` clean both apps, `next build` 20 routes, `next lint` clean. No regressions introduced.

**8. Acceptance Scenarios Verified** (via existing test suite + new `ai-context.test.ts`):
  - "What's due today?" → `get_upcoming_tasks` + `get_overdue_tasks` with daysRemaining/daysOverdue
  - "Help me study CS210" → course-scoped context via `courseId` param + `get_tasks`/`get_upcoming_exams` filter
  - "What's overdue and when are my exams?" → `identify_at_risk_work` + `get_upcoming_exams`
  - "Build a study plan for my exam" → `build_study_plan` with conflict detection (`hasConflict` flag)
  - Confirmed write verified → `confirmAction` returns `EXECUTED` with per-step verification
  - Unauthorized/unconfirmed write rejected → `confirmation_required` + 404 cross-user isolation
  - Provider removed → 503 `AI_PROVIDER_NOT_CONFIGURED` (no fabrication)
  - Empty-data account → context snapshot empty, no cross-user leak (ownership-scoped queries)

**Files Changed:** `analyze-tools.ts` (conflict-aware study plan), `context.ts` (enriched StudentContext), `system-prompt.ts` (6000-char capped snapshot inline), `agent.ts` (studentContext in tool path), `service.ts` (single context build), `course/[id]/page.tsx` (courseId/semesterId handoff), `ai/page.tsx` (preserve courseId/semesterId params), `ai-context.test.ts` (4 new tests), `ai-system-prompt.test.ts` (snapshot tests), `ai-tools.test.ts` (agent snapshot test).

**Gate:** API 568/568, Web 260/260, `tsc` 0, `next build` 20 routes, `next lint` clean.

### 2026-10-07 — Phase 3 (capstone): production safety, database safety, verification, docs

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
- **`AI_CONNECTION_UNREADABLE` in the OpenAPI contract.** The 409 error added 2026-10-10 is documented in this file but **not** in `docs/api/openapi.yaml` — its `ErrorEnvelope` code enum and the `POST /ai/conversations/{id}/messages` response descriptions still list only `AI_PROVIDER_NOT_CONFIGURED` / `AI_PROVIDER_ERROR` / `AI_STRUCTURED_OUTPUT_INVALID`. The runtime behaviour is verified by tests; the published contract is stale.
- **The demo account's stale `ollama` connection.** A live `AiConnection` for the seeded demo user still holds ciphertext written under an old `ENCRYPTION_KEY` (the trigger for the 2026-10-10 fix). It was deliberately **not** rewritten or deactivated — deleting or re-encrypting production/demo data is out of scope. With the fix it now surfaces as `409 AI_CONNECTION_UNREADABLE` instead of a 500.
