import { afterEach, describe, expect, it, vi } from "vitest";
import { resourcesService } from "@/services/resources";
import { getAiAttachmentContent } from "@/services/ai/attachments";

type Resource = Awaited<ReturnType<typeof resourcesService.getById>>;

function uploadedResource(id: string, fileName: string, mimeType: string): Resource {
  const timestamp = new Date(0).toISOString();
  return {
    id,
    courseId: null,
    title: fileName,
    description: null,
    url: null,
    storageType: "UPLOAD",
    fileKey: `resources/user/${id}/${fileName}`,
    fileName,
    fileSize: 4,
    mimeType,
    resourceType: "OTHER",
    createdAt: timestamp,
    updatedAt: timestamp,
    course: null,
  };
}

describe("AI attachment content", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes owner-scoped images and extracted documents while explaining unreadable types", async () => {
    const resources = new Map([
      ["image-id", uploadedResource("image-id", "diagram.png", "image/png")],
      ["doc-id", uploadedResource("doc-id", "notes.txt", "text/plain")],
      ["archive-id", uploadedResource("archive-id", "archive.zip", "application/zip")],
    ]);
    const getById = vi.spyOn(resourcesService, "getById").mockImplementation(
      async (userId, id) => {
        expect(userId).toBe("student-1");
        return resources.get(id)!;
      },
    );
    const getDownload = vi.spyOn(resourcesService, "getDownload").mockResolvedValue({
      buffer: Buffer.from("image"),
      mimeType: "image/png",
      fileName: "diagram.png",
    });
    const getContent = vi.spyOn(resourcesService, "getContent").mockResolvedValue({
      pages: [{ pageNumber: 1, text: "Study notes" }],
      fullText: "Study notes",
      pageCount: 1,
      charCount: 11,
      format: "txt",
    });

    const result = await getAiAttachmentContent("student-1", ["image-id", "doc-id", "archive-id"]);

    expect(getById).toHaveBeenCalledTimes(3);
    expect(getDownload).toHaveBeenCalledWith("student-1", "image-id");
    expect(getContent).toHaveBeenCalledWith("student-1", "doc-id");
    expect(getContent).not.toHaveBeenCalledWith("student-1", "archive-id");
    expect(result.imageParts).toEqual([{
      type: "image_url",
      image_url: { url: "data:image/png;base64,aW1hZ2U=", detail: "auto" },
    }]);
    expect(result.context).toContain("Study notes");
    expect(result.context).toContain("archive.zip");
    expect(result.context).toContain("not readable by the AI");
  });

  it("does not send images above the bounded multimodal size", async () => {
    vi.spyOn(resourcesService, "getById").mockResolvedValue(
      uploadedResource("large-image", "large.png", "image/png"),
    );
    vi.spyOn(resourcesService, "getDownload").mockResolvedValue({
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      mimeType: "image/png",
      fileName: "large.png",
    });

    const result = await getAiAttachmentContent("student-1", ["large-image"]);

    expect(result.imageParts).toHaveLength(0);
    expect(result.context).toContain("exceeds the image size limit");
  });
});
