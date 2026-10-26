"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  BookmarkPlus,
  Bot,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileQuestion,
  Lightbulb,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { formatApiError } from "@/components/states";
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useUpdateNote,
} from "@/features/notes/hooks";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { classifyResourceViewer } from "@tutor-walle/shared/schemas/resource-viewer";
import type {
  Note,
  ResourceBookmark,
  ResourceProgress,
  ResourceRecord,
} from "@/types/api-types";
import {
  useCreateResourceBookmark,
  useDeleteResourceBookmark,
  useResourceBookmarks,
  useResourceTextStatus,
} from "../hooks";
import { formatTimestamp, type ViewerLocation } from "./types";

type StudyTab = "ai" | "notes" | "bookmarks";

export interface StudyPanelProps {
  resource: ResourceRecord;
  progress: ResourceProgress;
  location: ViewerLocation | null;
  onJump: (bookmark: Pick<ResourceBookmark, "page" | "slide" | "positionSeconds">) => void;
  onMarkComplete: () => void;
  completing?: boolean;
  showHeader?: boolean;
  className?: string;
}

const AI_ACTIONS = [
  {
    label: "Summarise this resource",
    icon: ClipboardList,
    prompt: "Summarise the attached resource with the key ideas and exam-relevant points.",
  },
  {
    label: "Explain the key concepts",
    icon: Lightbulb,
    prompt:
      "Explain the key concepts in the attached resource step by step, with simple examples.",
  },
  {
    label: "Quiz me",
    icon: FileQuestion,
    prompt:
      "Create a short quiz from the attached resource. Ask one question at a time and wait for my answer before marking it.",
  },
  {
    label: "Build a study plan",
    icon: MessageSquareText,
    prompt:
      "Using the attached resource, build a focused study plan for the next week with specific sessions and practice tasks.",
  },
] as const;

export function StudyPanel({
  resource,
  progress,
  location,
  onJump,
  onMarkComplete,
  completing,
  showHeader = true,
  className,
}: StudyPanelProps) {
  const [tab, setTab] = useState<StudyTab>("ai");
  const classification = useMemo(
    () =>
      classifyResourceViewer({
        storageType: resource.storageType,
        mimeType: resource.mimeType,
        fileName: resource.fileName,
        resourceType: resource.resourceType,
        url: resource.url,
      }),
    [resource],
  );
  const textStatus = useResourceTextStatus(resource.id);
  const bookmarks = useResourceBookmarks(resource.id);
  const notes = useNotes({ resourceId: resource.id, limit: 100 });

  const currentPage = location?.page ?? progress.page;
  const currentSlide = location?.slide ?? progress.slide;
  const currentSeconds = location?.positionSeconds ?? progress.positionSeconds;
  const percent = location?.percent ?? progress.percent;
  const currentLabel =
    location?.label ??
    (currentPage != null
      ? `Page ${currentPage}`
      : currentSlide != null
        ? `Slide ${currentSlide}`
        : currentSeconds != null
          ? formatTimestamp(currentSeconds)
          : null);

  const canComplete =
    !progress.completed &&
    ((percent != null && percent >= 90) ||
      (currentPage != null && currentPage >= 2) ||
      (currentSlide != null && currentSlide >= 2) ||
      (currentSeconds != null && currentSeconds >= 15));

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      {showHeader && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">Study tools</h2>
        </div>
      )}

      <div className="shrink-0 space-y-3 border-b border-border p-3">
        <SegmentedControl<StudyTab>
          label="Study tool"
          value={tab}
          onChange={setTab}
          options={[
            { value: "ai", label: "AI", icon: <Bot className="h-3.5 w-3.5" aria-hidden /> },
            {
              value: "notes",
              label: `Notes${notes.data ? ` (${notes.data.items.length})` : ""}`,
              icon: <StickyNote className="h-3.5 w-3.5" aria-hidden />,
            },
            {
              value: "bookmarks",
              label: `Marks${bookmarks.data ? ` (${bookmarks.data.length})` : ""}`,
              icon: <Bookmark className="h-3.5 w-3.5" aria-hidden />,
            },
          ]}
          className="w-full [&>button]:flex-1"
        />

        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {progress.completed ? "Completed" : currentLabel ?? "Not started"}
            </span>
            {progress.completed ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-medium text-success">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> Done
              </span>
            ) : canComplete ? (
              <Button size="sm" variant="outline" onClick={onMarkComplete} disabled={completing}>
                {completing ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                )}
                Mark complete
              </Button>
            ) : null}
          </div>
          {percent != null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", progress.completed ? "bg-success" : "bg-primary")}
                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "ai" && (
          <AiTab
            resourceId={resource.id}
            resourceTitle={resource.title}
            classification={classification}
            textStatus={textStatus}
          />
        )}
        {tab === "notes" && (
          <NotesTab
            resource={resource}
            notes={notes.data?.items ?? []}
            isPending={notes.isPending}
            isError={notes.isError}
            error={notes.error}
            onRetry={() => void notes.refetch()}
          />
        )}
        {tab === "bookmarks" && (
          <BookmarksTab
            resourceId={resource.id}
            currentLabel={currentLabel}
            currentPage={currentPage}
            currentSlide={currentSlide}
            currentSeconds={currentSeconds}
            bookmarks={bookmarks.data ?? []}
            isPending={bookmarks.isPending}
            isError={bookmarks.isError}
            error={bookmarks.error}
            onRetry={() => void bookmarks.refetch()}
            onJump={onJump}
          />
        )}
      </div>
    </div>
  );
}

