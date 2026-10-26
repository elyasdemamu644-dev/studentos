import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

import { app } from "@/app";
import { registerAndLogin, authRequestJson } from "./helpers";
import { LocalDiskStorage, setFileStorage } from "@/services/storage";
import { clearLinkContentCache } from "@/services/ai/link-content";

const BASE = "/api/v1";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

/**
 * Build a tiny but valid PDF with one page of text. The resource viewer only
 * needs a real body for the content endpoint, but the text-status endpoint
 * exercises pdf-parse and would silently pass with the malformed `PDF` buffer.
 */
function buildTextPdf(text: string): Buffer {
  const stream = `BT\n/F1 24 Tf\n72 700 Td\n(${text}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  const header = "%PDF-1.4\n";
  const offsets: number[] = [];
  let body = "";
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(header + body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(header + body);
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");

  return Buffer.from(header + body + xref, "latin1");
}

// superagent only hands back raw bytes when a binary parser is installed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function binaryParser(res: any, cb: (err: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

function uploadFile(
  token: string,
  file: Buffer,
  filename: string,
  contentType: string,
  fields: Record<string, string>,
) {
  let req = request(app).post(`${BASE}/resources/upload`).set(auth(token));
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  return req.attach("file", file, { filename, contentType });
}

describe("Resource viewer API", () => {
  let token = "";
  let otherToken = "";
  let storageRoot = "";
  let pdfId = "";

  beforeAll(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tutor-walle-viewer-"));
    setFileStorage(new LocalDiskStorage(storageRoot));

    token = (await registerAndLogin("viewer@test.com", "Pass123!")).token;
    otherToken = (await registerAndLogin("viewer-other@test.com", "Pass123!")).token;

    const uploaded = await uploadFile(token, PDF, "lecture.pdf", "application/pdf", {
      title: "Lecture PDF",
    });
    expect(uploaded.status).toBe(201);
    pdfId = uploaded.body.data.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearLinkContentCache();
  });

  afterAll(async () => {
    setFileStorage(null);
    await fs.rm(storageRoot, { recursive: true, force: true });
  });

  describe("GET /resources/:id/content", () => {
    it("serves an uploaded PDF inline with safe preview headers", async () => {
      const res = await request(app)
        .get(`${BASE}/resources/${pdfId}/content`)
        .set(auth(token))
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain("inline");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(res.headers["accept-ranges"]).toBe("bytes");
      expect(Buffer.compare(res.body, PDF)).toBe(0);
    });

    it("supports a single byte range", async () => {
      const res = await request(app)
        .get(`${BASE}/resources/${pdfId}/content`)
        .set(auth(token))
        .set("Range", "bytes=0-3")
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(206);
      expect(res.headers["content-range"]).toBe(`bytes 0-3/${PDF.length}`);
      expect(res.headers["content-length"]).toBe("4");
      expect(res.body.toString()).toBe("%PDF");
    });

    it("rejects an unsatisfiable range", async () => {
      const res = await request(app)
        .get(`${BASE}/resources/${pdfId}/content`)
        .set(auth(token))
        .set("Range", `bytes=${PDF.length + 10}-`);

      expect(res.status).toBe(416);
      expect(res.headers["content-range"]).toBe(`bytes */${PDF.length}`);
    });

    it("forces Office documents to octet-stream + attachment", async () => {
      const zip = new JSZip();
      zip.file("[Content_Types].xml", "<Types/>");
      const docx = await zip.generateAsync({ type: "nodebuffer" });

      const uploaded = await uploadFile(
        token,
        docx,
        "assignment.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        { title: "Assignment" },
      );
      expect(uploaded.status).toBe(201);

      const res = await request(app)
        .get(`${BASE}/resources/${uploaded.body.data.id}/content`)
        .set(auth(token))
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/octet-stream");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(Buffer.compare(res.body, docx)).toBe(0);
    });

    it("does not expose another user's file", async () => {
      const res = await request(app)
        .get(`${BASE}/resources/${pdfId}/content`)
        .set(auth(otherToken));

      expect(res.status).toBe(404);
    });
  });

  describe("GET /resources/:id/text", () => {
    it("extracts text from a real PDF", async () => {
      const uploaded = await uploadFile(
        token,
        buildTextPdf("Viewer extraction works"),
        "real.pdf",
        "application/pdf",
        { title: "Real PDF" },
      );
      expect(uploaded.status).toBe(201);

      const res = await authRequestJson(
        "get",
        `${BASE}/resources/${uploaded.body.data.id}/text`,
        token,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.supported).toBe(true);
      expect(res.body.data.status).toBe("ready");
      expect(res.body.data.format).toBe("pdf");
      expect(res.body.data.preview).toContain("Viewer extraction works");
    });

    it("reports extracted text for a supported file", async () => {
      const uploaded = await uploadFile(
        token,
        Buffer.from("Photosynthesis converts light into chemical energy."),
        "notes.txt",
        "text/plain",
        { title: "Biology notes" },
      );
      expect(uploaded.status).toBe(201);

      const res = await authRequestJson(
        "get",
        `${BASE}/resources/${uploaded.body.data.id}/text`,
        token,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.supported).toBe(true);
      expect(res.body.data.status).toBe("ready");
      expect(res.body.data.preview).toContain("Photosynthesis");
    });

    it("honestly reports an unsupported preview type", async () => {
      const uploaded = await uploadFile(
        token,
        Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
        "tool.exe",
        "application/octet-stream",
        { title: "Binary" },
      );
      expect(uploaded.status).toBe(201);

      const res = await authRequestJson(
        "get",
        `${BASE}/resources/${uploaded.body.data.id}/text`,
        token,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.supported).toBe(false);
      expect(res.body.data.status).toBe("unsupported");
    });
  });

  describe("GET /resources/:id/link-preview", () => {
    it("returns a text preview for a safe public link", async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Reading",
        url: "https://93.184.216.34/viewer-preview",
        storageType: "URL",
        resourceType: "LINK",
      });
      expect(created.status).toBe(201);

      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            "<html><head><title>Cell respiration</title></head><body><p>Glucose is oxidised to release energy.</p></body></html>",
            { status: 200, headers: { "content-type": "text/html" } },
          ),
        ),
      );
      clearLinkContentCache();

      const res = await authRequestJson(
        "get",
        `${BASE}/resources/${created.body.data.id}/link-preview`,
        token,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.available).toBe(true);
      expect(res.body.data.title).toBe("Cell respiration");
      expect(res.body.data.excerpt).toContain("Glucose is oxidised");
      expect(res.body.data.siteName).toBe("93.184.216.34");
    });
  });

  describe("progress", () => {
    let resourceId = "";

    beforeAll(async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Progress book",
        url: "https://example.org/progress",
        storageType: "URL",
        resourceType: "DOCUMENT",
      });
      resourceId = created.body.data.id;
    });

    it("starts empty and persists where the student stopped", async () => {
      const before = await authRequestJson(
        "get",
        `${BASE}/resources/${resourceId}/progress`,
        token,
      );
      expect(before.status).toBe(200);
      expect(before.body.data.page).toBeNull();
      expect(before.body.data.completed).toBe(false);

      const saved = await authRequestJson(
        "put",
        `${BASE}/resources/${resourceId}/progress`,
        token,
        { page: 7, percent: 42 },
      );
      expect(saved.status).toBe(200);
      expect(saved.body.data.page).toBe(7);
      expect(saved.body.data.percent).toBe(42);

      const resumed = await authRequestJson(
        "get",
        `${BASE}/resources/${resourceId}/progress`,
        token,
      );
      expect(resumed.body.data.page).toBe(7);
    });

    it("refuses completion without meaningful progress", async () => {
      const res = await authRequestJson(
        "put",
        `${BASE}/resources/${resourceId}/progress`,
        token,
        { page: 1, completed: true },
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("COMPLETION_NOT_MEANINGFUL");
    });

    it("records completion after meaningful progress and keeps it sticky", async () => {
      const completed = await authRequestJson(
        "put",
        `${BASE}/resources/${resourceId}/progress`,
        token,
        { page: 20, percent: 95, completed: true },
      );
      expect(completed.status).toBe(200);
      expect(completed.body.data.completed).toBe(true);

      const later = await authRequestJson(
        "put",
        `${BASE}/resources/${resourceId}/progress`,
        token,
        { page: 3, completed: false },
      );
      expect(later.body.data.completed).toBe(true);
      expect(later.body.data.page).toBe(3);
    });

    it("isolates progress by user", async () => {
      const res = await authRequestJson(
        "get",
        `${BASE}/resources/${resourceId}/progress`,
        otherToken,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("bookmarks", () => {
    it("creates, lists and deletes a bookmark", async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Bookmarked deck",
        url: "https://example.org/deck",
        storageType: "URL",
        resourceType: "SLIDES",
      });
      const resourceId = created.body.data.id;

      const bookmark = await authRequestJson(
        "post",
        `${BASE}/resources/${resourceId}/bookmarks`,
        token,
        { label: "Key diagram", slide: 12, note: "Exam focus" },
      );
      expect(bookmark.status).toBe(201);
      expect(bookmark.body.data.slide).toBe(12);

      const list = await authRequestJson(
        "get",
        `${BASE}/resources/${resourceId}/bookmarks`,
        token,
      );
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].label).toBe("Key diagram");

      const removed = await authRequestJson(
        "delete",
        `${BASE}/resources/${resourceId}/bookmarks/${bookmark.body.data.id}`,
        token,
      );
      expect(removed.status).toBe(200);

      const empty = await authRequestJson(
        "get",
        `${BASE}/resources/${resourceId}/bookmarks`,
        token,
      );
      expect(empty.body.data).toHaveLength(0);
    });

    it("does not let another user bookmark the resource", async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Private deck",
        url: "https://example.org/private-deck",
        storageType: "URL",
        resourceType: "SLIDES",
      });

      const res = await authRequestJson(
        "post",
        `${BASE}/resources/${created.body.data.id}/bookmarks`,
        otherToken,
        { label: "Intruder", slide: 2 },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("resource-scoped notes", () => {
    it("associates a note with a resource and filters by it", async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Notes target",
        url: "https://example.org/notes-target",
        storageType: "URL",
      });
      const resourceId = created.body.data.id;

      const note = await authRequestJson("post", `${BASE}/notes`, token, {
        title: "Respiration",
        content: "Glycolysis happens in the cytoplasm.",
        resourceId,
      });
      expect(note.status).toBe(201);
      expect(note.body.data.resourceId).toBe(resourceId);

      const list = await authRequestJson(
        "get",
        `${BASE}/notes?resourceId=${resourceId}`,
        token,
      );
      expect(list.status).toBe(200);
      expect(list.body.data.items).toHaveLength(1);
      expect(list.body.data.items[0].id).toBe(note.body.data.id);
    });

    it("rejects a note on another user's resource", async () => {
      const created = await authRequestJson("post", `${BASE}/resources`, token, {
        title: "Owned elsewhere",
        url: "https://example.org/elsewhere",
        storageType: "URL",
      });

      const res = await authRequestJson("post", `${BASE}/notes`, otherToken, {
        title: "Wrong owner",
        content: "Should not attach.",
        resourceId: created.body.data.id,
      });
      expect(res.status).toBe(404);
    });
  });
});
