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
  type ResourceListQuery,
  type ResourceCreate,
  type ResourceUpdate,
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
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}