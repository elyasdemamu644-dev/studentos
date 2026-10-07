import { prisma } from "@/utils/prisma";
import { NotFoundError, ValidationApiError } from "@/config/errors";
import type { Prisma } from "@prisma/client";
import type { ResourceListQuery, ResourceCreate, ResourceUpdate } from "../schemas/resources";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────
//
// NOTE: S3-compatible file storage is DEFERRED (not implemented in this
// phase). The `UPLOAD` storage type exists in the schema so the data model
// can represent uploaded files later, but actual upload operations are
// rejected cleanly rather than faked.

export const resourcesService = {
  /** List resources for the current user with optional filters. */
  async list(userId: string, query: ResourceListQuery) {
    const { courseId, resourceType, search, limit = 50, cursor } = query;

    const where: Prisma.ResourceWhereInput = { userId };
    if (courseId) where.courseId = courseId;
    if (resourceType) where.resourceType = resourceType;
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const records = await prisma.resource.findMany({
      where,
      include: { course: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    return {
      items: items.map(mapResource),
      hasMore,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  },

  /** Get a single resource by id (must belong to the user). */
  async getById(userId: string, id: string) {
    const record = await prisma.resource.findFirst({
      where: { id, userId },
      include: { course: { select: { id: true, code: true, name: true } } },
    });
    if (!record) throw new NotFoundError("Resource not found");
    return mapResource(record);
  },

  /** Create a resource.
   *
   * URL resources must include a valid URL.
   * UPLOAD resources are rejected — file storage is not yet implemented.
   */
  async create(userId: string, input: ResourceCreate) {
    assertStorageSupported(input.storageType);

    if ((input.storageType ?? "URL") === "URL") {
      if (!input.url) {
        throw new ValidationApiError("A URL is required when storageType is URL");
      }
    }

    if (input.courseId) {
      const course = await prisma.course.findFirst({
        where: { id: input.courseId, userId },
      });
      if (!course) throw new NotFoundError("Course not found");
    }

    const record = await prisma.resource.create({
      data: {
        userId,
        courseId: input.courseId ?? null,
        title: input.title,
        description: input.description ?? null,
        storageType: input.storageType ?? "URL",
        url: input.storageType === "UPLOAD" ? null : (input.url ?? null),
        fileKey: input.fileKey ?? null,
        fileName: input.fileName ?? null,
        fileSize: input.fileSize ?? null,
        mimeType: input.mimeType ?? null,
        resourceType: input.resourceType ?? "OTHER",
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapResource(record);
  },

  /** Update a resource (partial). Validates ownership and course ownership. */
  async update(userId: string, id: string, input: ResourceUpdate) {
    const existing = await prisma.resource.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Resource not found");

    // Check storage type after the update (either current or the new value).
    const nextStorageType = input.storageType ?? existing.storageType;
    assertStorageSupported(nextStorageType);

    if (nextStorageType === "URL" && input.storageType !== undefined) {
      const url = input.url !== undefined ? input.url : existing.url;
      if (!url) {
        throw new ValidationApiError("A URL is required when storageType is URL");
      }
    }

    if (input.courseId !== undefined && input.courseId !== existing.courseId) {
      if (input.courseId) {
        const course = await prisma.course.findFirst({
          where: { id: input.courseId, userId },
        });
        if (!course) throw new NotFoundError("Course not found");
      }
    }

    const record = await prisma.resource.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.storageType !== undefined && { storageType: input.storageType }),
        ...(input.url !== undefined && { url: input.url ?? null }),
        ...(input.courseId !== undefined && { courseId: input.courseId ?? null }),
        ...(input.resourceType !== undefined && { resourceType: input.resourceType }),
        ...(input.fileKey !== undefined && { fileKey: input.fileKey ?? null }),
        ...(input.fileName !== undefined && { fileName: input.fileName ?? null }),
        ...(input.fileSize !== undefined && { fileSize: input.fileSize ?? null }),
        ...(input.mimeType !== undefined && { mimeType: input.mimeType ?? null }),
      },
      include: { course: { select: { id: true, code: true, name: true } } },
    });

    return mapResource(record);
  },

  /** Delete a resource. Only the owner can delete. */
  async delete(userId: string, id: string) {
    const existing = await prisma.resource.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Resource not found");

    await prisma.resource.delete({ where: { id } });
    return { deleted: true };
  },
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function assertStorageSupported(storageType: string | undefined): void {
  if (storageType === "UPLOAD") {
    throw new ValidationApiError(
      "File upload storage is not yet available. Only URL resources are supported in this phase.",
      "UPLOAD_STORAGE_UNAVAILABLE",
    );
  }
}

// ─────────────────────────────────────────────
// Mapper: Prisma record → API response shape
// ─────────────────────────────────────────────

function mapResource(record: {
  id: string;
  courseId: string | null;
  title: string;
  description: string | null;
  url: string | null;
  storageType: string;
  fileKey: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  resourceType: string;
  createdAt: Date;
  updatedAt: Date;
  course: { id: string; code: string | null; name: string } | null;
}) {
  return {
    id: record.id,
    courseId: record.courseId,
    title: record.title,
    description: record.description,
    url: record.url,
    storageType: record.storageType,
    fileKey: record.fileKey,
    fileName: record.fileName,
    fileSize: record.fileSize,
    mimeType: record.mimeType,
    resourceType: record.resourceType,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    course: record.course ?? null,
  };
}