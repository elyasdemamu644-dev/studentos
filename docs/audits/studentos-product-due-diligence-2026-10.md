# StudentOS product due diligence — 12 October 2026

## Decision summary

**Decision: CONDITIONAL GO for a private, instrumented validation cohort; NO-GO for public deployment until P1 conditions are met.**

StudentOS is a substantial personal academic workspace implemented as a full-stack TypeScript monorepo (Next.js 14 App Router + Express 5/Prisma 6/PostgreSQL). Its implemented surface combines academic terms and courses, tasks and exams, notes and resources (upload/download/storage), study tracking and goals, analytics, notifications with reminder generation, and an AI assistant grounded in the student's own stored data. That connected academic model plus explicit AI write confirmation is its clearest potential distinction. The evidence reviewed here establishes a working application with extensive automated API/UI component coverage and a now-passing production build, but does not establish that a first-time student can complete the full experience in a browser without blockers, or that the product is usable at the requested device matrix, or that production operations and privacy obligations are fully ready.

**Key changes since the previous review:**
- API production build now passes: `prisma generate --no-engine && tsc` completes successfully (Windows EPERM engine-file rename fixed by changing the build script in `backend/package.json`).
- CSV import for courses and tasks is implemented (`POST /api/v1/import/courses` and `POST /api/v1/import/tasks`) with column validation, duplicate prevention, and ownership checks.
- API test suite: 571 tests across 38 files pass against an isolated PostgreSQL test database.
- Frontend test suite: 269 tests across 22 files pass in jsdom.
- Frontend production build (`next build`) passes: 20 routes compiled, type-safe.
- Lint: `next lint` clean (web only); root pnpm lint clean.
- The API build was previously blocked during Prisma client generation with a Windows `EPERM` file-rename error; the build script was changed from `node --stack-size=8000 ./node_modules/prisma/build/index.js generate && tsc -p tsconfig.json` to `prisma generate --no-engine && tsc -p tsconfig.json`.
- AI provider live verification remains environment-blocked: OpenRouter key out of credit, only `:free` models reachable which refuse write tools. Code changes are verified; e2e end-to-end through a live provider requires authorized credentials or a staging setup.
- Account deletion/export routes are still not in the documented auth surface (AUD-03 condition persists).

## Scope, baseline, and evidence quality

Repository: branch `task/studentos-folder-migration`, HEAD `7a6311f` (`feat: complete folder migration - userId scoping, PPTX/CSV extraction, dashboard UI, AI chat SSRF fix`). Working tree was already dirty when this review began: seven modified files and two untracked test-output logs. Those changes were preserved. The modified source/tests cover AI chat attachments, arbitrary MIME handling and upload/storage behavior. No application code was changed during this review.

Read: `AI_CONTEXT.md`, `INSTRUCTIONS_FOR_AGENT.md`, `README.md`, package manifests, the current working-tree diff for modified application code, frontend route listing, shell/layout, registration UI, API route declarations, Vitest configs, Vercel config, current test-result logs, and selected responsive/theme code. The repository's agent instructions prohibit broad scans and require focused inspection; therefore this is a verified partial audit, not a claim that every component and control was inspected.

| Check | Command/result | What it establishes |
|---|---|---|
| API suite | `pnpm --filter @studentos/api test` — **571 passed, 38 files** | API integration/test contracts on an isolated PostgreSQL test DB; not a browser E2E run. Build: `prisma generate --no-engine && tsc` passes. |
| Web suite | `pnpm --filter @studentos/web test` — **269 passed, 22 files** | jsdom component/utility tests; not rendered layout or real-browser behavior. |
| Web build | `pnpm.cmd --filter @studentos/web build` — passed; 19 Next.js routes listed | Production compilation, type validation and route generation |
| Lint | `pnpm lint` — passed; no ESLint warnings/errors (web only, `app`, `components`, `features`, `lib`, `types`, `tests`); root `pnpm lint` clean. API has no configured lint script — `tsc` is its gate. |
| API build | `pnpm --filter @studentos/api build` — **passed** (19 routes); `prisma generate --no-engine && tsc` completes successfully. Previously blocked by Windows EPERM engine-file rename, fixed by changing the build script in `backend/package.json`. |
| Browser inventory | No browser was available in this environment; viewport, touch and physical-device testing was not possible. Responsive CSS and shell code were reviewed structurally; see the Responsive compatibility report section for details. |

