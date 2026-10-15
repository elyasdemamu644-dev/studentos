"use client";

import { useState } from "react";
import { Download, FileText, FolderOpen, Paperclip } from "lucide-react";

import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { formatBytes, formatDate } from "@/lib/format";
import { useArtifacts, useDownloadConversationFile, useMessages } from "@/features/ai/hooks";
import { collectConversationFiles, type ConversationFile } from "@/features/ai/conversation-files";

/**
 * The Files surface for the open conversation.
 *
 * It answers one question — "what files does this conversation hold?" — by
 * folding the two things that can put a file in a conversation into one list:
 * uploaded attachments (reachable through the messages) and files the assistant
 * generated (listed by the artifacts endpoint). Each row says which it is, and
 * opening one fetches its bytes through the authenticated API, because the
 * bytes are owner-scoped and a plain link would 401.
 *
 * The body is deliberately headerless: in the workspace the `WorkspacePanel`
 * that wraps it owns the header and the single collapse control, and the drawer
 * below supplies its own heading. Keeping the header out of here is what stops
 * the two placements from growing two headers — or two collapse buttons.
 */

/** Trigger a browser download for a fetched blob, then release the object URL. */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function FileRow({
  file,
  busy,
  onDownload,
}: {
  file: ConversationFile;
  busy: boolean;
  onDownload: (file: ConversationFile) => void;
}) {
  const generated = file.kind === "artifact";
  const Icon = generated ? FileText : Paperclip;

  return (
    <li>
      <button
        type="button"
        onClick={() => onDownload(file)}
        disabled={busy}
        aria-label={`Download ${file.name}`}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left shadow-card transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            generated ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{file.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {generated ? "Generated file" : "Uploaded file"}
            {" · "}
            {formatBytes(file.size)}
            {" · "}
            {formatDate(file.createdAt, "MMM d")}
          </span>
        </span>
        <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

/**
 * The panel body: every file in the conversation, newest first.
 *
 * Headerless on purpose — the column and the drawer each supply their own, so
 * the two placements cannot end up with two. Everything it shows comes from the
 * real endpoints: the artifacts list and the conversation's messages. No
 * invented rows.
 */
export function AiFilesPanel({ conversationId }: { conversationId: string | null }) {
  const artifacts = useArtifacts(conversationId ?? undefined);
  const messages = useMessages(conversationId ?? undefined);
  const download = useDownloadConversationFile();

  const hasConversation = Boolean(conversationId);
  const files = collectConversationFiles(artifacts.data ?? [], messages.data ?? []);
  // A disabled query reports `isPending` forever, which would pin the skeleton
  // on screen when no conversation is open — so this is "the open conversation
  // has no data yet", not "a refetch is in flight".
  const isPending = hasConversation && (artifacts.isPending || messages.isPending);
  const isError = hasConversation && (artifacts.isError || messages.isError);
  const error = artifacts.error ?? messages.error;

  const onDownload = (file: ConversationFile) => {
    download.mutate(file, {
      onSuccess: ({ blob, fileName }) => {
        saveBlob(blob, fileName ?? file.name);
      },
    });
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden" aria-label="Conversation files">
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        tabIndex={0}
        role="region"
        aria-label="Conversation files list"
      >
        {!hasConversation ? (
          <p className="m-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Open a conversation to see the files you upload and the assistant generates.
          </p>
        ) : isPending ? (
          <div className="p-3">
            <ListSkeleton rows={3} label="Loading files" />
          </div>
        ) : isError ? (
          <div className="p-3">
            <ErrorState
              error={error}
              title="Unable to load files"
              retry={() => {
                void artifacts.refetch();
                void messages.refetch();
              }}
            />
          </div>
        ) : files.length === 0 ? (
          <p className="m-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            No files yet. Upload one with a message, or ask the assistant to save one.
          </p>
        ) : (
          <ul className="space-y-1.5 p-3">
            {files.map((file) => (
              <FileRow
                key={file.key}
                file={file}
                busy={download.isPending && download.variables?.key === file.key}
                onDownload={onDownload}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

/**
 * Drawer version of the Files panel, for the widths with no room for a fourth
 * column. The trigger disappears exactly when the column appears, so the two
 * are never both offering the same surface.
 */
export function AiFilesDrawer({ conversationId }: { conversationId: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open conversation files"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-ai px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-card transition-colors hover:text-foreground max-sm:h-11 max-sm:w-11 max-sm:justify-center max-sm:gap-0 max-sm:px-0 lg:h-11 lg:w-11 lg:justify-center lg:gap-0 lg:px-0 min-[1600px]:hidden"
      >
        <FolderOpen className="h-3.5 w-3.5" aria-hidden />
        <span className="max-sm:sr-only lg:sr-only">Files</span>
      </button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        side="right"
        title="Conversation Files"
        description="Uploaded and generated files in this conversation"
      >
        <AiFilesPanel conversationId={conversationId} />
      </Drawer>
    </>
  );
}
