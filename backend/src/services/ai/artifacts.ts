import { prisma } from "@/utils/prisma";
import { NotFoundError } from "@/config/errors";
import { resourcesService } from "@/services/resources";
import { sanitizeFileName } from "@/utils/file-validation";

// ─────────────────────────────────────────────────────────────────────────────
// AI artifacts (generated files)
// ─────────────────────────────────────────────────────────────────────────────
//
// A generated document — a study guide, a summary, a revision sheet — is saved
// as two rows: an `Upload`-backed `Resource` (the bytes) and an `AiArtifact`
// that links it to the conversation and, once known, the assistant message.
//
// The artifact row carries only metadata; the text lives in object storage, so
// a large generated file never bloats the message transcript. The `.md`/`.txt`
// extension is inferred from the stored MIME type and the file name is sanitised
// through the same policy as any other upload.

export interface AiArtifactDto {
  id: string;
  conversationId: string;
  messageId: string | null;
  resourceId: string | null;
  name: string;
  description: string | null;
  mimeType: string;
  size: number;
  createdAt: string;
}

export const artifactsService = {
  /**
   * Persist generated text as a downloadable file plus its artifact row.
   *
   * The bytes go through `resourcesService.createFromUpload`, so ownership,
   * file-name validation and storage rollback all behave exactly as they do for
   * a student upload — an artifact is a real file, not a special case.
   */
  async createFromText(
    userId: string,
    conversationId: string,
    input: { name: string; description?: string | null; content: string; mimeType?: string },
  ): Promise<AiArtifactDto> {
    const buffer = Buffer.from(input.content, "utf8");
    const fileName = fileNameFor(input.name);
    // `text/markdown` is declared, but the stored type is whatever the bytes
    // actually sniff to (plain text for a text document), which is what a
    // download then serves. The artifact records the resource's real type.
    const resource = await resourcesService.createFromUpload(
      userId,
      { title: input.name, description: input.description ?? undefined, resourceType: "DOCUMENT" },
      { buffer, originalName: fileName, declaredMime: input.mimeType ?? "text/markdown" },
      { allowAnyMimeType: true },
    );

    const artifact = await prisma.aiArtifact.create({
      data: {
        userId,
        conversationId,
        resourceId: resource.id,
        name: input.name,
        description: input.description ?? null,
        mimeType: resource.mimeType ?? "text/plain",
        size: buffer.length,
      },
    });

    return mapArtifact(artifact);
  },

  /** Every artifact in a conversation, oldest first. Owner-scoped. */
  async listForConversation(userId: string, conversationId: string): Promise<AiArtifactDto[]> {
    const rows = await prisma.aiArtifact.findMany({
      where: { userId, conversationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapArtifact);
  },

  /** The artifacts already linked to one message, oldest first. */
  async listForMessage(userId: string, messageId: string): Promise<AiArtifactDto[]> {
    const rows = await prisma.aiArtifact.findMany({
      where: { userId, messageId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapArtifact);
  },

  async get(userId: string, id: string): Promise<AiArtifactDto> {
    const row = await prisma.aiArtifact.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundError("Artifact not found");
    return mapArtifact(row);
  },

  /**
   * Read the stored text back for verification.
   *
   * Verification compares the approved content against what is now on disk, so
   * a "saved" artifact whose bytes never landed is reported as unverified rather
   * than as a success.
   */
  async readText(userId: string, id: string): Promise<{ artifact: AiArtifactDto; text: string }> {
    const artifact = await this.get(userId, id);
    if (!artifact.resourceId) return { artifact, text: "" };
    const download = await resourcesService.getDownload(userId, artifact.resourceId);
    return { artifact, text: download.buffer.toString("utf8") };
  },

  /** Fetch the bytes for the owner, for the download endpoint. */
  async getDownload(userId: string, id: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const artifact = await this.get(userId, id);
    if (!artifact.resourceId) throw new NotFoundError("Artifact file not found");
    return resourcesService.getDownload(userId, artifact.resourceId);
  },

  /**
   * Attach freshly created artifacts to the assistant message they belong to.
   *
   * Artifacts are created during a confirmed write, before the assistant's
   * summary message exists, so the link is made just after that message is
   * stored. Only the caller's own artifacts can be relinked.
   */
  async linkToMessage(userId: string, artifactIds: string[], messageId: string): Promise<void> {
    const ids = [...new Set(artifactIds.filter(Boolean))];
    if (ids.length === 0) return;
    await prisma.aiArtifact.updateMany({
      where: { userId, id: { in: ids } },
      data: { messageId },
    });
  },
};

/** `name` reduced to a safe storage name with a text extension. */
function fileNameFor(name: string): string {
  const cleaned = sanitizeFileName(name);
  return /\.[a-z0-9]{1,5}$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
}

function mapArtifact(record: {
  id: string;
  conversationId: string;
  messageId: string | null;
  resourceId: string | null;
  name: string;
  description: string | null;
  mimeType: string | null;
  size: number | null;
  createdAt: Date;
}): AiArtifactDto {
  return {
    id: record.id,
    conversationId: record.conversationId,
    messageId: record.messageId,
    resourceId: record.resourceId,
    name: record.name,
    description: record.description,
    mimeType: record.mimeType ?? "text/plain",
    size: record.size ?? 0,
    createdAt: record.createdAt.toISOString(),
  };
}
