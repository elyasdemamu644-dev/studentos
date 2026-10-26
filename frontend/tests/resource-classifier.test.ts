import { describe, expect, it } from "vitest";

import {
  classifyResourceViewer,
  isResourceAiReadable,
} from "@tutor-walle/shared/schemas/resource-viewer";

describe("classifyResourceViewer", () => {
  it.each([
    ["sample.mp3", "application/octet-stream", "audio", "audio/mpeg"],
    ["sample.mp4", "application/octet-stream", "video", "video/mp4"],
    ["sample.png", "application/octet-stream", "image", "image/png"],
    ["sample.docx", "application/octet-stream", "docx", null],
    ["sample.pptx", "application/zip", "pptx", null],
    ["sample.xlsx", "application/zip", "spreadsheet", null],
    ["sample.md", "text/plain", "markdown", null],
    ["sample.csv", "text/plain", "spreadsheet", null],
    ["sample.zip", "application/zip", "archive", null],
  ] as const)(
    "classifies %s from its filename when upload sniffing returns %s",
    (fileName, mimeType, kind, contentType) => {
      const result = classifyResourceViewer({
        storageType: "UPLOAD",
        fileName,
        mimeType,
      });

      expect(result.kind).toBe(kind);
      if (contentType) expect(result.contentType).toBe(contentType);
    },
  );

  it("treats URL resources as links even without a MIME type", () => {
    const result = classifyResourceViewer({
      storageType: "URL",
      url: "https://example.com/notes",
    });

    expect(result.kind).toBe("link");
    expect(result.aiReadable).toBe(true);
  });

  it("reports legacy Office files as unsupported rather than guessing", () => {
    const result = classifyResourceViewer({
      storageType: "UPLOAD",
      fileName: "old-notes.doc",
      mimeType: "application/msword",
    });

    expect(result.kind).toBe("unsupported");
    expect(result.inlineSafe).toBe(false);
    expect(isResourceAiReadable({
      storageType: "UPLOAD",
      fileName: "old-notes.doc",
      mimeType: "application/msword",
    })).toBe(false);
  });
});