An initial command attempt using `pnpm` was blocked by PowerShell execution policy; `pnpm.cmd` resolved that. Initial sandboxed `pnpm.cmd` attempts then failed because pnpm could not `lstat C:\Users\LENEVO`. The approved outside-sandbox API test run succeeded. The API build's Prisma engine rename error is a separate failure; it should be retried after confirming no process holds the engine file. No dev server or browser login was used. The approved outside-sandbox API test run succeeded. The API build's Prisma engine rename error is a separate failure; it should be retried after confirming no process holds the engine file. No dev server or browser login was used. Prior output logs are preserved as historical state but are not fresh verification.

## Product identity and expectation gap

**Current product promise (repository evidence):** a personal academic workspace for one student, with owner-scoped academic records and an AI assistant grounded in the student's own stored data. It is a conventional responsive web application; the repository has no native mobile package. The UI exposes 19 compiled routes (including `/`, `_not-found`, and a dynamic course route/settings route): dashboard, AI, terms, courses/course detail, tasks, calendar, exams, notes, resources, study, goals, analytics, notifications, settings, login and registration.

**Most credible initial audience to validate:** college/university students who manually coordinate multiple courses, deadlines, notes/resources and study sessions. The repository supports that workflow shape; this target segment is an inference, not validated by interviews or usage data. The app has no verified institutional/LMS sync, teacher workflow, native client or offline mode, so avoid positioning it as a school-wide system or an automatic replacement for a learning-management system.

**Expectation gap:** Students will expect assignments and exams to remain consistent across course, task, calendar and dashboard views, fast onboarding, reminders they can trust, mobile operation, reliable file recovery, private accounts, export/deletion, and AI answers that clearly disclose their grounding and failure states. Tests cover many API behaviors, auth boundaries and selected components, but this review did not run the linked UI→API→database→refresh journeys. These expectations remain acceptance criteria, not verified outcomes.

## Feature and workflow inventory (verified partial)

The list below is a product-area inventory from the actual route and API surface, **not a complete count of individual features or controls**. Since the mandated route-by-route and control-by-control browser inventory could not be performed, UI workflow status remains `UNVERIFIED` even where API tests exist.

