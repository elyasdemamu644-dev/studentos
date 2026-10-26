import { Router } from "express";
import { z } from "zod";
import { zValidator } from "@/utils/zod-validator-shim";
import { authenticate, type AuthRequest } from "@/routes/auth";
import { config } from "@/config";
import { ValidationApiError } from "@/config/errors";
import { parseMultipart } from "@/utils/multipart";
import { UPLOAD_ERROR_CODES } from "@/utils/file-validation";
import { resourcesService } from "../services/resources";
import {
  queryResourceSchema,
  createResourceSchema,
  updateResourceSchema,
  uploadResourceFieldsSchema,
  updateResourceProgressSchema,
  createResourceBookmarkSchema,
  type ResourceListQuery,
  type ResourceCreate,
  type ResourceUpdate,
  type ResourceProgressInput,
  type ResourceBookmarkInput,
} from "../schemas/resources";

const router = Router();
router.use(authenticate);

const idParam = { id: z.string().min(1) };

router.get("/", zValidator("query", queryResourceSchema), async (req: AuthRequest, res, next) => {
  try {
    const result = await resourcesService.list(
      req.currentUser!.id,
      req.query as unknown as ResourceListQuery,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// Upload a file as multipart/form-data. Registered before the `/:id` routes
// even though the method differs, to keep literal paths ahead of parameters.
router.post("/upload", async (req: AuthRequest, res, next) => {
  try {
    const parsed = await parseMultipart(req, config.uploadMaxFileSizeBytes);
    if (!parsed.file) {
      throw new ValidationApiError(
        "A file is required in the `file` field",
        UPLOAD_ERROR_CODES.MISSING_FILE,
      );
    }

    const fields = uploadResourceFieldsSchema.safeParse(parsed.fields);
    if (!fields.success) {
      next(fields.error);
      return;
    }

    const record = await resourcesService.createFromUpload(
      req.currentUser!.id,
      fields.data,
      parsed.file,
      // Accept any file type. Content is still sniffed: known types keep their
      // detected MIME, unknown binaries are stored as application/octet-stream.
      { allowAnyMimeType: true },
    );
    return res.status(201).json({ success: true, data: record });
  } catch (error) { next(error); }
});

// Download the bytes of an uploaded (UPLOAD) resource. The response is a raw
// file stream, not the JSON envelope — the only such endpoint in the API.
router.get("/:id/download", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const file = await resourcesService.getDownload(req.currentUser!.id, String(req.params.id));
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.buffer.length));
    res.setHeader("Content-Disposition", contentDisposition(file.fileName));
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(file.buffer);
  } catch (error) { next(error); }
});

// Serve an uploaded file to the authenticated reader.
//
// Unlike `/download`, this endpoint is for in-app previews: safe document types
// keep a renderable Content-Type, while formats that can carry active content
// (Office documents, archives) are forced to `application/octet-stream` and an
// attachment disposition so the browser can never execute them as a page.
router.get("/:id/content", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const file = await resourcesService.getViewerFile(req.currentUser!.id, String(req.params.id));
    const { classification } = file;
    const inline = classification.inlineSafe;
    const contentType = inline
      ? classification.contentType ?? "application/octet-stream"
      : "application/octet-stream";
    const size = file.buffer.length;
    const rangeHeader = req.headers.range;

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", contentDisposition(file.fileName, inline ? "inline" : "attachment"));

    if (!rangeHeader) {
      res.setHeader("Content-Length", String(size));
      return res.status(200).send(file.buffer);
    }

    const range = parseByteRange(rangeHeader, size);
    if (!range) {
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.status(416).end();
    }

    const slice = file.buffer.subarray(range.start, range.end + 1);
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader("Content-Length", String(slice.length));
    return res.send(slice);
  } catch (error) { next(error); }
});

// Report whether the AI/study panel can read this resource.
router.get("/:id/text", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await resourcesService.getTextStatus(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// Safe preview of an external link (title/site/excerpt only, never raw HTML).
router.get("/:id/link-preview", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await resourcesService.getLinkPreview(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

// Reading position.
router.get("/:id/progress", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await resourcesService.getProgress(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.put(
  "/:id/progress",
  zValidator("params", idParam),
  zValidator("body", updateResourceProgressSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as ResourceProgressInput;
      const result = await resourcesService.updateProgress(
        req.currentUser!.id,
        String(req.params.id),
        input,
      );
      return res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  },
);

// Bookmarks inside a resource.
router.get("/:id/bookmarks", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await resourcesService.listBookmarks(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.post(
  "/:id/bookmarks",
  zValidator("params", idParam),
  zValidator("body", createResourceBookmarkSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as ResourceBookmarkInput;
      const result = await resourcesService.createBookmark(
        req.currentUser!.id,
        String(req.params.id),
        input,
      );
      return res.status(201).json({ success: true, data: result });
    } catch (error) { next(error); }
  },
);

router.delete(
  "/:id/bookmarks/:bookmarkId",
  zValidator("params", z.object({ id: z.string().min(1), bookmarkId: z.string().min(1) })),
  async (req: AuthRequest, res, next) => {
    try {
      const result = await resourcesService.deleteBookmark(
        req.currentUser!.id,
        String(req.params.id),
        String(req.params.bookmarkId),
      );
      return res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
  },
);

router.get("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const record = await resourcesService.getById(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: record });
  } catch (error) { next(error); }
});

router.post("/", zValidator("body", createResourceSchema), async (req: AuthRequest, res, next) => {
  try {
    const input = req.body as unknown as ResourceCreate;
    const record = await resourcesService.create(req.currentUser!.id, input);
    return res.status(201).json({ success: true, data: record });
  } catch (error) { next(error); }
});

router.patch(
  "/:id",
  zValidator("params", idParam),
  zValidator("body", updateResourceSchema),
  async (req: AuthRequest, res, next) => {
    try {
      const input = req.body as unknown as ResourceUpdate;
      const record = await resourcesService.update(req.currentUser!.id, String(req.params.id), input);
      return res.status(200).json({ success: true, data: record });
    } catch (error) { next(error); }
  },
);

router.delete("/:id", zValidator("params", idParam), async (req: AuthRequest, res, next) => {
  try {
    const result = await resourcesService.delete(req.currentUser!.id, String(req.params.id));
    return res.status(200).json({ success: true, data: result });
  } catch (error) { next(error); }
});

export default router;

/** RFC 6266 Content-Disposition with an ASCII fallback + UTF-8 form. */
function contentDisposition(fileName: string, disposition: "inline" | "attachment" = "attachment"): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Parse a single `bytes=` range. Returns null for syntactically invalid/multi ranges. */
function parseByteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isInteger(suffix) || suffix <= 0 || size === 0) return null;
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isInteger(start) || start < 0 || start >= size) return null;
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isInteger(end) || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}