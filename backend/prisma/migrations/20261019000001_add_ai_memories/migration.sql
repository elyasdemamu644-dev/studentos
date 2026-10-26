-- Migration: Add AI memories (user-controlled assistant memory)
-- Created: 2026-10-19
--
-- Explicitly saved facts about the student that the assistant may reuse.
-- Rows are created either by the student in Settings or through the
-- confirmation-gated save_memory tool — never extracted automatically.

-- 1. Memory category enum
CREATE TYPE "MemoryCategory" AS ENUM (
    'PREFERENCE',
    'ACADEMIC',
    'GOALS',
    'SCHEDULE',
    'OTHER'
);

-- 2. Who created the memory: the student directly, or the assistant after the
--    student confirmed the save.
CREATE TYPE "MemoryProvenance" AS ENUM (
    'USER',
    'AI'
);

-- 3. AiMemory table
CREATE TABLE "ai_memories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "MemoryCategory" NOT NULL DEFAULT 'OTHER',
    "content" TEXT NOT NULL,
    "provenance" "MemoryProvenance" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

-- 4. Foreign key and indexes
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ai_memories_userId_category_idx" ON "ai_memories"("userId", "category");
CREATE INDEX "ai_memories_userId_updatedAt_idx" ON "ai_memories"("userId", "updatedAt");