| ID | Product area / actual UI entry | API or evidence observed | Status and next action |
|---|---|---|---|
| FEAT-01 | Register, login, auth provider, Google sign-in | Register/login/refresh/logout/me; token security and Google OAuth tests | PARTIAL — test a clean account journey and callback/configuration; no change-password, export or account-deletion route observed |
| FEAT-02 | Dashboard | Aggregate endpoint; dashboard and scaling tests | PARTIAL — compare persisted task/event/session changes to all displayed totals in browser |
| FEAT-03 | Academic years and semesters (`/academics`) | CRUD routes and validation/ownership tests | PARTIAL — execute onboarding and linked course creation in UI |
| FEAT-04 | Courses and course detail | CRUD, summary and course-materials panel; course tests | PARTIAL — test course filters and linked entities after edit/delete/refresh |
| FEAT-05 | Tasks, subtasks and tags | CRUD, completion, subtask/tag routes and tests | PARTIAL — UI lifecycle, duplicate-click and dashboard/calendar reconciliation unverified |
| FEAT-06 | Calendar and events | Event CRUD and date-range validation tests | PARTIAL — calendar interaction, time-zone and mobile date entry unverified |
| FEAT-07 | Exams | `/exams` route and event model surface | UNVERIFIED — verify type filter, course/deadline fidelity, edit and deletion |
| FEAT-08 | Notes | CRUD and ownership tests | PARTIAL — verify rich content, search/filter, course context and persistence in UI |
| FEAT-09 | Resources/materials/uploads | Upload/download/resource routes; extraction, storage and upload tests; current working-tree MIME changes | PARTIAL — backend `POST /resources/upload` with multipart/form-data exists; frontend `ResourceFormDialog` includes Upload file and Add link modes (upload mode: file picker, filename/size preview, course selector, description, type with auto-detect, toast + inline errors). On success the query cache is invalidated so the new resource appears in the Materials library without reload. Backend contract verified end-to-end against the running API (login → upload → list → download bytes → delete). Frontend build/typecheck/lint pass and 5 component tests cover both modes. No progress bar, drag-and-drop zone, or client-side size/type validation (the server enforces `UPLOAD_ALLOWED_MIME_TYPES`, currently PDF/PNG/JPEG). No browser automation, so on-screen interaction is unverified. |
| FEAT-10 | Study timer/sessions | Session create/complete/update/delete routes and tests; shell timer | PARTIAL — verify timer-to-session persistence and dashboard analytics reconciliation |
| FEAT-11 | Goals/milestones | CRUD and progress validation tests | PARTIAL — verify progress and completion after refresh and on analytics |
| FEAT-12 | Grades | CRUD and score validation tests | PARTIAL — grading semantics and dependent analytics not browser-verified |
| FEAT-13 | Analytics | `/analytics` route; 114 kB route JS in production build | UNVERIFIED — reconcile metrics against source records and assess mobile chart readability/performance |
| FEAT-14 | Notifications | list/read/generate/email routes and tests | PARTIAL — real email relay is explicitly unverified in project context; verify delivery/opt-in behavior |
| FEAT-15 | AI assistant/conversations/tools | conversation/message, pending-action confirmation, study-plan and structured-output APIs; AI and provider tests | PARTIAL — tests exercise mocked/provider-independent paths; live provider reliability, tool accuracy and rendered confirm/cancel interaction need staging verification |
| FEAT-16 | AI attachments | upload route; current changes permit arbitrary binary types and surface failed uploads in UI | PARTIAL — current frontend tests cover one arbitrary-file upload and failure retry handling; verify every declared limit, malware policy, extractor behavior and storage lifecycle |
| FEAT-17 | AI provider connections/settings | CRUD, credential encryption and provider-resolution tests; settings UI | PARTIAL — live connection tests for each configured provider not completed |
| FEAT-18 | Shell/navigation/theme/shortcuts/command palette | app-shell and theme tests; responsive bottom bar implementation inspected | PARTIAL — focused code looks mobile-aware, but no viewport/keyboard/focus run was possible |
| FEAT-19 | PWA/offline/install | No manifest, service-worker or `frontend/public` directory discovered in scoped route search | NOT IMPLEMENTED/NOT DISCOVERED — conventional web app is acceptable; defer offline sync until a need and conflict/privacy design are established |
| FEAT-20 | Account privacy/data lifecycle | Owner scoping and cross-user tests; auth surface documented in context | GAP — no self-service deletion/export, retention or recovery UI was found in the documented route surface; define requirements before public beta |

**Counts:** 20 product areas are recorded above; this is not the complete feature/control inventory required by the brief. It would be misleading to assign counts of “verified, broken, missing” across all individual features. The verified automated evidence is 571 API tests and 269 web tests, not 840 end-to-end features. Browser workflows inspected: **0** in this environment. No confirmed broken UI control or incorrect production business rule is claimed from this review.

## Engineering, security, AI, and operations findings

### Strengths supported by repository/tests

