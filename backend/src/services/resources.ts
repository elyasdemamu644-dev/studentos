import { prisma } from "@/utils/prisma";
import { config } from "@/config";
import { ApiError, NotFoundError, StorageError, ValidationApiError } from "@/config/errors";
import type { Prisma } from "@prisma/client";
import {
  assertValidFileName,
  detectMimeType,
  resolveUploadMimeType,
  UPLOAD_ERROR_CODES,
} from "@/utils/file-validation";
import { getFileStorage, storageKeyFor, type FileStorage } from "@/services/storage";
import type { ParsedFile } from "@/utils/multipart";
import type {
  ResourceListQuery,
  ResourceCreate,
  ResourceUpdate,
  ResourceUploadFields,
} from "../schemas/resources";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────
//
// URL resources are created/updated through the JSON routes; uploaded files go
// through `createFromUpload` (multipart) and are served by `getDownload`. Files
// live behind the `FileStorage` provider (local disk by default, S3-compatible
// when configured) and every query is scoped by `userId`.

export const resourcesService = {
  /** List resources for the current user with optional filters. */
  async list(userId: string, query: ResourceListQuery) {
    const { courseId, resourceType, search, limit = 50, cursor } = query;

    const where: Prisma.ResourceWhereInput = { userId };
    if (courseId) where.courseId = courseId;
    if (resourceType) where.resourceType = resourceType;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
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

  /** Create an UPLOAD resource from a validated multipart file.
   *
   * The stored object is written first and the database row second; if the
   * row insert fails the object is rolled back, so a failed upload cannot
   * orphan a file. Course ownership is checked before anything is stored.
   */
  async createFromUpload(
    userId: string,
    fields: ResourceUploadFields,
    file: ParsedFile,
  ) {
    if (file.buffer.length === 0) {
      throw new ValidationApiError("The uploaded file is empty", UPLOAD_ERROR_CODES.EMPTY_FILE);
    }

    // Validate everything that can be validated before touching storage.
    const fileName = assertValidFileName(file.originalName);
    const mimeType = resolveUploadMimeType(
      file.declaredMime,
      detectMimeType(file.buffer),
      new Set(config.uploadAllowedMimeTypes),
    );

    if (fields.courseId) {
      const course = await prisma.course.findFirst({ where: { id: fields.courseId, userId } });
      if (!course) throw new NotFoundError("Course not found");
    }

    const key = storageKeyFor(userId, fileName);
    const storage = getFileStorage();

    try {
      await storage.put(key, file.buffer, mimeType);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new StorageError("Failed to store the uploaded file");
    }

    try {
      const record = await prisma.resource.create({
        data: {
          userId,
          courseId: fields.courseId ?? null,
          title: fields.title,
          description: fields.description ?? null,
          storageType: "UPLOAD",
          url: null,
          fileKey: key,
          fileName,
          fileSize: file.buffer.length,
          mimeType,
          resourceType: fields.resourceType ?? inferResourceType(mimeType),
        },
        include: { course: { select: { id: true, code: true, name: true } } },
      });
      return mapResource(record);
    } catch (error) {
      // Roll back the stored object so a failed DB write leaves no orphan file.
      await safeDeleteObject(storage, key);
      throw error;
    }
  },

  /** Fetch the bytes of an UPLOAD resource for the owner. */
  async getDownload(userId: string, id: string) {
    const record = await prisma.resource.findFirst({ where: { id, userId } });
    if (!record) throw new NotFoundError("Resource not found");
    if (record.storageType !== "UPLOAD" || !record.fileKey) {
      throw new ValidationApiError(
        "This resource is a link, not an uploaded file",
        UPLOAD_ERROR_CODES.RESOURCE_NOT_A_FILE,
      );
    }

    let buffer: Buffer;
    try {
      buffer = await getFileStorage().get(record.fileKey);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new StorageError("Failed to read the stored file");
    }

    return {
      buffer,
      mimeType: record.mimeType ?? "application/octet-stream",
      fileName: record.fileName ?? "download",
    };
  },

  /** Delete a resource. Only the owner can delete.
   *
   * The stored object is removed before the row so the endpoint never leaves
   * an orphaned file; if storage fails the request fails and the row survives
   * unchanged, making the delete safely retryable.
   */
  async delete(userId: string, id: string) {
    const existing = await prisma.resource.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Resource not found");

    if (existing.storageType === "UPLOAD" && existing.fileKey) {
      try {
        await getFileStorage().delete(existing.fileKey);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new StorageError("Failed to delete the stored file");
      }
    }

    await prisma.resource.delete({ where: { id } });
    return { deleted: true };
  },
};

/** Best-effort object removal used on the create rollback path. */
async function safeDeleteObject(storage: FileStorage, key: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch {
    // The original database error is the one that matters; a leaked object is
    // logged by the provider and can be swept later.
  }
}

/** Map a resolved MIME type onto the closest resource category. */
function inferResourceType(mimeType: string) {
  if (mimeType === "application/pdf") return "PDF" as const;
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return "SLIDES" as const;
  }
  if (mimeType === "application/vnd.ms-powerpoint") return "SLIDES" as const;
  if (mimeType.startsWith("image/")) return "OTHER" as const;
  if (mimeType.startsWith("video/")) return "VIDEO" as const;
  if (mimeType.startsWith("audio/")) return "AUDIO" as const;
  if (mimeType.startsWith("text/")) return "DOCUMENT" as const;
  if (mimeType === "application/msword") return "DOCUMENT" as const;
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "DOCUMENT" as const;
  }
  return "OTHER" as const;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function assertStorageSupported(storageType: string | undefined): void {
  // Uploaded files cannot be created through the JSON routes: the client must
  // not be able to invent a `fileKey`/`fileSize`. They go through the
  // multipart `POST /resources/upload` route instead. The code is retained for
  // backward compatibility with the documented JSON contract.
  if (storageType === "UPLOAD") {
    throw new ValidationApiError(
      "File uploads must be sent as multipart/form-data to POST /resources/upload",
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