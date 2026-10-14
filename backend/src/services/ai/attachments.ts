import { NotFoundError } from "@/config/errors";
import { resourcesService } from "@/services/resources";
import { isExtractionSupported } from "@/services/document-extraction";
import type { ChatMessageContentPart } from "./provider";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export interface AiAttachmentContent {
  context: string;
  imageParts: ChatMessageContentPart[];
}

export async function getAiAttachmentContent(
  userId: string,
  attachmentIds: string[],
): Promise<AiAttachmentContent> {
  const attachments = await Promise.all(
    attachmentIds.map(async (id) => {
      try {
        return await resourcesService.getById(userId, id);
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    }),
  );

  const context: string[] = [];
  const imageParts: ChatMessageContentPart[] = [];
  let totalImageBytes = 0;

  for (const attachment of attachments) {
    if (!attachment) continue;

    const fileName = attachment.fileName ?? attachment.title;
    if (attachment.storageType !== "UPLOAD") {
      context.push(`[Attachment "${fileName}" is a link and was not read.]`);
      continue;
    }

    if (attachment.mimeType && SUPPORTED_IMAGE_TYPES.has(attachment.mimeType)) {
      const { buffer, mimeType } = await resourcesService.getDownload(userId, attachment.id);
      if (
        buffer.length > MAX_IMAGE_BYTES ||
        totalImageBytes + buffer.length > MAX_TOTAL_IMAGE_BYTES
      ) {
        context.push(
          `[Image "${fileName}" was not sent to the AI because it exceeds the image size limit.]`,
        );
        continue;
      }

      totalImageBytes += buffer.length;
      imageParts.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${buffer.toString("base64")}`,
          detail: "auto",
        },
      });
      context.push(`[Image attached: "${fileName}".]`);
      continue;
    }

    if (attachment.mimeType && isExtractionSupported(attachment.mimeType)) {
      const extracted = await resourcesService.getContent(userId, attachment.id);
      context.push(
        `--- ATTACHMENT: ${fileName} (${extracted.format}, ${extracted.pageCount} page(s)) ---\n${extracted.fullText}\n--- END ATTACHMENT ---`,
      );
      continue;
    }

    context.push(
      `[Attachment "${fileName}" (${attachment.mimeType ?? "unknown file type"}) was uploaded but its contents are not readable by the AI.]`,
    );
  }

  return { context: context.join("\n\n"), imageParts };
}