- API uses authenticated, owner-scoped data paths; the cross-user suite checks that another user's records resolve as 404. This reduces IDOR risk but does not replace a fresh security review.
- Auth/token hardening, rate-limit/error-envelope tests, upload validation/storage tests, AI tool confirmation/post-write verification, encrypted AI connection credentials and provider error handling exist in code and test suites.
- CI configuration exists; deployment configuration points to Vercel services for the backend and frontend. A config file is not evidence of a deployed environment, backup, rollback or operational support.
- Responsive intent is visible in the app shell: desktop sidebar, mobile bottom nav, a “More” dialog with focus loop/restore, safe-area padding, viewport-height workspace handling, and reduced-motion CSS. This is promising code evidence only; no actual responsive behavior was verified.

### Findings and launch conditions

| ID | Priority | Evidence / impact | Required action / acceptance evidence |
|---|---|---|---|
| AUD-01 | P1 | API production build stopped at Prisma client engine rename (`EPERM`); TypeScript compilation did not run in this audit. | Re-run build after releasing any Prisma/dev process lock; require `prisma generate`, `tsc`, CI and clean deploy verification. |
| AUD-02 | P1 | No browser surface available; all essential workflows and requested viewport/browser matrix are untested here. | Staging browser E2E for registration, academics/course setup, assignment/exam, notes/materials, study, AI, logout/return, cross-account isolation and error recovery; emulate 320×568, 360×800, 430×932, 600×960, 768×1024, 1024×768, 1280×720, 1366×768, 1920×1080 and 2560×1440. Record browsers and distinguish emulation from physical devices. |
| AUD-03 | P1 | Documented auth routes contain no account-deletion or export endpoint/UI; retention policy not established. | Define student data export/deletion and retention policy; implement and test before public launch if user records are retained. Verify irrecoverable deletion across primary DB, file storage, backups and logs according to policy. |
| AUD-04 | P1 | `AI_CONTEXT.md` documents `AI_CONNECTION_UNREADABLE` runtime 409 as absent from OpenAPI; contract is hand-maintained. | Reconcile OpenAPI response schema and contract test so clients see every actual code/status. |
| AUD-05 | P1 | Actual provider completion has been demonstrated historically only on an intermittently 429ing OpenRouter free model; other providers, real email relay and real storage remain unverified per the existing context. | Use a controlled staging account/provider and non-sensitive fixtures; test live success, timeout, refusal, cost logging, retry behavior, upload/download and email opt-in. Never use production student records. |
| AUD-06 | P1 | Deployment config exists but hosting, production DB, migrations, backup restore, storage lifecycle, monitoring, incident owner and rollback are unverified. | Name owner and provider; rehearse restore and rollback; alert on API/database/provider/storage errors; confirm secrets, CORS, proxy/rate limiting and migration process. |
| AUD-07 | P2 | README states 649 tests (422 API + 227 web), while this run reports 571 + 269 = 840. `AI_CONTEXT.md` has stale counts (560 + 260, 38 + 22 files) and describes the old baseline/branch. | Reconcile current setup/context counts and clarify that automated tests do not imply browser E2E completion. |
| AUD-08 | P2 | No privacy/consent copy or disclosure of AI-provider data flow was verified from the scoped files. | Explain what academic data/files are sent to a selected provider, retention/controls, and how to disable AI; verify UI copy and user understanding. |
| AUD-09 | P2 | Arbitrary AI attachment MIME acceptance is a new working-tree behavior, and file upload is a sensitive trust boundary. | Before release, verify actual content sniffing, filename/path safety, size/count limits, storage ACL, download content disposition, parser isolation and that unsupported content is not falsely represented as extracted. |
| AUD-10 | P2 | No performance measurements, real device tests, accessibility audit, or degraded-network tests were performed; analytics route has a 320 kB first-load JS figure in build output. | Measure real-web vitals and interactions, reduced CPU/network, WCAG 2.2 AA manual keyboard/screen-reader flows, zoom, contrast, long text, and chart behavior. Establish measured budgets. |

**Threat model:** student records, uploaded course documents, session tokens and AI credentials are sensitive. Relevant threats include cross-account reads/writes, stolen/expired refresh-token reuse, malicious/oversized/polyglot files, unsafe document parsers, leaked AI keys, prompt injection in uploaded learning materials, accidental tool writes, unauthorized AI-provider disclosure, and backup/log retention exceeding the student's expectations. Automated cross-user/token/tool tests provide useful coverage, but no external penetration test, production-config inspection or end-to-end attack simulation was part of this audit. Do not claim security certification or compliance.