function AiTab({
  resourceId,
  resourceTitle,
  classification,
  textStatus,
}: {
  resourceId: string;
  resourceTitle: string;
  classification: ReturnType<typeof classifyResourceViewer>;
  textStatus: ReturnType<typeof useResourceTextStatus>;
}) {
  const aiHref = (prompt: string) =>
    `/ai?resourceId=${encodeURIComponent(resourceId)}&prompt=${encodeURIComponent(prompt)}`;

  const readable =
    classification.kind === "link" || classification.aiReadable;
  const status = textStatus.data;

  return (
    <div className="space-y-4 p-3">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Study with AI
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The resource is attached to the conversation automatically, so questions stay grounded in
          this material.
        </p>

        <div className="mt-3 flex items-start gap-2 text-xs">
          {classification.kind === "link" ? (
            <span className="text-muted-foreground">
              The assistant will fetch this public page when you ask. Private or blocked pages cannot
              be read.
            </span>
          ) : classification.kind === "image" ? (
            <span className="text-muted-foreground">
              {classification.aiReadable
                ? "The image is sent to the model. A vision-capable provider is required."
                : "This image format cannot be sent to the AI. Download or convert it to PNG, JPEG or WebP."}
            </span>
          ) : textStatus.isPending ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking text extraction…
            </span>
          ) : status?.status === "ready" ? (
            <span className="text-muted-foreground">
              Text ready{status.pageCount ? ` · ${status.pageCount} page${status.pageCount === 1 ? "" : "s"}` : ""}
              {status.charCount ? ` · ${status.charCount.toLocaleString()} characters` : ""}
            </span>
          ) : (
            <span className="text-warning">
              {status?.reason ?? classification.reason ?? "The assistant may not be able to read this file."}
            </span>
          )}
        </div>

        {status?.status === "ready" && status.preview && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Preview extracted text
            </summary>
            <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-muted-foreground">
              {status.preview}
            </p>
          </details>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quick actions
        </p>
        {readable ? (
          AI_ACTIONS.map((action) => (
            <Link
              key={action.label}
              href={aiHref(`Using the attached resource "${resourceTitle}": ${action.prompt}`)}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <action.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">{action.label}</span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </Link>
          ))
        ) : (
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            AI study actions are unavailable because this file type cannot be read by the assistant.
            You can still write notes and bookmark it.
          </p>
        )}
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        AI answers can be wrong. Verify important details against the original material.
      </p>
    </div>
  );
}

