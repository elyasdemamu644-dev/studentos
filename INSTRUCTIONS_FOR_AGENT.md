# StudentOS API — Repository Overview (after Phase 2)

**Working directory:** `C:/Users/LENEVO/Desktop/vs-code/StudentOS/`

**Monorepo layout:** pnpm workspaces + Turborepo

- `apps/api` — Express + TypeScript REST API (the main implementation surface)
- `packages/shared` — Zod schemas shared across the monorepo (depends on `zod`; keep the dependency declared when touching its package.json)

---

## How to run

```bash
# API dev server (from repo root)
pnpm --filter @studentos/api dev

# Test suite
pnpm --filter @studentos/api test

# Type-check / build (tsc)
npm --prefix apps/api run build
```

Vitest config maps the `@/` path alias to `apps/api/src/`, so TypeScript path aliases work out of the box.

---

## Current project state

All backend modules below are implemented, mounted automatically under the versioned API, and covered by the test suite.

**API conventions**

- Base path: `/api/v1` (mounted in `apps/api/src/routes/index.ts`).
- All routes except `/api/v1/auth` and `/health` require a valid JWT via the `authenticate` middleware.
- Success responses: `{ success: true, data }`.
- Errors: `{ success: false, error: { code, message } }` (see `apps/api/src/config/errors.ts`).
- Cross-user access to another user's resources is masked as `404` (never 403) — every query is scoped to the owner.
- List endpoints paginate with `limit` + `cursor` and return `{ items, hasMore, nextCursor }`.

**Module surface**

| Module | Routes |
|---|---|
| Health | `GET /health` (public; DB ping returns `{ status, service, version, environment, database, timestamp }`) |
| Auth | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/me`, password change |
| Academics | academic years + semesters (list/create/get/update/delete) |
| Courses | `/courses` CRUD |
| Dashboard | `/dashboard` aggregates: stats, upcoming/recent tasks, events (today + upcoming), study sessions (today minutes/count + recent), courses, active goals, recent notes, recent grades, unread notification count |
| Tasks | `/tasks` CRUD + cross-user isolation |
| Tasks — subtasks | `/tasks/:taskId/subtasks` (list/create/update/delete, ordered by position) |
| Tasks — tags | `/tasks/:taskId/tags` (list/add/remove; duplicate names → 409) |
| Notes | `/notes` CRUD |
| Resources | `/resources` CRUD (URL storage only — see Deferred below) |
| Events | `/events` CRUD + list filters (courseId, type, date range) |
| Study sessions | `/study-sessions` CRUD; list returns `summary` (count + total minutes) |
| Goals | `/goals` CRUD + nested milestones; progress tracking |
| Grades | `/grades` CRUD (score ≤ maxScore enforced) |
| Notifications | `/notifications` list (newest first + `unreadCount`), get, update, markRead, readAll — system-generated only (see Deferred below) |
| Settings | `/settings` key/value store (upsert; `null` deletes a key) |
| AI assistant | `/ai/*` — see AI architecture below |

Mounting lives in `apps/api/src/routes/index.ts`. Subtasks/task-tags mount at the root (`/`) because their routers define the full `/tasks/:taskId/...` paths themselves.

---

## Verification state

- **19 test files** in `apps/api/tests/`
- **166 tests, 0 failures** (`pnpm --filter @studentos/api test`)
- **`npm --prefix apps/api run build` passes** (tsc)
- No lint config exists in the repo, so the `tsc` build doubles as the lint/type gate.

Test files: auth, academics, courses, tasks, dashboard, cross-user, health, notes, resources, events, study-sessions, goals, grades, notifications, settings, subtasks, task-tags, ai, integration.

---

## AI architecture

Location: `apps/api/src/modules/ai/`

- `provider.ts` — provider abstraction. `AIProvider` interface (`isConfigured()`, `chat()`). `OpenAIProvider` calls `${OPENAI_BASE_URL}/v1/chat/completions` with plain `fetch` (no SDK), so any OpenAI-compatible endpoint works. `createAIProvider()`/`getAIProvider()` select and cache a process-lifetime singleton. Controlled errors: `AiProviderNotConfiguredError` → `503 AI_PROVIDER_NOT_CONFIGURED`, `AiProviderRequestError` → `502 AI_PROVIDER_ERROR`.
- `context.ts` — `studentContextBuilder.toPrompt(userId)` assembles a bounded, ground-truth context prompt from the user's StudentOS data. The context snapshot is persisted on each generated message.
- `service.ts` / `routes.ts` — fully database-backed and ownership-scoped (cross-user → 404):
  - Conversations: `GET|POST /ai/conversations`, `GET|DELETE /ai/conversations/:id`
  - Messages: `GET|POST /ai/conversations/:id/messages`
  - Study plans: `GET|POST /ai/study-plans`, `GET|PATCH|DELETE /ai/study-plans/:id`, `GET /ai/study-plans/:id/entries`, `PATCH /ai/study-plans/:id/entries/:entryId`

### AI provider configuration is still required

AI responses are only generated when a provider is configured. Without it the API stays fully functional, but generation requests fail with a controlled `503 AI_PROVIDER_NOT_CONFIGURED` and no message is persisted.

- `AI_ENABLED` defaults to **true** (`process.env.AI_ENABLED !== "false"`). The test suite sets `AI_ENABLED=false` (see `apps/api/vitest.config.ts`) so tests never hit an external API.
- To enable real generation: set `OPENAI_API_KEY`; optionally point `OPENAI_BASE_URL` at a compatible endpoint and set `AI_MODEL` (default `gpt-4o-mini`).
- `validateConfig()` in `apps/api/src/config/index.ts` fails fast at boot if `AI_ENABLED` is on with provider `openai` but no `OPENAI_API_KEY`.
- Behavior: posting a message with role USER and `generateReply: true` (the default) stores the message, assembles context + recent history, calls the provider, and persists the assistant reply. `generateReply: false` stores the message only (response `reply: null`).

---

## Deferred functionality

These are intentionally not implemented in Phase 2:

- **Real file uploads (S3).** The `UPLOAD` storage type exists in the Resource schema and the `S3_*` config keys exist in `apps/api/src/config/index.ts`, but upload operations are rejected cleanly: `storageType: "UPLOAD"` on create/update returns `400` with code `UPLOAD_STORAGE_UNAVAILABLE`. Only URL resources are supported.
- **External notification delivery.** The Notification schema carries `delivery`/`channel` fields (including PUSH/EMAIL/SMS/TELEGRAM enum values), but only `IN_APP` delivery is implemented. Notifications are system-generated only (no create endpoint) and no scheduler/job emits them yet.

---

## Gotchas for future work

- Prisma `createMany` uses a single `now()` timestamp for all rows — tests depending on `createdAt` ordering must seed explicit timestamps.
- Keep the repo green: run `pnpm --filter @studentos/api test` (all 166 tests) and `npm --prefix apps/api run build` (tsc) after any change. The old build failure "Cannot find module 'zod'" in `packages/shared` was fixed by declaring `zod` in that package's dependencies — don't remove it.