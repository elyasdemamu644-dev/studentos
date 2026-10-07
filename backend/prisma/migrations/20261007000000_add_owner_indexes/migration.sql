-- Add indexes for the owner-scoped read paths.
--
-- Every query in the API filters by owner first, then narrows by status,
-- sorts by a date, or walks a parent/child list. Without these the whole
-- table is scanned per request. Created by hand: `prisma migrate dev`
-- needs a shadow database, which is unreachable in this environment
-- (P1001), while `prisma migrate deploy` — the production command — does
-- not. Verified against an empty database in the Phase 3 check.

-- Refresh tokens: logout / cleanup by owner.
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- Academic structure: list by owner, newest start date first.
CREATE INDEX "academic_years_userId_startDate_idx" ON "academic_years"("userId", "startDate");
CREATE INDEX "semesters_userId_startDate_idx" ON "semesters"("userId", "startDate");

-- Courses: owner-scoped list filtered by status.
CREATE INDEX "courses_userId_status_idx" ON "courses"("userId", "status");

-- Tasks: dashboard totals and status filters, plus upcoming/overdue by due date.
CREATE INDEX "tasks_userId_status_idx" ON "tasks"("userId", "status");
CREATE INDEX "tasks_userId_dueDate_idx" ON "tasks"("userId", "dueDate");

-- Children read in declared order.
CREATE INDEX "task_subtasks_taskId_position_idx" ON "task_subtasks"("taskId", "position");
CREATE INDEX "goal_milestones_goalId_position_idx" ON "goal_milestones"("goalId", "position");

-- Content lists, newest first.
CREATE INDEX "notes_userId_updatedAt_idx" ON "notes"("userId", "updatedAt");
CREATE INDEX "resources_userId_createdAt_idx" ON "resources"("userId", "createdAt");
CREATE INDEX "grades_userId_recordedAt_idx" ON "grades"("userId", "recordedAt");

-- Calendar and study history, ordered by time.
CREATE INDEX "events_userId_startAt_idx" ON "events"("userId", "startAt");
CREATE INDEX "study_sessions_userId_startedAt_idx" ON "study_sessions"("userId", "startedAt");

-- Goals filtered by status; AI lists newest first.
CREATE INDEX "goals_userId_status_idx" ON "goals"("userId", "status");
CREATE INDEX "ai_conversations_userId_updatedAt_idx" ON "ai_conversations"("userId", "updatedAt");
CREATE INDEX "ai_study_plans_userId_updatedAt_idx" ON "ai_study_plans"("userId", "updatedAt");
