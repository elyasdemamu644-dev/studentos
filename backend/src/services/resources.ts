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
import { extractDocumentText, isExtractionSupported, type ExtractedDocument } from "./document-extraction";
import { fetchLinkContent } from "./ai/link-content";
import { classifyResourceViewer } from "@tutor-walle/shared/schemas/resource-viewer";
import type {
  ResourceListQuery,
  ResourceCreate,
  ResourceUpdate,
  ResourceUploadFields,
  ResourceProgressInput,
  ResourceBookmarkInput,
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
      // id tiebreaker keeps cursor pagination stable when createdAt ties.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

    // The storage-type guard only applies to a storageType the client is
    // *sending* through this JSON route. A partial update of an existing
    // UPLOAD resource (e.g. renaming it) leaves storageType untouched and must
    // not be rejected just because the stored value is UPLOAD — the file was
    // already uploaded through the multipart route.
    if (input.storageType !== undefined) {
      assertStorageSupported(input.storageType);
    }

    const nextStorageType = input.storageType ?? existing.storageType;
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
    options: { allowAnyMimeType?: boolean } = {},
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
      options.allowAnyMimeType,
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

  /** Extract text content from an uploaded resource for AI processing. */
  async getContent(userId: string, id: string): Promise<ExtractedDocument> {
    const record = await prisma.resource.findFirst({ where: { id, userId } });
    if (!record) throw new NotFoundError("Resource not found");
    if (record.storageType !== "UPLOAD" || !record.fileKey) {
      throw new ValidationApiError(
        "This resource is a link, not an uploaded file",
        UPLOAD_ERROR_CODES.RESOURCE_NOT_A_FILE,
      );
    }
    if (!record.mimeType || !isExtractionSupported(record.mimeType)) {
      throw new ValidationApiError(
        `Text extraction is not supported for this file type (${record.mimeType ?? "unknown"})`,
        "UNSUPPORTED_EXTRACTION_TYPE",
      );
    }

    let buffer: Buffer;
    try {
      buffer = await getFileStorage().get(record.fileKey);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new StorageError("Failed to read the stored file");
    }

    return extractDocumentText(buffer, record.mimeType);
  },

  /** Fetch bytes plus the shared presentation classification for the reader. */
  async getViewerFile(userId: string, id: string) {
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
      fileName: record.fileName ?? `resource-${record.id}`,
      storedMimeType: record.mimeType,
      classification: classifyResourceViewer({
        storageType: record.storageType,
        mimeType: record.mimeType,
        fileName: record.fileName,
        resourceType: record.resourceType,
        url: record.url,
      }),
    };
  },

  /**
   * Report whether the study assistant can read this resource, and a preview.
   *
   * The full extracted text can be large; the viewer only needs to know that
   * extraction works (and show an honest reason when it does not), so this
   * returns a bounded preview while the AI pipeline reads the full document
   * through `getContent`.
   */
  async getTextStatus(userId: string, id: string) {
    const record = await prisma.resource.findFirst({ where: { id, userId } });
    if (!record) throw new NotFoundError("Resource not found");
    if (record.storageType !== "UPLOAD" || !record.fileKey) {
      return {
        supported: false,
        status: "unavailable" as const,
        reason: "Web links are read directly by the study assistant.",
        format: null,
        pageCount: null,
        charCount: null,
        preview: null,
      };
    }
    if (!record.mimeType || !isExtractionSupported(record.mimeType)) {
      return {
        supported: false,
        status: "unsupported" as const,
        reason: `The study assistant cannot read ${record.mimeType ?? "this file type"} yet.`,
        format: null,
        pageCount: null,
        charCount: null,
        preview: null,
      };
    }

    try {
      const text = await this.getContent(userId, id);
      return {
        supported: true,
        status: "ready" as const,
        reason: null,
        format: text.format,
        pageCount: text.pageCount,
        charCount: text.charCount,
        preview: text.fullText.slice(0, 600),
      };
    } catch {
      // Extraction failure is a normal state for the study panel, not an API
      // error: report it so the UI can explain why AI reading is unavailable.
      return {
        supported: true,
        status: "failed" as const,
        reason: "The file's text could not be extracted.",
        format: null,
        pageCount: null,
        charCount: null,
        preview: null,
      };
    }
  },

  /** Fetch a safe text preview of an external link (never proxied as HTML). */
  async getLinkPreview(userId: string, id: string) {
    const record = await prisma.resource.findFirst({ where: { id, userId } });
    if (!record) throw new NotFoundError("Resource not found");
    if (record.storageType !== "URL" || !record.url) {
      throw new ValidationApiError("This resource is not a web link");
    }

    const result = await fetchLinkContent(record.url);
    if (!result.ok) {
      return {
        available: false,
        url: record.url,
        reason: linkFailureMessage(result.reason),
        title: record.title,
        siteName: safeHostname(record.url),
        description: null,
        excerpt: null,
        truncated: false,
      };
    }

    const text = result.content.text.replace(/\s+/g, " ").trim();
    return {
      available: true,
      url: result.content.url,
      reason: null,
      title: result.content.title ?? record.title,
      siteName: safeHostname(result.content.url),
      description: text.slice(0, 280) || null,
      excerpt: text.slice(0, 1200) || null,
      truncated: result.content.truncated,
    };
  },

  /** Current reading position for a resource (empty defaults when none). */
  async getProgress(userId: string, id: string) {
    await assertResourceOwned(userId, id);
    const record = await prisma.resourceProgress.findUnique({
      where: { userId_resourceId: { userId, resourceId: id } },
    });
    return mapProgress(record);
  },

  /**
   * Persist a reading position.
   *
   * Completion is gated on real engagement so merely opening a file cannot mark
   * it finished. It is sticky: once a student has completed a resource, a later
   * position update cannot silently un-complete it.
   */
  async updateProgress(userId: string, id: string, input: ResourceProgressInput) {
    await assertResourceOwned(userId, id);
    const existing = await prisma.resourceProgress.findUnique({
      where: { userId_resourceId: { userId, resourceId: id } },
    });

    const completed = existing?.completed === true || input.completed === true;
    if (input.completed === true && existing?.completed !== true) {
      const percent = input.percent ?? existing?.percent ?? 0;
      const page = input.page ?? existing?.page ?? 0;
      const slide = input.slide ?? existing?.slide ?? 0;
      const positionSeconds = input.positionSeconds ?? existing?.positionSeconds ?? 0;
      const meaningful =
        percent >= 90 || page >= 2 || slide >= 2 || positionSeconds >= 15;
      if (!meaningful) {
        throw new ValidationApiError(
          "A resource can only be marked complete after meaningful progress",
          "COMPLETION_NOT_MEANINGFUL",
        );
      }
    }

    const data = {
      ...(input.page !== undefined && { page: input.page }),
      ...(input.slide !== undefined && { slide: input.slide }),
      ...(input.positionSeconds !== undefined && { positionSeconds: input.positionSeconds }),
      ...(input.percent !== undefined && { percent: input.percent }),
      completed,
    };

    const record = await prisma.resourceProgress.upsert({
      where: { userId_resourceId: { userId, resourceId: id } },
      create: { userId, resourceId: id, ...data },
      update: data,
    });

    return mapProgress(record);
  },

  /** Bookmarks for a resource, newest first. */
  async listBookmarks(userId: string, id: string) {
    await assertResourceOwned(userId, id);
    const records = await prisma.resourceBookmark.findMany({
      where: { userId, resourceId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    });
    return records.map(mapBookmark);
  },

  /** Create a bookmark at a page, slide or timestamp. */
  async createBookmark(userId: string, id: string, input: ResourceBookmarkInput) {
    await assertResourceOwned(userId, id);
    const record = await prisma.resourceBookmark.create({
      data: {
        userId,
        resourceId: id,
        label: input.label,
        page: input.page ?? null,
        slide: input.slide ?? null,
        positionSeconds: input.positionSeconds ?? null,
        note: input.note ?? null,
      },
    });
    return mapBookmark(record);
  },

  /** Delete one of the current user's bookmarks on this resource. */
  async deleteBookmark(userId: string, id: string, bookmarkId: string) {
    const result = await prisma.resourceBookmark.deleteMany({
      where: { id: bookmarkId, userId, resourceId: id },
    });
    if (result.count === 0) throw new NotFoundError("Bookmark not found");
    return { deleted: true };
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

async function assertResourceOwned(userId: string, resourceId: string): Promise<void> {
  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, userId },
    select: { id: true },
  });
  if (!resource) throw new NotFoundError("Resource not found");
}

