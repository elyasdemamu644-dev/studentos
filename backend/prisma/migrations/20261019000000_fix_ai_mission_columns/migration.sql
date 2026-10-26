-- Migration: Fix AI mission column names (Phase 7 defect)
-- Created: 2026-10-19
--
-- 20261018000000_add_ai_missions created snake_case columns (user_id,
-- conversation_id, ...) while schema.prisma declares camelCase fields with no
-- @map, so the Prisma client failed every real mission query with P2022
-- ("column ai_missions.userId does not exist"). `count()` masked the defect by
-- selecting no columns, and no mission test touched a row, so the suite stayed
-- green. This migration renames the columns to the names the client generates,
-- aligns the index names, foreign keys and the two unique declarations with
-- schema.prisma, and makes dependsOn match `String[] @default([])`.
--
-- Every statement is guarded so the migration can be re-applied after a
-- partial run (the first attempt of this file stopped mid-way on a bad empty-
-- array literal) and so it also applies cleanly on a fresh database in one
-- deploy with the base migration.

-- 1. Column renames (ai_missions, ai_mission_steps)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_missions' AND column_name = 'user_id') THEN
        ALTER TABLE "ai_missions" RENAME COLUMN "user_id" TO "userId";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_missions' AND column_name = 'conversation_id') THEN
        ALTER TABLE "ai_missions" RENAME COLUMN "conversation_id" TO "conversationId";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_missions' AND column_name = 'context_snapshot') THEN
        ALTER TABLE "ai_missions" RENAME COLUMN "context_snapshot" TO "contextSnapshot";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_missions' AND column_name = 'created_at') THEN
        ALTER TABLE "ai_missions" RENAME COLUMN "created_at" TO "createdAt";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_missions' AND column_name = 'updated_at') THEN
        ALTER TABLE "ai_missions" RENAME COLUMN "updated_at" TO "updatedAt";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_missions' AND column_name = 'started_at') THEN
        ALTER TABLE "ai_missions" RENAME COLUMN "started_at" TO "startedAt";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_missions' AND column_name = 'completed_at') THEN
        ALTER TABLE "ai_missions" RENAME COLUMN "completed_at" TO "completedAt";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_missions' AND column_name = 'cancelled_at') THEN
        ALTER TABLE "ai_missions" RENAME COLUMN "cancelled_at" TO "cancelledAt";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_missions' AND column_name = 'terminal_error') THEN
        ALTER TABLE "ai_missions" RENAME COLUMN "terminal_error" TO "terminalError";
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'mission_id') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "mission_id" TO "missionId";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'step_order') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "step_order" TO "stepOrder";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'tool_name') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "tool_name" TO "toolName";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'depends_on') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "depends_on" TO "dependsOn";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'max_attempts') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "max_attempts" TO "maxAttempts";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'idempotency_key') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "idempotency_key" TO "idempotencyKey";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'created_at') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "created_at" TO "createdAt";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'updated_at') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "updated_at" TO "updatedAt";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'started_at') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "started_at" TO "startedAt";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'completed_at') THEN
        ALTER TABLE "ai_mission_steps" RENAME COLUMN "completed_at" TO "completedAt";
    END IF;
END $$;

-- 2. dependsOn must be NOT NULL with a default, matching String[] @default([]).
--    (PostgreSQL spells an empty array '{}'; '[]' is a malformed array
--    literal — that is what stopped the first attempt of this file.)
ALTER TABLE "ai_mission_steps" ALTER COLUMN "dependsOn" SET DEFAULT '{}'::TEXT[];
UPDATE "ai_mission_steps" SET "dependsOn" = '{}' WHERE "dependsOn" IS NULL;
ALTER TABLE "ai_mission_steps" ALTER COLUMN "dependsOn" SET NOT NULL;

-- 3. Index names aligned with what schema.prisma generates (Postgres keeps the
--    old names after the column renames above).
DO $$
BEGIN
    IF to_regclass('public.ai_missions_user_id_status_idx') IS NOT NULL AND to_regclass('public.ai_missions_userId_status_idx') IS NULL THEN
        ALTER INDEX "ai_missions_user_id_status_idx" RENAME TO "ai_missions_userId_status_idx";
    END IF;
    IF to_regclass('public.ai_missions_user_id_updated_at_idx') IS NOT NULL AND to_regclass('public.ai_missions_userId_updatedAt_idx') IS NULL THEN
        ALTER INDEX "ai_missions_user_id_updated_at_idx" RENAME TO "ai_missions_userId_updatedAt_idx";
    END IF;
    IF to_regclass('public.ai_missions_conversation_id_idx') IS NOT NULL AND to_regclass('public.ai_missions_conversationId_idx') IS NULL THEN
        ALTER INDEX "ai_missions_conversation_id_idx" RENAME TO "ai_missions_conversationId_idx";
    END IF;
    IF to_regclass('public.ai_mission_steps_mission_id_step_order_idx') IS NOT NULL AND to_regclass('public.ai_mission_steps_missionId_stepOrder_idx') IS NULL THEN
        ALTER INDEX "ai_mission_steps_mission_id_step_order_idx" RENAME TO "ai_mission_steps_missionId_stepOrder_idx";
    END IF;
    IF to_regclass('public.ai_mission_steps_mission_id_status_idx') IS NOT NULL AND to_regclass('public.ai_mission_steps_missionId_status_idx') IS NULL THEN
        ALTER INDEX "ai_mission_steps_mission_id_status_idx" RENAME TO "ai_mission_steps_missionId_status_idx";
    END IF;
END $$;

-- 4. The two unique declarations in schema.prisma became plain indexes in the
--    original migration. Tables are empty wherever this has run (and empty in
--    production, which applies the base migration and this one in the same
--    deploy), so no de-duplication is needed before adding them.
DROP INDEX IF EXISTS "ai_mission_steps_idempotency_key_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "ai_mission_steps_idempotencyKey_key" ON "ai_mission_steps"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_mission_steps_missionId_stepOrder_key" ON "ai_mission_steps"("missionId", "stepOrder");

-- 5. Foreign-key constraint names aligned with what schema.prisma generates
--    (cosmetic — the client never references constraint names — but keeps
--    future `migrate diff` output free of drift).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_missions_user_id_fkey') THEN
        ALTER TABLE "ai_missions" RENAME CONSTRAINT "ai_missions_user_id_fkey" TO "ai_missions_userId_fkey";
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_missions_conversation_id_fkey') THEN
        ALTER TABLE "ai_missions" RENAME CONSTRAINT "ai_missions_conversation_id_fkey" TO "ai_missions_conversationId_fkey";
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_mission_steps_mission_id_fkey') THEN
        ALTER TABLE "ai_mission_steps" RENAME CONSTRAINT "ai_mission_steps_mission_id_fkey" TO "ai_mission_steps_missionId_fkey";
    END IF;
END $$;