function NotesTab({
  resource,
  notes,
  isPending,
  isError,
  error,
  onRetry,
}: {
  resource: ResourceRecord;
  notes: Note[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    setEditingId(null);
    setConfirmingId(null);
    setTitle("");
    setContent("");
  }, [resource.id]);

  const sorted = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes],
  );

  const add = async () => {
    if (!content.trim() || createNote.isPending) return;
    try {
      await createNote.mutateAsync({
        title: title.trim() || `Note on ${resource.title}`,
        content: content.trim(),
        courseId: resource.courseId,
        resourceId: resource.id,
      });
      setTitle("");
      setContent("");
    } catch {
      // The mutation hook reports the API error.
    }
  };

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setConfirmingId(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editContent.trim() || updateNote.isPending) return;
    try {
      await updateNote.mutateAsync({
        id: editingId,
        input: {
          title: editTitle.trim() || "Untitled note",
          content: editContent.trim(),
        },
      });
      setEditingId(null);
    } catch {
      // The mutation hook reports the API error.
    }
  };

  const remove = async (noteId: string) => {
    try {
      await deleteNote.mutateAsync(noteId);
      setConfirmingId(null);
    } catch {
      // The mutation hook reports the API error.
    }
  };

  return (
    <div className="space-y-4 p-3">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <Label htmlFor="study-note-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Add a note
        </Label>
        <Input
          id="study-note-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={`Note on ${resource.title}`}
          className="mt-2 h-8 text-sm"
          maxLength={200}
        />
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="What do you want to remember?"
          rows={4}
          className="mt-2 min-h-20 resize-y text-sm"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={() => void add()} disabled={!content.trim() || createNote.isPending}>
            {createNote.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            Add note
          </Button>
        </div>
      </div>

      {isPending ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading notes…
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <p>Notes could not be loaded.</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatApiError(error)}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No notes on this resource yet.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Resource notes">
          {sorted.map((note) => (
            <li key={note.id} className="rounded-lg border border-border bg-card p-3">
              {editingId === note.id ? (
                <div className="space-y-2">
                  <Input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    aria-label="Note title"
                    maxLength={200}
                    className="h-8 text-sm"
                  />
                  <Textarea
                    value={editContent}
                    onChange={(event) => setEditContent(event.target.value)}
                    aria-label="Note content"
                    rows={5}
                    className="text-sm"
                  />
                  <div className="flex justify-end gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void saveEdit()}
                      disabled={!editContent.trim() || updateNote.isPending}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{note.title}</p>
                      <p className="text-[11px] text-muted-foreground">{relativeTime(note.updatedAt)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${note.title}`}
                      onClick={() => startEdit(note)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    {confirmingId === note.id ? (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deleteNote.isPending}
                        onClick={() => void remove(note.id)}
                      >
                        Delete
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-danger hover:text-danger"
                        aria-label={`Delete ${note.title}`}
                        onClick={() => setConfirmingId(note.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {note.content}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookmarksTab({
  resourceId,
  currentLabel,
  currentPage,
  currentSlide,
  currentSeconds,
  bookmarks,
  isPending,
  isError,
  error,
  onRetry,
  onJump,
}: {
  resourceId: string;
  currentLabel: string | null;
  currentPage: number | null | undefined;
  currentSlide: number | null | undefined;
  currentSeconds: number | null | undefined;
  bookmarks: ResourceBookmark[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onJump: StudyPanelProps["onJump"];
}) {
  const createBookmark = useCreateResourceBookmark(resourceId);
  const deleteBookmark = useDeleteResourceBookmark(resourceId);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const hasPosition = currentPage != null || currentSlide != null || currentSeconds != null;
  const defaultLabel = currentLabel ?? "Bookmark";

  useEffect(() => {
    setLabel("");
    setNote("");
    setConfirmingId(null);
  }, [resourceId]);

  const add = async () => {
    if (!hasPosition || createBookmark.isPending) return;
    try {
      await createBookmark.mutateAsync({
        label: label.trim() || defaultLabel,
        page: currentPage ?? undefined,
        slide: currentSlide ?? undefined,
        positionSeconds: currentSeconds ?? undefined,
        note: note.trim() || null,
      });
      setLabel("");
      setNote("");
    } catch {
      // The mutation hook reports the API error.
    }
  };

  const remove = async (bookmarkId: string) => {
    try {
      await deleteBookmark.mutateAsync(bookmarkId);
      setConfirmingId(null);
    } catch {
      // The mutation hook reports the API error.
    }
  };

  return (
    <div className="space-y-4 p-3">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Bookmark this spot
        </p>
        {hasPosition ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              {defaultLabel}
            </p>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={`Label (default: ${defaultLabel})`}
              className="mt-2 h-8 text-sm"
              maxLength={120}
              aria-label="Bookmark label"
            />
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional note"
              rows={2}
              className="mt-2 min-h-14 resize-y text-sm"
              maxLength={1000}
              aria-label="Bookmark note"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={() => void add()} disabled={createBookmark.isPending}>
                {createBookmark.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                Add bookmark
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            This resource has no page, slide or timestamp to bookmark. Use notes instead.
          </p>
        )}
      </div>

      {isPending ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading bookmarks…
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <p>Bookmarks could not be loaded.</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatApiError(error)}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : bookmarks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No bookmarks yet. Open a page, slide or timestamp and save it here.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Resource bookmarks">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onJump(bookmark)}
                >
                  <p className="truncate text-sm font-medium">{bookmark.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {bookmark.page != null
                      ? `Page ${bookmark.page}`
                      : bookmark.slide != null
                        ? `Slide ${bookmark.slide}`
                        : bookmark.positionSeconds != null
                          ? formatTimestamp(bookmark.positionSeconds)
                          : "Saved position"}
                    {" · "}
                    {relativeTime(bookmark.createdAt)}
                  </p>
                </button>
                {confirmingId === bookmark.id ? (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={deleteBookmark.isPending}
                    onClick={() => void remove(bookmark.id)}
                  >
                    Delete
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-danger hover:text-danger"
                    aria-label={`Delete bookmark ${bookmark.label}`}
                    onClick={() => setConfirmingId(bookmark.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                )}
              </div>
              {bookmark.note && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{bookmark.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
