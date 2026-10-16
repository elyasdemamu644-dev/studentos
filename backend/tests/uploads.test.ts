import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { app } from "@/app";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";
import { LocalDiskStorage, setFileStorage, type FileStorage } from "@/services/storage";

const BASE = "/api/v1";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(48, 0x07),
]);

// superagent turns PDF/PNG bodies into Buffers only when told to; collect the
// raw bytes explicitly so we can compare them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function binaryParser(res: any, cb: (err: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

interface UploadOptions {
  file?: Buffer;
  filename?: string;
  contentType?: string;
  fields?: Record<string, string>;
}

function upload(token: string | null, options: UploadOptions = {}) {
  let req = request(app).post(`${BASE}/resources/upload`);
  if (token) req = req.set(auth(token));
  for (const [key, value] of Object.entries(options.fields ?? {})) req = req.field(key, value);
  if (options.file) {
    req = req.attach("file", options.file, {
      filename: options.filename ?? "file",
      contentType: options.contentType ?? "application/octet-stream",
    });
  }
  return req;
}

describe("Resource uploads", () => {
  let token = "";
  let otherToken = "";
  let storageRoot = "";
  let storage: LocalDiskStorage;

  beforeAll(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tutor-walle-uploads-"));
    storage = new LocalDiskStorage(storageRoot);
    setFileStorage(storage);

    token = (await registerAndLogin("uploads@test.com", "Pass123!")).token;
    otherToken = (await registerAndLogin("uploads-other@test.com", "Pass123!")).token;
  });

  afterAll(async () => {
    setFileStorage(null);
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  describe("POST /resources/upload", () => {
    it("stores a valid file, records metadata and streams it back", async () => {
      const res = await upload(token, {
        file: PDF,
        filename: "lecture notes.pdf",
        contentType: "application/pdf",
        fields: { title: "Lecture notes" },
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const record = res.body.data;
      expect(record.storageType).toBe("UPLOAD");
      expect(record.url).toBeNull();
      expect(record.fileName).toBe("lecture notes.pdf");
      expect(record.fileSize).toBe(PDF.length);
      expect(record.mimeType).toBe("application/pdf");
      expect(record.resourceType).toBe("PDF"); // inferred from content
      expect(record.fileKey).toMatch(/^resources\//);

      const download = await request(app)
        .get(`${BASE}/resources/${record.id}/download`)
        .set(auth(token))
        .buffer(true)
        .parse(binaryParser);

      expect(download.status).toBe(200);
      expect(download.headers["content-type"]).toContain("application/pdf");
      expect(download.headers["content-disposition"]).toContain("attachment");
      expect(download.headers["content-disposition"]).toContain("lecture notes.pdf");
      expect(Buffer.compare(download.body, PDF)).toBe(0);
    });

    it("stores the sniffed content type, not the client-declared one", async () => {
      const res = await upload(token, {
        file: PNG,
        filename: "diagram.pdf", // lying extension + declared type
        contentType: "application/pdf",
        fields: { title: "Actually a PNG" },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.mimeType).toBe("image/png");
    });

    it("accepts allow-listed plain text", async () => {
      const res = await upload(token, {
        file: Buffer.from("hello world"),
        filename: "notes.txt",
        contentType: "application/octet-stream",
        fields: { title: "Notes" },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.mimeType).toBe("text/plain");
      expect(res.body.data.resourceType).toBe("DOCUMENT");
    });

    it("accepts any file type, storing unknown content as octet-stream", async () => {
      const res = await upload(token, {
        file: Buffer.from([0x4d, 0x5a, 0x90, 0x00]), // MZ executable, no known signature
        filename: "archive.custom",
        contentType: "application/octet-stream",
        fields: { title: "Arbitrary binary" },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.mimeType).toBe("application/octet-stream");
      expect(res.body.data.fileName).toBe("archive.custom");

      const deleted = await request(app)
        .delete(`${BASE}/resources/${res.body.data.id}`)
        .set(auth(token));
      expect(deleted.status).toBe(200);
    });

    it("rejects an oversized file", async () => {
      const res = await upload(token, {
        file: Buffer.alloc(5000, 0x41), // > the 2 KB test limit
        filename: "big.pdf",
        contentType: "application/pdf",
        fields: { title: "Too big" },
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("FILE_TOO_LARGE");
    });

    it("rejects an empty file", async () => {
      const res = await upload(token, {
        file: Buffer.alloc(0),
        filename: "empty.pdf",
        contentType: "application/pdf",
        fields: { title: "Empty" },
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("EMPTY_FILE");
    });

    it("rejects a missing file", async () => {
      const res = await upload(token, { fields: { title: "No file" } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("MISSING_FILE");
    });

    it("never lets a path-traversal filename escape the storage root", async () => {
      const res = await upload(token, {
        file: PDF,
        filename: "../../etc/passwd.pdf",
        contentType: "application/pdf",
        fields: { title: "Traversal" },
      });

      // The HTTP client (undici) already strips directory components, in which
      // case the server stores the safe basename; if a raw name ever reaches the
      // server it is rejected. Either way it can never point outside the root.
      if (res.status === 400) {
        expect(res.body.error.code).toBe("INVALID_FILE_NAME");
      } else {
        expect(res.status).toBe(201);
        expect(res.body.data.fileName).not.toMatch(/[\\/]|\.\./);
        expect(res.body.data.fileKey).not.toContain("..");
        await expect(
          fs.stat(path.resolve(storageRoot, res.body.data.fileKey)),
        ).resolves.toBeDefined();
      }
    });

    it("requires a title", async () => {
      const res = await upload(token, {
        file: PDF,
        filename: "untitled.pdf",
        contentType: "application/pdf",
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("requires authentication", async () => {
      const res = await upload(null, {
        file: PDF,
        filename: "nope.pdf",
        contentType: "application/pdf",
        fields: { title: "Nope" },
      });

      expect(res.status).toBe(401);
    });

    it("links the upload to a course owned by the caller", async () => {
      const year = await authRequestJson("post", `${BASE}/academics/years`, token, {
        name: "2041-2042",
        startDate: "2041-09-01T00:00:00.000Z",
        endDate: "2042-06-30T00:00:00.000Z",
      });
      const semester = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
        name: "Fall 2041",
        academicYearId: year.body.data.id,
        startDate: "2041-09-01T00:00:00.000Z",
        endDate: "2041-12-15T00:00:00.000Z",
      });
      const course = await authRequestJson("post", `${BASE}/courses`, token, {
        code: "UP101",
        name: "Uploads",
        credits: 3,
        semesterId: semester.body.data.id,
      });

      const res = await upload(token, {
        file: PDF,
        filename: "linked.pdf",
        contentType: "application/pdf",
        fields: { title: "Linked", courseId: course.body.data.id },
      });

      expect(res.status).toBe(201);
      expect(res.body.data.courseId).toBe(course.body.data.id);
    });

    it("rejects a courseId the caller does not own", async () => {
      const res = await upload(token, {
        file: PDF,
        filename: "foreign.pdf",
        contentType: "application/pdf",
        fields: { title: "Foreign course", courseId: "cmforeigncourse00000000" },
      });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("PATCH /resources/:id on an UPLOAD resource", () => {
    it("updates metadata of an uploaded file without a spurious 400", async () => {
      const created = await upload(token, {
        file: PDF,
        filename: "rename-me.pdf",
        contentType: "application/pdf",
        fields: { title: "Before rename" },
      });
      expect(created.status).toBe(201);

      const patched = await authRequestJson(
        "patch",
        `${BASE}/resources/${created.body.data.id}`,
        token,
        { title: "After rename" },
      );

      expect(patched.status).toBe(200);
      expect(patched.body.data.title).toBe("After rename");
      expect(patched.body.data.storageType).toBe("UPLOAD");
    });

    it("still refuses an explicit UPLOAD storageType sent over JSON", async () => {
      const created = await upload(token, {
        file: PDF,
        filename: "no-switch.pdf",
        contentType: "application/pdf",
        fields: { title: "No switch" },
      });

      const patched = await authRequestJson(
        "patch",
        `${BASE}/resources/${created.body.data.id}`,
        token,
        { storageType: "UPLOAD" },
      );

      expect(patched.status).toBe(400);
    });
  });

  describe("POST /ai/attachments/upload", () => {
    it("accepts arbitrary binary content while storing an unknown type as octet-stream", async () => {
      const conversation = await authRequestJson("post", `${BASE}/ai/conversations`, token, {
        title: "Arbitrary attachment upload",
      });
      const bytes = Buffer.from([0x00, 0x01, 0xff, 0x02, 0x03]);
      const uploaded = await request(app)
        .post(`${BASE}/ai/attachments/upload`)
        .set(auth(token))
        .field("conversationId", conversation.body.data.id)
        .attach("file", bytes, {
          filename: "archive.custom",
          contentType: "application/x-custom",
        });

      expect(uploaded.status).toBe(201);
      expect(uploaded.body.data.attachment).toMatchObject({
        fileName: "archive.custom",
        mimeType: "application/octet-stream",
        fileSize: bytes.length,
      });

      const resourceId = uploaded.body.data.resourceId as string;
      const download = await request(app)
        .get(`${BASE}/resources/${resourceId}/download`)
        .set(auth(token))
        .buffer(true)
        .parse(binaryParser);
      expect(download.status).toBe(200);
      expect(download.headers["content-type"]).toContain("application/octet-stream");
      expect(Buffer.compare(download.body, bytes)).toBe(0);

      const deleted = await request(app).delete(`${BASE}/resources/${resourceId}`).set(auth(token));
      expect(deleted.status).toBe(200);
    });
  });

  describe("storage and database failures", () => {
    it("returns 503 and writes no row when storage fails", async () => {
      const failing: FileStorage = {
        put: async () => {
          throw new Error("disk on fire");
        },
        get: async () => Buffer.alloc(0),
        delete: async () => undefined,
      };
      setFileStorage(failing);
      try {
        const before = await prisma.resource.count();
        const res = await upload(token, {
          file: PDF,
          filename: "boom.pdf",
          contentType: "application/pdf",
          fields: { title: "Boom" },
        });

        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe("STORAGE_ERROR");
        expect(await prisma.resource.count()).toBe(before);
      } finally {
        setFileStorage(storage);
      }
    });

    it("rolls back the stored object when the database write fails", async () => {
      let putKey: string | null = null;
      let deletedKey: string | null = null;
      const recording: FileStorage = {
        put: async (key) => {
          putKey = key;
        },
        get: async () => Buffer.alloc(0),
        delete: async (key) => {
          deletedKey = key;
        },
      };
      setFileStorage(recording);

      // Patch the delegate directly and restore the exact original value:
      // vi.spyOn().mockRestore() leaves Prisma's proxy delegate's `create`
      // undefined, which would break every subsequent test.
      const original = prisma.resource.create;
      (prisma.resource as unknown as { create: unknown }).create = () => {
        throw new Error("db down");
      };
      try {
        const res = await upload(token, {
          file: PDF,
          filename: "rollback.pdf",
          contentType: "application/pdf",
          fields: { title: "Rollback" },
        });

        expect(res.status).toBe(500);
        expect(putKey).not.toBeNull();
        expect(deletedKey).toBe(putKey); // orphan cleaned up
      } finally {
        (prisma.resource as unknown as { create: unknown }).create = original;
        setFileStorage(storage);
      }
    });
  });

  describe("DELETE /resources/:id", () => {
    it("removes both the row and the stored file", async () => {
      const created = await upload(token, {
        file: PDF,
        filename: "delete-me.pdf",
        contentType: "application/pdf",
        fields: { title: "Delete me" },
      });
      const record = created.body.data;
      const diskPath = path.resolve(storageRoot, record.fileKey);

      await expect(fs.stat(diskPath)).resolves.toBeDefined();

      const deleted = await request(app)
        .delete(`${BASE}/resources/${record.id}`)
        .set(auth(token));
      expect(deleted.status).toBe(200);
      expect(deleted.body.data.deleted).toBe(true);

      await expect(fs.stat(diskPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        prisma.resource.findUnique({ where: { id: record.id } }),
      ).resolves.toBeNull();
    });

    it("keeps the row (retryable) when storage deletion fails", async () => {
      const created = await upload(token, {
        file: PDF,
        filename: "sticky.pdf",
        contentType: "application/pdf",
        fields: { title: "Sticky" },
      });
      const record = created.body.data;

      const failing: FileStorage = {
        put: async () => undefined,
        get: async () => Buffer.alloc(0),
        delete: async () => {
          throw new Error("cannot delete");
        },
      };
      setFileStorage(failing);
      try {
        const res = await request(app)
          .delete(`${BASE}/resources/${record.id}`)
          .set(auth(token));

        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe("STORAGE_ERROR");
        expect(await prisma.resource.findUnique({ where: { id: record.id } })).not.toBeNull();
      } finally {
        setFileStorage(storage);
      }
    });
  });

  describe("GET /resources/:id/download", () => {
    it("rejects downloading a URL resource", async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "A link",
        url: "https://example.org/a.pdf",
        storageType: "URL",
      });

      const res = await request(app)
        .get(`${BASE}/resources/${created.body.data.id}/download`)
        .set(auth(token));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("RESOURCE_NOT_A_FILE");
    });

    it("returns 404 for a missing file", async () => {
      const res = await request(app)
        .get(`${BASE}/resources/cmisuchanotexist0000000/download`)
        .set(auth(token));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("cross-user isolation", () => {
    let resourceId = "";

    beforeAll(async () => {
      const created = await upload(token, {
        file: PDF,
        filename: "private.pdf",
        contentType: "application/pdf",
        fields: { title: "Private" },
      });
      resourceId = created.body.data.id;
    });

    it("hides another user's uploaded resource metadata", async () => {
      const res = await request(app)
        .get(`${BASE}/resources/${resourceId}`)
        .set(auth(otherToken));
      expect(res.status).toBe(404);
    });

    it("does not let another user download the bytes", async () => {
      const res = await request(app)
        .get(`${BASE}/resources/${resourceId}/download`)
        .set(auth(otherToken));
      expect(res.status).toBe(404);
    });

    it("does not let another user delete the file", async () => {
      const res = await request(app)
        .delete(`${BASE}/resources/${resourceId}`)
        .set(auth(otherToken));
      expect(res.status).toBe(404);

      // The owner's file is untouched.
      const still = await request(app)
        .get(`${BASE}/resources/${resourceId}/download`)
        .set(auth(token))
        .buffer(true)
        .parse(binaryParser);
      expect(still.status).toBe(200);
    });
  });
});
