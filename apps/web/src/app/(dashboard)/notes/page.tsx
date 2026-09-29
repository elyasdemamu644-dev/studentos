"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FilePlus2, Search, StickyNote, Trash2, UserRound } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Button, LoadingButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCourses } from "@/features/courses/hooks";
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from "@/features/notes/hooks";
import type { Note } from "@/types/api-types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Draft {
  title: string;
  content: string;
  courseId: string;
}

export default function NotesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: "", content: "", courseId: "" });
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notes = useNotes({
    search: search || undefined,
    courseId: courseFilter || undefined,
    limit: 200,
  });
  const courses = useCourses();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const selectedNote: Note | undefined =
    selectedId !== null && selectedId !== "new"
      ? (notes.data?.items ?? []).find((n) => n.id === selectedId)
      : undefined;

  useEffect(() => {
    const noteParam = searchParams.get("note");
    if (noteParam) {
      setSelectedId(noteParam);
      router.replace("/notes");
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (selectedId === null) return;
    if (selectedId === "new") {
      setDraft({ title: "", content: "", courseId: courseFilter });
    } else if (selectedNote) {
      setDraft({
        title: selectedNote.title,
        content: selectedNote.content,
        courseId: selectedNote.courseId ?? "",
      });
    }
    dirtyRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedNote?.id]);

  const persist = async () => {
    if (!dirtyRef.current || saving) return;
    dirtyRef.current = false;
    setSaving(true);
    try {
      if (selectedId === "new") {
        const note = await createNote.mutateAsync({
          title: draft.title.trim() || "Untitled note",
          content: draft.content,
          courseId: draft.courseId || null,
        });
        setSelectedId(note.id);
      } else if (selectedId) {
        await updateNote.mutateAsync({
          id: selectedId,
          input: {
            title: draft.title.trim() || "Untitled note",
            content: draft.content,
            courseId: draft.courseId || null,
          },
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const onDraftChange = (next: Draft) => {
    setDraft(next);
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 800);
  };

  const startNew = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void persist().then(() => setSelectedId("new"));
  };

  const onDelete = () => {
    if (!selectedId || selectedId === "new") {
      setSelectedId(null);
      return;
    }
    void deleteNote.mutateAsync(selectedId).then(() => {
      setSelectedId(null);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    });
  };

  const sortedNotes = [...(notes.data?.items ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  return (
    <div>
      <PageHeader
        kicker="Knowledge"
        title="Notes"
        description="Capture study notes and course material."
        actions={
          <Button size="sm" onClick={startNew}>
            <FilePlus2 className="mr-1.5 h-4 w-4" aria-hidden /> New note
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
              className="pl-9"
            />
          </div>
          <Select value={courseFilter} onValueChange={setCourseFilter}>
            <SelectTrigger aria-label="Filter by course">
              <SelectValue placeholder="All courses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All courses</SelectItem>
              {(courses.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {notes.isPending ? (
            <ListSkeleton rows={5} />
          ) : notes.isError ? (
            <ErrorState error={notes.error} retry={() => notes.refetch()} />
          ) : sortedNotes.length === 0 ? (
            <EmptyState
              icon={StickyNote}
              title={search || courseFilter ? "No matching notes" : "No notes yet"}
              className="py-8"
            />
          ) : (
            <ul className="max-h-[65vh] space-y-1 overflow-y-auto pr-1" aria-label="Notes list">
              {sortedNotes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(note.id)}
                    aria-current={selectedId === note.id ? "true" : undefined}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                      selectedId === note.id
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-card hover:border-primary/30",
                    )}
                  >
                    <span className="block truncate text-sm font-medium">{note.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {relativeTime(note.updatedAt)}
                      {note.course && (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <UserRound className="h-3 w-3" aria-hidden /> {note.course.name}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          {selectedId === null ? (
            <EmptyState
              icon={StickyNote}
              title="No note selected"
              description="Pick a note from the list or create a new one."
              action={
                <Button size="sm" onClick={startNew}>
                  <FilePlus2 className="mr-1.5 h-4 w-4" aria-hidden /> New note
                </Button>
              }
            />
          ) : (
            <div className="flex min-h-[65vh] flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {saving ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" aria-hidden />
                      Saving…
                    </span>
                  ) : dirtyRef.current ? (
                    <span>Unsaved changes</span>
                  ) : selectedNote ? (
                    <span>Last edited {relativeTime(selectedNote.updatedAt)}</span>
                  ) : (
                    <span>New note</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={onDelete}>
                    <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Delete
                  </Button>
                  <LoadingButton size="sm" loading={saving} onClick={() => void persist()}>
                    Save
                  </LoadingButton>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="note-title" className="sr-only">Title</Label>
                <Input
                  id="note-title"
                  value={draft.title}
                  onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
                  placeholder="Note title"
                  className="border-0 bg-transparent px-0 text-xl font-semibold shadow-none focus-visible:ring-0"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="note-course">Course</Label>
                <Select
                  value={draft.courseId}
                  onValueChange={(v) => onDraftChange({ ...draft, courseId: v })}
                >
                  <SelectTrigger id="note-course" className="w-full sm:w-64">
                    <SelectValue placeholder="No course" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No course</SelectItem>
                    {(courses.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 space-y-2">
                <Label htmlFor="note-content" className="sr-only">Content</Label>
                <Textarea
                  id="note-content"
                  value={draft.content}
                  onChange={(e) => onDraftChange({ ...draft, content: e.target.value })}
                  placeholder="Start writing…"
                  rows={18}
                  className="min-h-[55vh] resize-y leading-relaxed"
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}