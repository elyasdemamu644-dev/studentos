import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import {
  extractCsvText,
  extractDocumentText,
  isExtractionSupported,
} from "@/services/document-extraction";

/** Smallest ZIP that looks like an OOXML presentation to the extractor. */
async function pptxFixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree><p:sp><p:txBody>
          <a:p><a:r><a:t>Cell biology &amp; genetics</a:t></a:r></a:p>
          <a:p><a:r><a:t>Mitochondria</a:t></a:r></a:p>
        </p:txBody></p:sp></p:spTree></p:cSld>
      </p:sld>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
             xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree><p:sp><p:txBody>
          <a:p><a:r><a:t>ATP &#x2192; energy</a:t></a:r></a:p>
        </p:txBody></p:sp></p:spTree></p:cSld>
      </p:sld>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("document extraction", () => {
  it("parses CSV as plain text and strips a BOM", () => {
    const csv = Buffer.from("\uFEFFcourse,grade\nDB301,A\nCS201,B+\n", "utf-8");

    const result = extractCsvText(csv);

    expect(result.format).toBe("csv");
    expect(result.fullText.startsWith("course,grade")).toBe(true);
    expect(result.fullText).toContain("DB301,A");
    expect(result.pageCount).toBe(1);
  });

  it("routes a CSV MIME type to the plain-text extractor", async () => {
    const result = await extractDocumentText(Buffer.from("a,b\n1,2\n"), "text/csv");

    expect(result.format).toBe("csv");
    expect(result.fullText).toBe("a,b\n1,2");
  });

  it("extracts text runs from a PPTX deck in slide order", async () => {
    const result = await extractDocumentText(
      await pptxFixture(),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );

    expect(result.format).toBe("pptx");
    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].text).toContain("Cell biology & genetics");
    expect(result.pages[0].text).toContain("Mitochondria");
    expect(result.pages[1].text).toContain("ATP \u2192 energy");
  });

  it("extracts every sheet from an XLSX workbook", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Course", "Grade"],
        ["DB301", "A"],
      ]),
      "Semester 1",
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["Exam", 92]]),
      "Results",
    );
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const result = await extractDocumentText(
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    expect(result.format).toBe("xlsx");
    expect(result.pageCount).toBe(2);
    expect(result.fullText).toContain("Sheet: Semester 1");
    expect(result.fullText).toContain("DB301, A");
    expect(result.fullText).toContain("Sheet: Results");
    expect(result.fullText).toContain("Exam, 92");
  });

  it("reports every bundled parser as supported", () => {
    expect(isExtractionSupported("application/pdf")).toBe(true);
    expect(
      isExtractionSupported(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(
      isExtractionSupported(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe(true);
    expect(
      isExtractionSupported(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(true);
    expect(isExtractionSupported("application/vnd.ms-excel")).toBe(true);
    expect(isExtractionSupported("text/plain")).toBe(true);
    expect(isExtractionSupported("text/markdown")).toBe(true);
    expect(isExtractionSupported("text/csv")).toBe(true);

    expect(isExtractionSupported("application/zip")).toBe(false);
    expect(isExtractionSupported("image/png")).toBe(false);
  });
});
