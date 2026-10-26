-- Migration: Add ai_mission_steps.pendingActionId
-- Created: 2026-10-21
--
-- A mission step that performs a write in manual mode cannot run until the
-- student approves the proposal. Until now the step simply parked itself in
-- WAITING with no pointer to the proposal it was waiting on, so:
--
--   * the mission had no way to tell the student what to approve,
--   * a resumed mission could not reconcile the proposal's outcome, and
--   * the approval endpoint had nothing to claim.
--
-- This adds the nullable pointer. It is deliberately a plain string rather
-- than a relation: `ai_pending_actions` is owned by the confirmation flow and
-- is deleted with its conversation, while a mission step must survive that
-- cascade and keep an honest record of what it was waiting for.
--
-- Every statement is guarded so the migration can be re-applied after a
-- partial run and so it applies cleanly on a fresh database.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ai_mission_steps' AND column_name = 'pendingActionId'
    ) THEN
        ALTER TABLE "ai_mission_steps" ADD COLUMN "pendingActionId" TEXT;
    END IF;
END $$;

-- Lookup by proposal: the mission resume path finds the steps waiting on a
-- given pending action without scanning the whole table.
CREATE INDEX IF NOT EXISTS "ai_mission_steps_pendingActionId_idx" ON "ai_mission_steps"("pendingActionId");
