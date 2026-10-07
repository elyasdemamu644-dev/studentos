# StudentOS

A personal academic operating system — one place for academic years, courses, tasks, exams, notes, resources, study sessions, goals, grades and notifications, with an AI assistant grounded in your own data.

Full-stack TypeScript monorepo: **Next.js 14** web app + **Express 5 / Prisma / PostgreSQL** REST API + a shared **Zod** schema package.

> **Working on this repo with an AI agent?** Read **[AI_CONTEXT.md](AI_CONTEXT.md)** — it is the verified source of truth for architecture, conventions, commands and current state. Agent workflow rules are in **[INSTRUCTIONS_FOR_AGENT.md](INSTRUCTIONS_FOR_AGENT.md)**. This README is for humans setting up and running the project.

## Stack

| | |
|---|---|
| **Web** | Next.js 14.2.30 (App Router), React 18, TypeScript `strict`, Tailwind CSS 3.4, Radix UI, TanStack Query v5, react-hook-form + Zod, Recharts |
| **API** | Express 5, TypeScript (ESM), Prisma 6, Zod, `jose`, `@node-rs/argon2` |
| **Database** | PostgreSQL |
| **Shared** | `@studentos/shared` — Zod schemas and cross-app types |
| **Tooling** | pnpm workspaces + Turborepo, Vitest, ESLint (`next lint`) |
| **Tests** | 649 passing — 422 API (integration, real DB) + 227 web (jsdom) |

## Requirements

- **Node.js** and **pnpm 9** (`corepack enable` if needed)
- **PostgreSQL** running locally, reachable on `localhost:5432`

No `engines` field is declared in any `package.json`, so no minimum Node version is pinned by the repo. The suite was last verified green on **Node 24.20.0 / pnpm 9.15.0**.

## Setup

```bash
pnpm install

cp apps/api/.env.example apps/api/.env
# edit apps/api/.env — at minimum set DATABASE_URL and JWT_SECRET

cp apps/web/.env.local.example apps/web/.env.local

pnpm --filter @studentos/api db:generate   # prisma generate

# create the schema from migrations — works on an empty database too:
npx prisma migrate deploy        # run from apps/api

pnpm --filter @studentos/api db:seed     # optional: demo data (destructive)
pnpm --filter @studentos/api db:push     # schema-only escape hatch, no history
pnpm --filter @studentos/api db:migrate  # create a migration for a schema change
```

The seed creates `demo@studentos.dev` / `StudentPass123!`. **It deletes all existing rows first.**

Start both apps:

```bash
pnpm dev
```

| Service | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Health check | http://localhost:3001/health |

## Commands

Run from the repository root:

```bash
pnpm dev          # both apps in parallel
pnpm build        # API tsc + Web next build
pnpm lint         # web only — the API has no linter
pnpm test         # full suite, 649 tests
```

Per package:

```bash
pnpm --filter @studentos/api dev|build|start|test|test:watch
pnpm --filter @studentos/web dev|build|start|lint|test
```

Database:

```bash
pnpm --filter @studentos/api db:generate   # prisma generate
pnpm --filter @studentos/api db:push       # prisma db push  (escape hatch, no history)
pnpm --filter @studentos/api db:migrate    # prisma migrate dev (needs a shadow DB)
pnpm --filter @studentos/api db:seed       # destructive demo seed
```

Type-check the web app alone: `npx tsc --noEmit` in `apps/web`.

## Configuration

`apps/api/.env` — only `DATABASE_URL` and `JWT_SECRET` are strictly required to boot; `validateConfig()` throws with a clear message if anything mandatory is missing. With `NODE_ENV=production` it additionally refuses to start on a placeholder or short (<32 char) `JWT_SECRET`/`ENCRYPTION_KEY`, or when `CORS_ORIGINS` was never set (the localhost default would block a real web origin).

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | **required** — PostgreSQL connection string |
| `JWT_SECRET` | — | **required** — HS256 signing secret; 32+ random characters in production |
| `ENCRYPTION_KEY` | — | encrypts stored AI connection credentials; 32+ random characters in production |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | API bind address |
| `TRUST_PROXY` | `0` | hops to trust (`1` behind nginx/ALB) so rate limiting keys on the real client IP |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated allowlist; **set it explicitly in production** |
| `AI_ENABLED` | `true` | set `false` to disable AI generation |
| `OPENAI_API_KEY` | — | required at boot when AI is enabled |
| `AI_MODEL` | `gpt-4o-mini` | any OpenAI-compatible model |
| `OPENAI_BASE_URL` | `https://api.openai.com` | point at a compatible endpoint |

`apps/web/.env.local`

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api/v1` | API base URL |

## API

Base path `/api/v1`; success is `{ success: true, data }` and failure is `{ success: false, error: { code, message } }`. Everything except `/health` and `/auth/{register,login,refresh,logout}` needs `Authorization: Bearer <access token>`.

Resources: auth, academics (years + semesters), courses, tasks (+ subtasks, tags), dashboard, notes, resources, events, study sessions, goals (+ milestones), grades, notifications, settings, and the AI assistant (conversations, messages, study plans).

`docs/api/openapi.yaml` is the OpenAPI 3.1.1 contract for the whole surface (60 paths / 111 operations, regenerated 2026-10-07). It is derived from the code by hand, so the code remains authoritative on any conflict.

Migrations live in `apps/api/prisma/migrations/` — `20261006000000_init_from_schema` (the whole schema) and `20261007000000_add_owner_indexes`. `npx prisma migrate deploy` applies them from empty and is the command to use in production; `prisma migrate status` reports "Database schema is up to date!".

## Production run-book

```bash
pnpm install --frozen-lockfile
pnpm --filter @studentos/api build          # typecheck gate (dist/ is not the runtime)
cd apps/api && npx prisma migrate deploy    # applies migrations, safe from empty
pnpm --filter @studentos/api start          # tsx src/server.ts
curl -fsS http://localhost:3001/health       # {"database":"connected"} or HTTP 503
```

`NODE_ENV=production` + 32+ character `JWT_SECRET`/`ENCRYPTION_KEY` + an explicit `CORS_ORIGINS` are enforced at boot. The server fails fast if the database is unreachable, handles `EADDRINUSE`, and shuts down on `SIGTERM`/`SIGINT` (10 s force exit). `/health` pings the database and answers `503` when it is down.

## Testing notes

- API tests are **integration tests against a real PostgreSQL database** — no database, no result. They use `TEST_DATABASE_URL` (default `postgresql://postgres@localhost:5432/studentos_test`).
- Each API test file truncates all tables on setup, so **never run two API suites concurrently** — they will deadlock.
- Web tests run in jsdom via Vitest and Testing Library; they need no database.

## Project layout

```
apps/api        Express REST API + Prisma (tests/ at apps/api/tests)
apps/web        Next.js web app (tests/ at apps/web/tests)
packages/shared Shared Zod schemas and types
docs/           api/ (OpenAPI 3.1.1 contract) + audits/ (archived historical reports)
scripts/        Repository maintenance scripts
```
