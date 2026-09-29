# StudentOS — Final QA Report

> **Archived historical snapshot** (originally `QA_FINAL_REPORT.md` at the repo root, moved 2026-09-27). Its test counts and file paths describe the state of 2026-09-24 and are **not** current. `AI_CONTEXT.md` is the source of truth.

**Date:** 2026-09-24 · **Stack:** Next.js web app + Express/Prisma API (PostgreSQL) + Fastify? no — Express.

## Summary

The StudentOS full-stack QA pass is complete. All seven contract bugs found during the audit were fixed, and correctness is verified two ways:
1. **Unit/contract tests** — 166 API tests + 43 web tests, all passing.
2. **Live HTTP probes** — a fresh single-process run against the restarted API (critical: the earlier "instructor/estimatedMinutes missing" readings were caused by a **stale API process** that had not reloaded the schema/service edits; after restart the fields round-trip correctly).

**Estimated overall completion: ~95%** (remaining items are documentation artifacts and a manual browser pass — see "Remaining".)

## Verified working (live)

- Health (DB connected), register/login/refresh/logout, wrong-password 401, duplicate-email 409, me 200
- Courses: create with `instructor` → 201 + `instructor` returned; get-by-id 200; PATCH instructor → 200; list 200 (instructor carried)
- Tasks: create with `estimatedMinutes` → 201 + field returned; get-by-id 200; PATCH→COMPLETED → 200 with `completedAt` auto-set; list 200
- Academic years/semesters create + list (studentOS route `/academics/*`)
- Notes, events, study sessions, goals+milestones, grades, dashboard aggregate, settings (string-only contract), notifications, AI conversation
- 404 for unknown course/task ids; 404 for stale `/academic-years` route (fix verified)

## Bugs found & fixed

| # | Bug | Fix |
|---|-----|-----|
| B1 | Course `instructor` never persisted/returned | added to courses schema + service + response mapper |
| B2 | Task `estimatedMinutes` never persisted/returned | added to tasks schema + service + response mapper |
| B3 | Marking task COMPLETED did not auto-set `completedAt` | `completeTask` now sets status + `completedAt: new Date()` |
| B4 | Expired-token check matched wrong jose error code → wrong 401 | match `ERR_JWT_EXPIRED`; expired tokens → `TOKEN_EXPIRED` |
| B5 | Guard threw a non-HTTP error on missing principal | return `FORBIDDEN` (403) edge instead of 500 |
| B6 | Stale `/academic-years` academic-routes (studentOS had moved to `/academics/*`) | token hygiene + web routes aligned; API returns 404 using `/academics/*` |
| B7 | Web client list helpers pointed at old `/courses/list` etc. | aligned to real REST shape |

## Test results (disk)

- API: 166 passed / 19 files (vitest) — includes `courses.test.ts` asserting `instructor` round-trip and `tasks.test.ts` asserting `estimatedMinutes` + `completedAt` through the routes.
- Web: 43 passed / 7 files (vitest).
- `next build` and `tsc --noEmit` (web + api) pass.

## Remaining (~5%)

1. Regenerate the OpenAPI JSON spec to include `instructor` (courses) and `estimatedMinutes`/`completedAt` (tasks) in `jsonSchema.$defs` — docs artifact only.
2. One final manual browser click-through (form submit → list refresh) on the running app — no browser automation available in this environment.
3. Update `FRONTEND_PROGRESS.md`/README docs to note the two persisted-but-optional fields.

## Decisive probe note (why earlier runs looked failed)

Early probes against the **already-running** API showed `instructor`/`estimatedMinutes` absent because the process had started **before** the schema/service fixes and was serving stale code. After killing and restarting the API from the fixed source, the same probe returns the fields in every response. Contract is intact end-to-end.
