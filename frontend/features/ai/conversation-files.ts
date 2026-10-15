import type { AiArtifact, AiMessage } from "@/types/api-types";

/**
 * One file attached to a conversation, from either of the two sources that can
 * put a file there: something the student uploaded (an `AiMessageAttachment`,
 * reachable through the conversation's messages) or something the assistant
 * generated (an `AiArtifact`, listed by `/ai/conversations/:id/artifacts`).
 *
 * The two live in different shapes behind different endpoints, so the Files
 * surface folds them into one list here rather than teaching the UI both.
 */
export type ConversationFileKind = "attachment" | "artifact";

export interface ConversationFile {
  /** Stable list key, and what distinguishes the two id spaces. */
  key: string;
  id: string;
  kind: ConversationFileKind;
  name: string;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
  /** Download target for a generated file. */
  artifactId?: string;
  /** Download target for an uploaded file. */
  resourceId?: string;
}

/**
 * Fold the conversation's generated artifacts and its messages' attachments
 * into one deduplicated, newest-first list.
 *
 * Generated files are read *only* from the artifacts endpoint, never from
 * `message.artifacts`, precisely because a generated file is often both linked
 * to its reply and listed by the conversation endpoint — reading both would
 * show the same file twice. Uploaded files come from the messages, the only
 * place they exist. The two id spaces are disjoint, and the `kind:` prefix
 * keeps the keys disjoint too, so the result is inherently deduplicated.
 */
export function collectConversationFiles(
  artifacts: AiArtifact[],
  messages: AiMessage[],
): ConversationFile[] {
  const files: ConversationFile[] = [];

  for (const artifact of artifacts) {
    files.push({
      key: `artifact:${artifact.id}`,
      id: artifact.id,
      kind: "artifact",
      name: artifact.name,
      mimeType: artifact.mimeType ?? null,
      size: artifact.size ?? null,
      createdAt: artifact.createdAt,
      artifactId: artifact.id,
    });
  }

  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      files.push({
        key: `attachment:${attachment.id}`,
        id: attachment.id,
        kind: "attachment",
        name: attachment.fileName,
        mimeType: attachment.mimeType ?? null,
        size: attachment.fileSize ?? null,
        // An attachment carries no timestamp of its own; its message's creation
        // time is the closest thing to when it entered the conversation.
        createdAt: message.createdAt,
        resourceId: attachment.resourceId,
      });
    }
  }

  return files.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
