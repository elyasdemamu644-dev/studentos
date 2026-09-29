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
| **Tests** | 338 passing — 261 API (integration, real DB) + 77 web (jsdom) |

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

# Option A — push (fast, schema-only, no history):
pnpm --filter @studentos/api db:push

# Option B — migrations (versioned history, recommended for teams):
# prisma migrate dev creates `prisma/migrations/` from `schema.prisma`.
# For an existing database with a baseline already recorded, use:
pnpm --filter @studentos/api db:generate   # prisma generate
# then mark the existing baseline as applied:
npx prisma migrate resolve --applied 20260926004652_baseline

pnpm --filter @studentos/api db:seed     # optional: demo data
pnpm --filter @studentos/api db:migrate  # future schema changes go here
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
pnpm test         # full suite, 338 tests
```

Per package:

```bash
pnpm --filter @studentos/api dev|build|start|test|test:watch
pnpm --filter @studentos/web dev|build|start|lint|test
```

Database:

```bash
pnpm --filter @studentos/api db:generate   # prisma generate
pnpm --filter @studentos/api db:push       # prisma db push  (schema is not versioned)
pnpm --filter @studentos/api db:migrate    # prisma migrate dev
pnpm --filter @studentos/api db:seed       # destructive demo seed
```

Type-check the web app alone: `npx tsc --noEmit` in `apps/web`.

## Configuration

`apps/api/.env` — only `DATABASE_URL` and `JWT_SECRET` are strictly required to boot; `validateConfig()` throws with a clear message if anything mandatory is missing.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | **required** — PostgreSQL connection string |
| `JWT_SECRET` | — | **required** — HS256 signing secret; use a long random value in production |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | API bind address |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated allowlist |
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

`docs/api/openapi.yaml` is **stale** — it documents only a subset of the surface. Treat the code as authoritative; see `AI_CONTEXT.md` §13.

Baseline migration: `apps/api/prisma/migrations/20260926004652_baseline/` — recorded 2026-09-26. New databases: push schema, then `npx prisma migrate resolve --applied 20260926004652_baseline`.

## Testing notes

- API tests are **integration tests against a real PostgreSQL database** — no database, no result. They use `TEST_DATABASE_URL` (default `postgresql://postgres@localhost:5432/studentos_test`).
- Each API test file truncates all tables on setup, so **never run two API suites concurrently** — they will deadlock.
- Web tests run in jsdom via Vitest and Testing Library; they need no database.

## Project layout

```
apps/api        Express REST API + Prisma (tests/ at apps/api/tests)
apps/web        Next.js web app (tests/ at apps/web/tests)
packages/shared Shared Zod schemas and types
docs/           api/ (stale OpenAPI spec) + audits/ (archived historical reports)
scripts/        Repository maintenance scripts
```
