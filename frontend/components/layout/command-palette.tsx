"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarPlus,
  CornerDownLeft,
  GraduationCap,
  Library,
  ListTodo,
  Loader2,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Target,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { listCourses } from "@/features/courses/courses-api";
import { listNotes } from "@/features/notes/notes-api";
import { listResources } from "@/features/resources/resources-api";
import { listTasks } from "@/features/tasks/tasks-api";

/** A sidebar destination, structurally the same as the shell's NavItem. */
export interface PalettePage {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface PaletteEntry {
  id: string;
  section: string;
  label: string;
  meta?: string;
  icon: LucideIcon;
  href: string;
}

interface CommandPaletteContextValue {
  open: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

/**
 * Open the palette from anywhere inside the shell: `const { open } =
 * useCommandPalette()`. The provider owns the ⌘K/Ctrl+K shortcut and the
 * dialog itself, so there is one instance for the whole app.
 */
export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used inside <CommandPaletteProvider>");
  return ctx;
}

export function CommandPaletteProvider({
  children,
  pages,
}: {
  children: React.ReactNode;
  pages: PalettePage[];
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.key.includes("Shift")) {
        if (event.key.toLowerCase() !== "k") return;
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openPalette = useCallback(() => setOpen(true), []);

  return (
    <CommandPaletteContext.Provider value={{ open: openPalette }}>
      {children}
      {/* Mounted only while open: the four search queries need a QueryClient,
          and a closed palette must cost the shell nothing. */}
      {open && <CommandPaletteDialog open={open} onOpenChange={setOpen} pages={pages} />}
    </CommandPaletteContext.Provider>
  );
}

/** Quick actions mirror the dashboard's — every href is verified to act. */
function buildActions(term: string): PaletteEntry[] {
  const askLabel = term
    ? `Ask the AI assistant about “${term}”`
    : "Ask the AI assistant";
  return [
    { id: "a:ask-ai", section: "Quick actions", label: askLabel, icon: Sparkles, href: term ? `/ai?prompt=${encodeURIComponent(term)}` : "/ai" },
    { id: "a:add-task", section: "Quick actions", label: "Add task", icon: Plus, href: "/tasks?new=1" },
    { id: "a:add-note", section: "Quick actions", label: "Add note", icon: StickyNote, href: "/notes?note=new" },
    { id: "a:add-goal", section: "Quick actions", label: "Add goal", icon: Target, href: "/goals?new=1" },
    { id: "a:add-course", section: "Quick actions", label: "Add course", icon: GraduationCap, href: "/courses?new=1" },
    { id: "a:add-event", section: "Quick actions", label: "Add calendar event", icon: CalendarPlus, href: "/calendar?new=1" },
    { id: "a:study", section: "Quick actions", label: "Start study session", icon: Timer, href: "/study" },
  ];
}

const MIN_QUERY_LENGTH = 2;
const SEARCH_LIMIT = 5;

function CommandPaletteDialog({
  open,
  onOpenChange,
  pages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: PalettePage[];
}) {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [term, setTerm] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Debounced so typing doesn't fire one request per keystroke.
  useEffect(() => {
    const timeout = setTimeout(() => setTerm(raw.trim()), 250);
    return () => clearTimeout(timeout);
  }, [raw]);

  const close = useCallback(
    (next: boolean) => {
      onOpenChange(next);
      if (!next) {
        setRaw("");
        setTerm("");
        setActiveIndex(0);
      }
    },
    [onOpenChange],
  );

  const searchOn = open && term.length >= MIN_QUERY_LENGTH;

  const tasksQ = useQuery({
    queryKey: ["palette", "tasks", term],
    queryFn: () => listTasks({ search: term, limit: SEARCH_LIMIT }),
    enabled: searchOn,
    staleTime: 30_000,
    retry: false,
  });
  const coursesQ = useQuery({
    queryKey: ["palette", "courses", term],
    queryFn: () => listCourses({ search: term, limit: SEARCH_LIMIT }),
    enabled: searchOn,
    staleTime: 30_000,
    retry: false,
  });
  const notesQ = useQuery({
    queryKey: ["palette", "notes", term],
    queryFn: () => listNotes({ search: term, limit: SEARCH_LIMIT }),
    enabled: searchOn,
    staleTime: 30_000,
    retry: false,
  });
  const resourcesQ = useQuery({
    queryKey: ["palette", "resources", term],
    queryFn: () => listResources({ search: term, limit: SEARCH_LIMIT }),
    enabled: searchOn,
    staleTime: 30_000,
    retry: false,
  });

  const searching = searchOn && (tasksQ.isFetching || coursesQ.isFetching || notesQ.isFetching || resourcesQ.isFetching);
  const searchFailed = searchOn && (tasksQ.isError || coursesQ.isError || notesQ.isError || resourcesQ.isError);

  const retrySearch = () => {
    void tasksQ.refetch();
    void coursesQ.refetch();
    void notesQ.refetch();
    void resourcesQ.refetch();
  };

  const groups = useMemo(() => {
    const needle = term.toLowerCase();
    const match = (value: string) => !needle || value.toLowerCase().includes(needle);

    const out: { section: string; entries: PaletteEntry[] }[] = [];
    const push = (entry: PaletteEntry) => {
      let group = out.find((g) => g.section === entry.section);
      if (!group) {
        group = { section: entry.section, entries: [] };
        out.push(group);
      }
      group.entries.push(entry);
    };

    // Server-side results first: a typed term is a search, not a command.
    if (searchOn) {
      for (const task of tasksQ.data?.items ?? []) {
        push({
          id: `task:${task.id}`,
          section: "Tasks",
          label: task.title,
          meta: task.course?.name,
          icon: ListTodo,
          href: `/tasks?task=${task.id}`,
        });
      }
      for (const course of coursesQ.data ?? []) {
        push({
          id: `course:${course.id}`,
          section: "Courses",
          label: course.name,
          meta: course.code ?? undefined,
          icon: GraduationCap,
          href: `/courses/${course.id}`,
        });
      }
      for (const note of notesQ.data?.items ?? []) {
        push({
          id: `note:${note.id}`,
          section: "Notes",
          label: note.title,
          meta: note.course?.name,
          icon: StickyNote,
          href: `/notes?note=${note.id}`,
        });
      }
      for (const resource of resourcesQ.data?.items ?? []) {
        push({
          id: `resource:${resource.id}`,
          section: "Resources",
          label: resource.title,
          meta: resource.course?.name ?? resource.resourceType,
          icon: Library,
          href: `/resources?resource=${resource.id}`,
        });
      }
    }

    for (const action of buildActions(term)) {
      if (match(action.label)) push(action);
    }
    for (const page of pages) {
      if (match(page.label)) {
        push({ id: `page:${page.href}`, section: "Go to", label: page.label, icon: page.icon, href: page.href });
      }
    }
    return out;
  }, [searchOn, term, pages, tasksQ.data, coursesQ.data, notesQ.data, resourcesQ.data]);

  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const index = entries.length > 0 ? Math.min(activeIndex, entries.length - 1) : 0;

  // A new term (or a response arriving for it) starts the selection back at
  // the top — otherwise the highlight sits on whatever row happened to be
  // number 5 before the list changed.
  useEffect(() => {
    setActiveIndex(0);
  }, [term, tasksQ.data, coursesQ.data, notesQ.data, resourcesQ.data]);

  useEffect(() => {
    itemRefs.current[index]?.scrollIntoView({ block: "nearest" });
  }, [index, entries.length]);

  const go = useCallback(
    (entry: PaletteEntry | undefined) => {
      if (!entry) return;
      close(false);
      router.push(entry.href);
    },
    [close, router],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (entries.length > 0) setActiveIndex((i) => (i + 1) % entries.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (entries.length > 0) setActiveIndex((i) => (i - 1 + entries.length) % entries.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(entries[index]);
    } else if (event.key === "Home" && entries.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && entries.length > 0) {
      event.preventDefault();
      setActiveIndex(entries.length - 1);
    }
  };

  const showEmpty = searchOn && !searching && !searchFailed && entries.length === 0;
  const showInitialEmpty = !searchOn && term.length > 0 && entries.length === 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="top-[12%] max-h-[70dvh] w-[min(95vw,40rem)] translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search and quick actions</DialogTitle>

        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            aria-autocomplete="list"
            aria-activedescendant={entries[index] ? `palette-option-${index}` : undefined}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tasks, notes, courses… or type a command"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div
          id="command-palette-list"
          role="listbox"
          aria-label="Search results"
          ref={listRef}
          className="max-h-[52dvh] overflow-y-auto p-2"
        >
          {groups.map((group) => (
            <div key={group.section} className="mb-1.5 first:mb-1">
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.section}
              </p>
              <ul>
                {group.entries.map((entry) => {
                  const flatIndex = entries.indexOf(entry);
                  const active = flatIndex === index;
                  const Icon = entry.icon;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        id={`palette-option-${flatIndex}`}
                        role="option"
                        aria-selected={active}
                        ref={(node) => {
                          itemRefs.current[flatIndex] = node;
                        }}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => go(entry)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
                          active ? "bg-primary/10 text-foreground" : "text-foreground/85",
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {entry.meta && (
                          <span className="shrink-0 truncate text-xs text-muted-foreground">{entry.meta}</span>
                        )}
                        {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {searching && (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Searching…
            </p>
          )}

          {searchFailed && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              <p>Search failed — the server could not be reached.</p>
              <button
                type="button"
                onClick={retrySearch}
                className="mt-1 rounded-md text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {(showEmpty || showInitialEmpty) && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {showInitialEmpty ? (
                <>No matches for “{term}”.</>
              ) : (
                <>Nothing found for “{term}”. Try the AI assistant above.</>
              )}
            </p>
          )}

          {groups.length === 0 && !searching && !searchFailed && term.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">Type to search, or pick an action.</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">↑</kbd>
            <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">↵</kbd>
            open
            <span className="mx-1.5 text-muted-foreground/50">·</span>
            <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">esc</kbd>
            close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
