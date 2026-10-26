import { prisma } from "@/utils/prisma";
import { ConflictError, NotFoundError } from "@/config/errors";
import type { MemoryCategory, MemoryProvenance, QueryMemoryInput, CreateMemoryInput, UpdateMemoryInput } from "@/schemas/ai";

// ─────────────────────────────────────────────────────────────────────────────
// Saved memories service
// ─────────────────────────────────────────────────────────────────────────────
//
// CRUD for facts the student has explicitly saved for the assistant. Every
// query is scoped to `userId` here — this is the single place ownership is
// enforced, so neither the REST routes nor the AI tools can reach another
// student's rows.
//
// Two behaviours are worth spelling out:
//
//  * Normalisation + dedup. Content is stored trimmed with collapsed
//    whitespace, and creating (or updating to) a content+category pair that
//    already exists for this user returns the existing row instead of a second
//    copy. Create reports `created: false` for that case so the route can answer
//    200 instead of 201; update answers 409, because silently pointing an edit
//    at a different record would surprise the student.
//  * The prompt loader. `listForPrompt` is the bounded, newest-first slice the
//    agent prompt inlines (see `system-prompt.ts`). It never returns the whole
//    table.

/** Settings key that turns saved memory off when set to "false". Default: on. */
export const MEMORY_ENABLED_KEY = "ai.memoryEnabled";

/** How many entries are injected into a prompt (newest first). */
export const MAX_MEMORY_ENTRIES = 20;

/**
 * How many of a user's rows are scanned for a duplicate. Memories are
 * inherently a small, hand-curated list; the cap keeps even a pathological
 * account bounded.
 */
const DEDUP_SCAN_LIMIT = 1000;

/** Whether the assistant may use saved memories for this user. Default: enabled. */
export function isMemoryEnabled(settings: Record<string, string | null>): boolean {
  return settings[MEMORY_ENABLED_KEY] !== "false";
}

/** Trim and collapse internal whitespace — the stored form of a memory. */
function normalizeContent(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

/** The dedup key: normalised content, case-folded. */
function dedupKey(content: string): string {
  return normalizeContent(content).toLowerCase();
}

export interface MemoryRecord {
  id: string;
  category: MemoryCategory;
  content: string;
  provenance: MemoryProvenance;
  createdAt: string;
  updatedAt: string;
}

function mapMemory(row: {
  id: string;
  category: MemoryCategory;
  content: string;
  provenance: MemoryProvenance;
  createdAt: Date;
  updatedAt: Date;
}): MemoryRecord {
  return {
    id: row.id,
    category: row.category,
    content: row.content,
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const memoryService = {
  /** List memories for the current user, optionally filtered by category. */
  async list(userId: string, query: QueryMemoryInput) {
    const { category, limit } = query;

    const rows = await prisma.aiMemory.findMany({
      where: { userId, ...(category ? { category } : {}) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(mapMemory);
    return { items, hasMore };
  },

  /** Get one memory by id (must belong to the user). */
  async getById(userId: string, id: string) {
    const row = await prisma.aiMemory.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundError("Memory");
    return mapMemory(row);
  },

  /**
   * Create a memory. `provenance` is USER for the Settings form and AI for a
   * confirmed `save_memory` proposal — the UI labels them differently.
   * Returns `created: false` when an equivalent memory already exists.
   */
  async create(userId: string, input: CreateMemoryInput, provenance: MemoryProvenance = "USER") {
    const content = normalizeContent(input.content);
    const existing = await this.findDuplicate(userId, content, input.category);
    if (existing) return { memory: mapMemory(existing), created: false };

    const row = await prisma.aiMemory.create({
      data: { userId, category: input.category, content, provenance },
    });
    return { memory: mapMemory(row), created: true };
  },

  /** Update a memory's content and/or category (must belong to the user). */
  async update(userId: string, id: string, input: UpdateMemoryInput) {
    const existing = await prisma.aiMemory.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Memory");

    const nextContent = input.content !== undefined ? normalizeContent(input.content) : existing.content;
    const nextCategory = input.category ?? existing.category;
    const changed = nextContent !== existing.content || nextCategory !== existing.category;

    if (changed) {
      const duplicate = await this.findDuplicate(userId, nextContent, nextCategory, id);
      if (duplicate) {
        throw new ConflictError("An identical memory already exists", { existingId: duplicate.id });
      }
    }

    const row = await prisma.aiMemory.update({
      where: { id },
      data: {
        ...(input.content !== undefined && { content: nextContent }),
        ...(input.category !== undefined && { category: nextCategory }),
      },
    });
    return mapMemory(row);
  },

  /** Delete one memory (must belong to the user). */
  async remove(userId: string, id: string) {
    const existing = await prisma.aiMemory.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Memory");
    await prisma.aiMemory.delete({ where: { id } });
    return { deleted: true };
  },

  /** Delete every memory the current user has. */
  async clearAll(userId: string) {
    const result = await prisma.aiMemory.deleteMany({ where: { userId } });
    return { deleted: result.count };
  },

  /**
   * The bounded, newest-first slice inlined into the agent prompt. No filters —
   * the prompt always sees the freshest facts across all categories.
   */
  async listForPrompt(userId: string) {
    const rows = await prisma.aiMemory.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: MAX_MEMORY_ENTRIES,
      select: { category: true, content: true },
    });
    return rows.map((row) => ({ category: row.category, content: row.content }));
  },

  /** Find a row in the same category holding the same normalised content. */
  async findDuplicate(userId: string, content: string, category: MemoryCategory, excludeId?: string) {
    const key = dedupKey(content);
    const candidates = await prisma.aiMemory.findMany({
      where: { userId, category },
      take: DEDUP_SCAN_LIMIT,
    });
    return candidates.find(
      (row) => row.id !== excludeId && dedupKey(row.content) === key,
    ) ?? null;
  },
};
