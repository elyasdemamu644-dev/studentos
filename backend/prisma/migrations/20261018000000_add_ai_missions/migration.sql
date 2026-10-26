-- Migration: Add AI Missions (Persistent Multi-Step Missions)
-- Created: 2026-10-18

-- 1. Mission status enum
CREATE TYPE "AiMissionStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'WAITING',
    'PARTIAL',
    'FAILED_RECOVERABLE',
    'FAILED_TERMINAL',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'COMPLETED'
);

-- 2. Mission step status enum
CREATE TYPE "AiMissionStepStatus" AS ENUM (
    'PENDING',
    'QUEUED',
    'RUNNING',
    'WAITING',
    'COMPLETED',
    'FAILED_RECOVERABLE',
    'FAILED_TERMINAL',
    'SKIPPED',
    'CANCELLED'
);

-- 3. AiMission table
CREATE TABLE "ai_missions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "objective" TEXT NOT NULL,
    "context_snapshot" JSONB,
    "status" "AiMissionStatus" NOT NULL DEFAULT 'QUEUED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "terminal_error" TEXT,

    CONSTRAINT "ai_missions_pkey" PRIMARY KEY ("id")
);

-- 4. AiMissionStep table
CREATE TABLE "ai_mission_steps" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "mission_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "tool_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "depends_on" TEXT[],
    "status" "AiMissionStepStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,
    "verification" JSONB,

    CONSTRAINT "ai_mission_steps_pkey" PRIMARY KEY ("id")
);

-- 5. Foreign keys and indexes
ALTER TABLE "ai_missions" ADD CONSTRAINT "ai_missions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_missions" ADD CONSTRAINT "ai_missions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_mission_steps" ADD CONSTRAINT "ai_mission_steps_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "ai_missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes for common query patterns
CREATE INDEX "ai_missions_user_id_status_idx" ON "ai_missions"("user_id", "status");
CREATE INDEX "ai_missions_user_id_updated_at_idx" ON "ai_missions"("user_id", "updated_at" DESC);
CREATE INDEX "ai_missions_conversation_id_idx" ON "ai_missions"("conversation_id");

CREATE INDEX "ai_mission_steps_mission_id_step_order_idx" ON "ai_mission_steps"("mission_id", "step_order");
CREATE INDEX "ai_mission_steps_mission_id_status_idx" ON "ai_mission_steps"("mission_id", "status");
CREATE INDEX "ai_mission_steps_idempotency_key_idx" ON "ai_mission_steps"("idempotency_key") WHERE "idempotency_key" IS NOT NULL;

-- 6. Add mission relation to AiConversation (optional, for convenience)
-- The relation is already defined via the foreign key above