-- Migration: Add the resource reader's persisted state
-- Created: 2026-10-23
--
-- Progress and bookmarks make the resource viewer resumable. Notes gain an
-- optional resource association so study notes written beside a document can
-- be filtered without moving or duplicating the existing notes table.

-- 1. Where the student stopped in each resource.
CREATE TABLE "resource_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "page" INTEGER,
    "slide" INTEGER,
    "positionSeconds" DOUBLE PRECISION,
    "percent" DOUBLE PRECISION,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "resource_progress_userId_resourceId_key" ON "resource_progress"("userId", "resourceId");
CREATE INDEX "resource_progress_userId_updatedAt_idx" ON "resource_progress"("userId", "updatedAt");

ALTER TABLE "resource_progress" ADD CONSTRAINT "resource_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_progress" ADD CONSTRAINT "resource_progress_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Named places inside a resource.
CREATE TABLE "resource_bookmarks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "page" INTEGER,
    "slide" INTEGER,
    "positionSeconds" DOUBLE PRECISION,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_bookmarks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resource_bookmarks_userId_resourceId_createdAt_idx" ON "resource_bookmarks"("userId", "resourceId", "createdAt");

ALTER TABLE "resource_bookmarks" ADD CONSTRAINT "resource_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_bookmarks" ADD CONSTRAINT "resource_bookmarks_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Notes can belong to a resource. Deleting the resource keeps the note.
ALTER TABLE "notes" ADD COLUMN "resourceId" TEXT;
CREATE INDEX "notes_userId_resourceId_updatedAt_idx" ON "notes"("userId", "resourceId", "updatedAt");
ALTER TABLE "notes" ADD CONSTRAINT "notes_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