function mapProgress(
  record: {
    page: number | null;
    slide: number | null;
    positionSeconds: number | null;
    percent: number | null;
    completed: boolean;
    updatedAt: Date;
  } | null,
) {
  if (!record) {
    return {
      page: null,
      slide: null,
      positionSeconds: null,
      percent: null,
      completed: false,
      updatedAt: null,
    };
  }
  return {
    page: record.page,
    slide: record.slide,
    positionSeconds: record.positionSeconds,
    percent: record.percent,
    completed: record.completed,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapBookmark(record: {
  id: string;
  label: string;
  page: number | null;
  slide: number | null;
  positionSeconds: number | null;
  note: string | null;
  createdAt: Date;
}) {
  return {
    id: record.id,
    label: record.label,
    page: record.page,
    slide: record.slide,
    positionSeconds: record.positionSeconds,
    note: record.note,
    createdAt: record.createdAt.toISOString(),
  };
}

function safeHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

function linkFailureMessage(reason: string): string {
  switch (reason) {
    case "blocked":
      return "This link points to a private or unsafe address and cannot be previewed.";
    case "too_large":
      return "This page is too large to preview.";
    case "unsupported_type":
      return "This link is not a web page, so it cannot be previewed here.";
    case "empty":
      return "This page did not return any readable content.";
    case "http_error":
      return "The website refused or failed the preview request.";
    default:
      return "The website could not be reached for a preview.";
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