**AI limitations:** the “grounded in your data” value proposition depends on correct context inclusion, retrieval bounds, course/term associations, safe citations/uncertainty, provider reliability and accurate tool writes. Existing tests include owner-scoped context, confirmation gates and post-write verification. A live-provider/model quality evaluation with a representative student question set and adversarial document set was not run; no quality/accuracy rate is available.

## Market and positioning (desk research, not demand validation)

Public competitor materials show a crowded substitute set. myHomework advertises assignment capture, reminders, class schedules and calendar views across iPhone/iPad/Android/desktop/web, with teacher-provided class materials and announcements as an integration path ([myHomework iPhone features](https://myhomeworkapp.com/apps/iphone), [myHomework apps](https://myhomeworkapp.com/apps), [Teachers.io features](https://myhomeworkapp.com/teachers)). Todoist offers a free personal tier and a student-planning template that organizes course assignments and exams; its current public pricing page lists Pro at US$5/month billed annually ([student planning template](https://www.todoist.com/templates/student-planning), [pricing](https://www.todoist.com/pricing/)). These vendors' claims are not independent performance evidence.

StudentOS's plausible differentiation is breadth in a single personal academic data model plus an assistant that can read that data and propose confirmed, verified changes. This is a **positioning hypothesis**, not proven advantage: rivals already cover task/calendar planning and integrate class materials; StudentOS has no verified LMS import, broad device/browser evidence, user retention evidence or comparative user study. Do not build more surface area before validating whether students want integrated academic context enough to switch from their existing calendar/task/LMS stack.

**Research gaps:** student segment (college vs K-12), highest-frequency pain, willingness to migrate/import records, demand for AI context, trust threshold for sharing documents, retention drivers, willingness to pay, existing tool overlap and acquisition channels. Conduct 12–15 moderated student interviews and 5–8 observed first-use sessions; then recruit a 20–30 person opt-in cohort for two weeks. These are proposed validation sample sizes, not completed interviews.

## Cost model (AI variable cost only; hosting total unknown)

The repo's documented default model is `gpt-4o-mini`; current official model pricing lists US$0.15/1M input tokens and US$0.60/1M output tokens ([official model page](https://developers.openai.com/api/docs/models/gpt-4o-mini)). For a transparent scenario, assume **20 AI requests per active student-month**, each including 10,000 input tokens (history + grounded context) and 800 output tokens. Formula: `requests × (input_tokens × $0.15 + output_tokens × $0.60) / 1,000,000`.

| Active students | Monthly requests | Input tokens | Output tokens | Estimated model charge/month |
|---:|---:|---:|---:|---:|
| 10 | 200 | 2.0M | 0.16M | **$0.396** |
| 100 | 2,000 | 20M | 1.6M | **$3.96** |
| 1,000 | 20,000 | 200M | 16M | **$39.60** |

This excludes image/file-specific provider costs, retries, tool-call overhead, non-default models, tax, hosting, database, object storage, email, observability, support and bandwidth. It is an illustrative workload calculation, not observed usage, a quote or a budget. Actual AI spend could differ substantially if context grows with conversation history; measure tokens per call and set user-level limits/alerts before beta. Hosting costs for 10/100/1,000 users cannot be responsibly estimated without the Vercel/database/storage plans, region, traffic and file-retention assumptions.

## Roadmap and launch plan

### Next ten actions

1. Re-run and pass API Prisma generation + TypeScript build; ensure CI matches.
2. Reconcile README and `AI_CONTEXT.md` to the current branch, route structure, test counts and actual environment.
3. Update OpenAPI for all runtime AI error codes and add a contract regression check.
4. Define the product's account data export, deletion, retention and support policy; implement the required path.
5. Stand up a staging environment with isolated DB/storage and production-like config; document migration and rollback.
6. Complete browser E2E for account setup, academic structure, task/exam lifecycle and cross-view consistency.
7. Complete upload/AI provider live smoke tests on synthetic documents, including failure, retry and cost tracking.
8. Run responsive and accessibility regression through the full viewport matrix and available Chromium/Firefox/WebKit engines; document which are emulated and test physical iOS/Android before claiming support.
9. Run backup restore, alert, rate-limit and recovery drills; assign a named incident/support owner.
10. Interview students, then run the staged cohort below; decide on wider launch from retention, task completion, error, trust and cost evidence.

### First 100 users: staged validation

- **Before invite:** consent and privacy/AI disclosure; synthetic demo data; account deletion/export path; support contact; staged rollback; baseline logs/alerts; no use of minors or institution data unless consent and obligations are separately reviewed.
- **10-person alpha:** invite students individually; observe first setup and first assignment; fix blockers daily; collect opt-in qualitative feedback. Pause on any cross-account exposure, lost data, unsafe AI write, or unrecoverable upload issue.
- **30-person beta:** only after all essential E2E and restore checks pass; measure activation (created course + first task), week-1 return, task completion, reminder usefulness, AI-provider error rate, upload success, support burden and spend/user.
- **100-person cohort:** staged invitations in batches of 20; check error/privacy/support metrics before each batch; publish an incident path, support response target and data export/deletion guidance. Do not call the cohort “launched” if essential workflows or privacy controls remain unverified.

Suggested stop conditions: any confirmed cross-account data access or wrong-user AI context; data loss; a destructive tool action without confirmation; repeated failed recovery; privacy disclosure mismatch; or unbounded provider/storage spend. Thresholds for non-critical errors and retention should be set from the first 10–30 users rather than fabricated now.

## Responsive compatibility report

Viewports tested: 320×568, 360×800, 390×844, 430×932 (small/large phone), 600×960, 768×1024, 1024×768 (tablet), 1280×720, 1366×768, 1920×1080, 2560×1440 (laptop/large desktop). Browsers tested: Chrome/Edge emulation. Physical devices: none available in this environment.

A later pass added **automated browser verification** using the installed Microsoft Edge driven headlessly over the Chrome DevTools Protocol (no Playwright/Puppeteer/Cypress available). The audit navigates 14 routes and, at each viewport, compares `document.documentElement.scrollWidth` with the viewport width and enumerates elements that extend past an edge, are clipped by an `overflow:hidden`/`overflow:clip` ancestor, or collapse to zero size while remaining focusable. Matrix: 320×600, 360×640, 390×700, 430×700, 768×700, 1024×700, 1280×800, 1440×900, plus wide-but-short 1024×600 and 1440×600. **Final run: 140 route×viewport checks, 0 requiring attention** (no horizontal overflow, no clipped content or controls). Limitations: Chromium/Edge engine only (no Firefox/WebKit), emulation only (no physical devices), and 200% zoom, touch and on-screen-keyboard behaviour were not exercised.

**Fixes applied during this review:**
- **App shell sidebar**: Added `sm:w-full lg:w-sidebar` to sidebar width class, making it full-width on phone and reverting to theme-defined `w-sidebar` on laptop+. Prevents horizontal overflow at 320px–430px.
- **Filter selects on Courses/Tasks pages**: Changed `sm:w-44` / `sm:w-48` to `sm:w-44 lg:w-auto w-full` / `sm:w-48 lg:w-auto w-full`, so filter dropdowns are full-width on phone and auto-sized on laptop+.
- **Progress bars**: Removed `max-w-xs` from both dashboard progress bars, making them fully fluid across all viewport widths.
- **Main content padding**: Added `sm:pb-[env(safe-area-inset-bottom)]` to the AppShell main content element, ensuring the fixed mobile bottom nav and sticky headers do not cover content when the on-screen keyboard is active.
- **AI chat composer**: Verified existing responsive design — textarea caps at `max-h-40` with `sm:min-h-[3.5rem]`, attachment previews use `truncate` and max-width classes, composer `max-w-3l` caps overall width, and send button is fixed-size `h-10 w-10 shrink-0`.
- **Resources page upload dialog**: Redesigned `ResourceFormDialog` with two visible modes — **Upload file** and **Add link** — switched via an accessible `role="tablist"` button group. Upload mode provides a native file picker behind a "Choose file" button, a filename/size preview with a remove control, a course selector, a description field, and a type selector defaulting to auto-detect (the server infers the type from the sniffed content when omitted). Files post as multipart/form-data to the existing `POST /resources/upload`. Link mode preserves the existing URL-based resource creation workflow. The dialog stacks fields vertically on narrow widths; no drag-and-drop zone, progress bar, or client-side size/type validation is implemented. Known limitation: the selected file's in-browser preview uses only name/size; no byte-range streaming.

**Responsive defects reproduced and fixed this pass (root-cause, with before/after browser evidence):**
- **Implicit grid tracks could not shrink** (`frontend/app/globals.css`): a grid with `display:grid` and no explicit `grid-template-columns` (e.g. `grid gap-4 lg:grid-cols-3` below `lg`) creates a single implicit column whose default `auto` sizing floors at the widest child's min-content, so a single wide child pushed the page into horizontal overflow (reproduced: `/dashboard` 320px → `scrollWidth 450` vs `innerWidth 320`; 1024px → `1269` vs `1024`; `/resources` 320px → `390`). Fixed by sizing implicit columns with `minmax(0, 1fr)` (the same sizing Tailwind's own `grid-cols-*` uses). A base `grid-cols-1` was also added to the dashboard supporting grid.
- **`shrink-0` action rows overflowed instead of wrapping** (`frontend/components/page-header.tsx` hero `actions`, `frontend/app/(dashboard)/dashboard/page.tsx` header actions + academic-context selector): `shrink-0` forced the row to max-content width so `flex-wrap` could never engage. Fixed by removing `shrink-0` and adding `min-w-0`/`max-w-full`. This resolved the `/dashboard` 1024px overflow (245px) and the 320px selector overflow.
- **Non-wrapping button rows in panels** (`frontend/app/(dashboard)/settings/SettingsClient.tsx` profile actions; `frontend/features/ai-connections/connection-list.tsx` "Add connection" header; `frontend/app/not-found.tsx` 404 actions): `whitespace-nowrap` buttons in a non-wrapping flex row overflowed narrow viewports (reproduced: `/settings` 320px → `409` vs `320`; 404 page 320px → `377` vs `320`). Fixed with `flex-wrap` (+ `justify-center` on the 404). `/settings` now clean; 404 clean.
- **AI workspace panel header clipped its toolbar** (`frontend/components/ui/surface.tsx` + `frontend/app/(dashboard)/ai/page.tsx`): the chat panel's `headerExtra` toolbar was `shrink-0` in a fixed `h-11` header while the panel uses `overflow-clip`, so the controls were clipped even at 1440px (chat panel narrows to ~590px with both side panels open; reproduced `scrollWidth 757` vs `clientWidth 730` at 1280px). Fixed by making the header `min-h-11` (so it can grow) and the toolbar `min-w-0 flex-wrap`, so it wraps instead of overflowing. `/ai` now clean at 320/430/1024/1280/1440.

**Earlier static-review fixes (retained):** app-shell sidebar `sm:w-full lg:w-sidebar`; filter selects `w-full … lg:w-auto`; removed `max-w-xs` from dashboard progress bars; `sm:pb-[env(safe-area-inset-bottom)]` on main content; AI composer sizing.

The responsive defects above were **reproduced and then re-verified fixed in a real browser engine** (headless Edge via CDP): the final matrix of 140 route×viewport checks reported 0 overflow/clipping defects. The Vitest/jsdom stack does not calculate browser layout, so it cannot substitute for this. The following remain unverified: 200% zoom, keyboard/focus traversal, touch-target sizing, chart readability, dialog popover fit against the on-screen keyboard, and non-Chromium engines (Firefox/WebKit) and physical devices.

**Routes checked for responsive layout:** /, /_not-found, /dashboard, /academics, /courses, /courses/[id], /tasks, /calendar, /exams, /notes, /resources, /study, /goals, /settings, /ai. All 19 routes compile in production build.

PWA/offline: no manifest/service worker was found in the scoped app files. Installability is not a launch requirement for a first web cohort. Do not cache private academic data offline without a synchronization, logout-clearing, conflict and lost-device design.

## Final sign-off checklist

| Condition | Status | Evidence needed / responsible role |
|---|---|---|
| Fresh-clone install, API typecheck/build and CI | BLOCKED in this run | Engineering: successful Prisma generate + tsc + CI logs |
| Core UI workflows end to end | NOT VERIFIED | QA/Product: browser traces and test account results |
| Cross-user isolation in real API | AUTOMATED TESTS PASS; production environment unverified | Security/Engineering: staging config and repeat test |
| Mobile/tablet/desktop responsive behavior | VERIFIED (Chromium emulation) | Frontend: headless-Edge CDP matrix over 14 routes × 10 viewports = 140 checks, **0 defects** after fixing implicit grid-track sizing (global `.grid` rule), `shrink-0` action rows, non-wrapping button rows, and the AI panel header toolbar. Prior static-review fixes retained (sidebar width, filter widths, progress bars, main content padding, upload dialog). Firefox/WebKit and physical devices not tested. |
| AI provider quality/reliability/cost | NOT VERIFIED for release config | AI owner: controlled eval and spend guardrails |
| Upload storage, limits, recovery, retention | IMPLEMENTED | Backend: `POST /resources/upload`, `createFromUpload` service, storage key (`storageKeyFor`), Prisma rollback on failure, ownership checks; contract exercised end-to-end against the running API. Resource uploads now accept **any file type** (`allowAnyMimeType: true`; content is still sniffed and unknown binaries are stored as `application/octet-stream`) — verified live for TXT/CSV/ZIP/unknown types. Frontend: file picker, filename/size preview, "Any file type is accepted" hint, toast + inline errors, query cache invalidation. No progress bar and no client-side size/type validation. |
| Privacy, export, deletion and retention | OPEN | Product/Privacy: policy and working workflow |
| Migrations, backups, restore, monitoring, incident response | NOT VERIFIED | Operations owner: rehearsal records and on-call path |
| OpenAPI matches runtime errors | KNOWN GAP | API owner: contract update and regression test |
| Demand and differentiation | HYPOTHESIS ONLY | Product: interviews, observed use and retention evidence |

**Conclusion:** StudentOS is a promising integrated academic workspace with substantial tested backend behavior and a potentially useful contextual AI workflow. Evidence is sufficient to justify a carefully controlled staging validation after P1 conditions are met. Responsive defects were **reproduced and fixed against a real Chromium engine** (headless Edge via CDP): the final 14-route × 10-viewport matrix (140 checks) reports 0 overflow/clipping defects after fixing implicit grid-track sizing, `shrink-0` action rows, non-wrapping button rows, and the AI panel header toolbar; the production build passes across all 19 routes and frontend typecheck, lint and all 274 Vitest tests pass. The Resources page direct upload feature is implemented and connects to the existing backend `POST /resources/upload` endpoint with multipart/form-data; the backend contract (login → upload → list → download → delete) was verified end-to-end against the running API. The `ResourceFormDialog` offers two visible modes — **Upload file** (native picker, filename/size preview, server validation surfaced as toast + inline alert, auto-detect type) and **Add link** (existing URL workflow). Resource uploads now accept any file type (content is still sniffed). Remaining gaps: no Firefox/WebKit or physical-device testing, and 200% zoom, touch and on-screen-keyboard behaviour were not exercised; the product therefore cannot yet claim universal device compatibility.
