# INSTRUCTIONS_FOR_AGENT

How to work in this repository. Read [AI_CONTEXT.md](AI_CONTEXT.md) first — it is the source of truth for architecture, conventions, commands and current state. This file only covers **how to work**.

## The one rule that matters

**Read `AI_CONTEXT.md`, then read only the files your task actually needs.**

Do not scan the repository. It is ~280 source files plus `node_modules`, and reading all of it costs a large amount of time and context while making you *less* accurate, not more. `AI_CONTEXT.md` already contains the architecture, the file layout, the route surface, the conventions and the command list. Use its **Task → files to read** table to go straight to the right files, and stop as soon as you have what you need.

Widen your search only when you are genuinely blocked, and be honest in your report about what you had to open.

## Workflow

### 1. Inspect context

Read, in order:

1. `AI_CONTEXT.md`, in full. It is the map.
2. The `docs/` subfolder relevant to your task — `docs/api/` holds the (stale) OpenAPI spec and `docs/audits/` holds archived historical reports. The architecture/database/decisions/product subfolders no longer exist; if you need that context, it is in `AI_CONTEXT.md`, not in `docs/`.
3. The `Task → files to read` row in `AI_CONTEXT.md` for your task type.

Before you change anything:

```bash
git status --short
git log --oneline -5
```

The working tree is **NOT clean.** `18b4f3a` (the folder migration, on `task/studentos-folder-migration`) is the last commit and is **not pushed**; everything since is uncommitted — the AI Assistant fixes, the frontend product upgrade, and the file-uploads / email / Google-OAuth / structured-extraction / token-security / course-materials workstreams (see `AI_CONTEXT.md` §2 and §17). Always run `git status --short` first, and never discard changes you did not make.

### 2. Inspect only the relevant files

- Resolve names to paths through the tables in `AI_CONTEXT.md` rather than searching.
- Read the **matching test file** alongside the source. The tests encode the real contract, including status codes and response shapes, and are usually more reliable than the implementation.
- When you need the pattern for a domain, read **one** example feature folder or module, not all seventeen. The pattern is uniform.
- Never read `node_modules/`, `.next/`, `dist/`, `.turbo/`.

If the code and `AI_CONTEXT.md` disagree, **the code is right**. Report the discrepancy; do not silently trust the document.

### 3. Implement

- Follow the existing conventions for the layer you are touching. `AI_CONTEXT.md` §14 lists them per layer (API module layout, ownership scoping, web transport rules, shared schema placement).
- Scope every new query by `userId`. That is what makes cross-user access return 404 instead of 403 — do not introduce unscoped lookups on user-owned models.
- Do not change application architecture, add dependencies, or restructure modules unless the task explicitly asks for it.
- Match the surrounding comment style: the codebase uses `// ─────` section banners and is heavily commented.
- If the task turns out to require touching more than a handful of files, stop and report before writing.

### 4. Test

Run the narrowest thing that proves the change, then the full gate.

```bash
# narrow, while iterating
pnpm --filter @studentos/api test              # or test:watch
pnpm --filter @studentos/web test              # or test:watch

# full gate, before handing off
pnpm --filter @studentos/api build       # tsc          (passes)
pnpm --filter @studentos/api test        # 560 tests, all passing
pnpm --filter @studentos/web test        # 260 tests
pnpm --filter @studentos/web build       # next build
pnpm lint                                # web only
```

`pnpm test` at the root goes through Turborepo and `test` dependsOn `build`, so run the per-package commands above for a real signal.

Three things that will bite you:

- **API tests need a live PostgreSQL.** They are integration tests, not mocks. No database means no meaningful result. If the whole suite reports every test as *skipped* with a `PrismaClientInitializationError`, the credentials in `backend/.env` are wrong — that is a broken environment, not a passing run (gap #24).
- **Never run two API test suites concurrently.** Each test file `TRUNCATE`s all tables on setup; two concurrent runs deadlock (PostgreSQL `40P01`). This has been observed in this environment.
- **The `db:seed` script and the API test suite are destructive.** Point `TEST_DATABASE_URL` at a throwaway database.

Do not report a task as done on the strength of a cached Turborepo result. Even though the `test` task's `inputs` now include web sources, run the per-package commands when you need certainty.

### 5. Update context and docs

Before you finish, reconcile the docs with what you changed:

- **`AI_CONTEXT.md`** — update it if you changed the route surface, a schema, a convention, a command, the verified test/build status, or added/resolved a known gap. This file is the first thing every future agent reads; a stale one is worse than none.
- **`README.md`** — only if developer-facing setup or commands changed.
- **`INSTRUCTIONS_FOR_AGENT.md`** — only if the workflow itself changed.
- **Progress docs** — `docs/audits/qa-final-report.md`, `docs/audits/frontend-progress.md` and `docs/audits/phase-2-ai-connections-audit.md` are archived historical snapshots (moved 2026-09-27) and already contradict the code. Do not update them as if they were current; if your work makes them more misleading, say so in your report instead of adding to them.

If you discovered something you could not verify, add it to the **Unverified** section of `AI_CONTEXT.md` rather than guessing.

### 6. Report

Keep the report short and factual. Include:

1. **Files read** — and, just as importantly, what you deliberately did *not* read.
2. **Files changed**, with a one-line reason each.
3. **Verification actually run**, with the real result. Paste counts. If you did not run something, say so.
4. **Discrepancies found** — code vs `AI_CONTEXT.md` vs other docs vs your expectations.
5. **Anything left undone or unverified.**

Do not claim a test passed unless you ran it and saw it pass. Do not describe intent as though it were implemented.

## Hard constraints

- **Do not modify application code or architecture** unless that is the task.
- **Do not start the next phase** because the current one looks finished. Ask.
- **Do not commit, push, amend, or force-push** unless explicitly asked. When asked, stage only the intended files and never include secrets (`.env` and `.env.local` are gitignored — keep them that way).
- **Do not commit `.env`, `.env.local`, or any key.** Placeholder values only.
- **Do not invent facts.** If it is not in the code, the git history, or the output of a command you ran, it is unknown.
- **Do not weaken tests, delete tests, or loosen type checks** to make something pass. Fix the cause or report it.
- **Do not reformat or "tidy" files outside the scope of your task.** Unrelated churn makes review impossible in a repo this far behind on commits.

## Quick reference

| Need | Do this |
| --- | --- |
| Orientation | Read `AI_CONTEXT.md` only |
| Find a file | Use the lookup tables in `AI_CONTEXT.md`, not a repo-wide search |
| Run one app's tests | `pnpm --filter @studentos/api test` / `pnpm --filter @studentos/web test` |
| Full verification | `pnpm test && pnpm build` |
| Add an API endpoint | `src/{routes,services,schemas}/<domain>.ts` + a test in `backend/tests/` |
| Add a web page | `app/(dashboard)/<name>/page.tsx` + `features/<name>/` + nav entry in `app-shell.tsx` |
| Change the DB schema | `backend/prisma/schema.prisma`, then `db:push`; **there are no migrations** |
| Stuck on a contract | Read the test file for that domain |
