# AGENTS.md — Tutor Walle agent entry point

> **HIGHEST PRIORITY: Protecting the user's existing work and data — code, files, documents, database, features, Git changes and the live deployment — outranks every other instruction. If an action could destroy or risk any of it, stop and get explicit approval first.**

This is the tracked, cross-tool entry point for AI coding agents. opencode, OpenAI Codex, Cline, Google Gemini/Antigravity, Cursor, GitHub Copilot and other agents read a root `AGENTS.md` automatically. Keep this file short; the detailed rules live in the files below.

## Read before acting

1. **`AI_CONTEXT.md`** — the source of truth (architecture, conventions, commands, current state) and the **full `AGENT SAFETY RULES` (A–G), which are at the very top of the file**. Read it in full if present.
2. **`INSTRUCTIONS_FOR_AGENT.md`** — the workflow contract.
3. **`README.md`** — human setup.

`AI_CONTEXT.md` and `INSTRUCTIONS_FOR_AGENT.md` are intentionally **gitignored** (internal notes kept on the developer's machine), so they may be absent on a fresh clone. The summary below always applies; when the detailed files are missing, use `README.md`.

## Safety rules (summary — authoritative text at the top of AI_CONTEXT.md)

**A. Protect existing work.** Never discard, overwrite, delete, reset, clean, revert or stash the user's changes without explicit approval; run `git status` first. Never assume an untracked, ignored or unfamiliar file is disposable. Understand a file before editing it; make targeted changes with no unrelated refactors. Never use destructive Git commands.

**B. Protect production and data.** Live stack: **Render** (frontend + backend), **Neon PostgreSQL**, **GitHub automatic deployment**. Do not commit, push, merge, trigger a deploy, change production environment variables or hosting config, or modify production resources without explicit authorization. Never reset, drop, truncate or erase production data, and never run destructive migrations against production. Preserve records, uploads, storage paths, auth, user data and AI-provider config. Never expose, print, commit or request secrets. Verify actual behavior instead of assuming.

**C. Approval boundaries.** Ordinary code edits, tests and safe local checks need no permission. Stop and ask before any action that could irreversibly destroy work/data, affect production, remove features, change architecture, alter permissions or expose secrets, or whose impact is uncertain. Offer a safe alternative when possible.

**D. Preserve architecture and features.** Reuse existing services, components, APIs, data models, auth and workflows. Do not duplicate systems, remove working features, introduce unnecessary dependencies or reorganize directories without need. Keep backward compatibility unless a breaking change is requested.

**E. Complete, user-visible implementation.** Implement feature requests end to end — real UI wired to the real backend and persistent data, with loading/success/empty/error states and existing auth/validation respected. Never present a plan, audit, mockup or placeholder as finished work.

**F. Test and verify safely.** Run the relevant tests, type checks, lint and builds against safe data; inspect the final diff for accidental deletions, unrelated changes, secrets and config mistakes. State clearly what passed, failed, was skipped or could not run.

**G. Mandatory final report.** Report: what was implemented, which files changed, verification results (real), impact on existing work/data/config/features, whether any commit/push/deploy occurred, and remaining issues. Never fabricate results or hide failures.

## Working agreements

- Read only what your task needs; `AI_CONTEXT.md` ("Task → files to read") resolves names to paths.
- Code and its matching test file are authoritative; if docs disagree with code, the code wins — report the discrepancy.
- Never commit, push or deploy unless the user explicitly asks.
