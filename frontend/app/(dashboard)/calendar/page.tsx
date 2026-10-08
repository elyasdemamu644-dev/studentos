"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  format,
  isSameMonth,
  isToday,
  parse,
  startOfMonth,
  subMonths,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Link2,
  List,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PanelSkeleton } from "@/components/feedback";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCalendarEvents, useDeleteEvent } from "@/features/events/hooks";
import { getEvent } from "@/features/events/events-api";
import { buildCalendar, mapEventsToCalendarDays, toDayKey } from "@/features/events/calendar-utils";
import { EventFormDialog } from "@/features/events/event-form";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { formatTime } from "@/lib/format";
import type { CalEvent, EventType } from "@/types/api-types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_FORMAT = "yyyy-MM";

/** Dot/pill colour for an event type. */
const EVENT_TYPE_TONE: Record<EventType, string> = {
  EXAM: "bg-danger/15 text-danger",
  ASSIGNMENT: "bg-warning/15 text-warning",
  CLASS: "bg-primary/10 text-primary",
  MEETING: "bg-success/10 text-success",
  PERSONAL: "bg-muted text-muted-foreground",
  OTHER: "bg-muted text-muted-foreground",
  PROJECT: "bg-muted text-muted-foreground",
  STUDY: "bg-muted text-muted-foreground",
};

const EVENT_TYPE_BADGE: Record<EventType, "danger" | "warning" | "default" | "success" | "muted"> = {
  EXAM: "danger",
  ASSIGNMENT: "warning",
  CLASS: "default",
  MEETING: "success",
  PERSONAL: "muted",
  OTHER: "muted",
  PROJECT: "muted",
  STUDY: "muted",
};

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The visible month and selected day live in the URL, so Back works and a
  // view can be linked to. Previously both were component state only.
  const [anchor, setAnchor] = useState(() => {
    const raw = searchParams.get("month");
    const parsed = raw ? parse(raw, MONTH_FORMAT, new Date()) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? startOfMonth(parsed) : startOfMonth(new Date());
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [layout, setLayout] = useState<"month" | "agenda">("month");
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState(() => toDayKey(new Date()));
  const [editing, setEditing] = useState<CalEvent | undefined>(undefined);
  const [deleting, setDeleting] = useState<CalEvent | undefined>(undefined);

  // Which grid cell holds keyboard focus. Roving tabindex: one tab stop for the
  // whole grid rather than the 42 the grid used to expose.
  const [focusedKey, setFocusedKey] = useState(() => toDayKey(new Date()));
  const gridRef = useRef<HTMLDivElement>(null);

  const calendar = useMemo(() => buildCalendar(anchor), [anchor]);
  const { cells, start, end } = calendar;
  const events = useCalendarEvents(calendar.query);
  const deleteEvent = useDeleteEvent();

  const byDay = useMemo(
    () => mapEventsToCalendarDays(events.data?.items ?? [], start, end),
    [events.data, start, end],
  );

  const selectedEvents = useMemo(() => {
    if (!selectedDay) return [];
    return byDay.get(toDayKey(selectedDay)) ?? [];
  }, [selectedDay, byDay]);

  /** Every day in the visible month that has at least one event, soonest first. */
  const agendaDays = useMemo(
    () =>
      cells
        .filter((day) => isSameMonth(day, anchor))
        .map((day) => ({ day, events: byDay.get(toDayKey(day)) ?? [] }))
        .filter((entry) => entry.events.length > 0),
    [cells, anchor, byDay],
  );

  const syncedMonth = searchParams.get("month");
  useEffect(() => {
    const next = format(anchor, MONTH_FORMAT);
    if (syncedMonth === next) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", next);
    router.replace(`/calendar?${params.toString()}`, { scroll: false });
  }, [anchor, syncedMonth, router, searchParams]);

  // "Jump here" links (`/calendar?eventId=…`) come from the dashboard and the
  // command palette. The event is fetched directly — the calendar query only
  // covers the visible month — then the month is anchored and its day opened.
  const jumpEventId = searchParams.get("eventId");
  const jumpEvent = useQuery({
    queryKey: ["events", "jump", jumpEventId],
    queryFn: () => getEvent(jumpEventId as string),
    enabled: Boolean(jumpEventId),
    staleTime: 60_000,
  });
  const jumpedRef = useRef<string | null>(null);
  useEffect(() => {
    const event = jumpEvent.data;
    if (!event || jumpedRef.current === event.id) return;
    jumpedRef.current = event.id;
    const start = new Date(event.startAt);
    setAnchor(startOfMonth(start));
    setSelectedDay(start);
    setFocusedKey(toDayKey(start));
    const params = new URLSearchParams(searchParams.toString());
    params.delete("eventId");
    const qs = params.toString();
    router.replace(qs ? `/calendar?${qs}` : "/calendar", { scroll: false });
  }, [jumpEvent.data, router, searchParams]);

  // Keep the focused cell inside the grid as the user pages through months.
  useEffect(() => {
    if (!cells.some((day) => toDayKey(day) === focusedKey)) {
      setFocusedKey(toDayKey(cells[0]));
    }
  }, [cells, focusedKey]);

  const openAdd = useCallback((day: Date) => {
    setEditing(undefined);
    setFormDate(toDayKey(day));
    setFormOpen(true);
    // "Add event" is reached from inside the day dialog, so the day sheet has
    // to close first — otherwise two modal dialogs stack and Escape closes
    // only the top one, leaving the day view stuck open.
    setSelectedDay(null);
  }, []);

  const openEdit = useCallback((event: CalEvent) => {
    setEditing(event);
    setFormOpen(true);
    setSelectedDay(null);
  }, []);

  // Quick action "Add calendar event" lands on `/calendar?new=1`: open the
  // form for today, then drop the param so Back/refresh doesn't reopen it.
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    const qs = params.toString();
    router.replace(qs ? `/calendar?${qs}` : "/calendar", { scroll: false });
    openAdd(new Date());
  }, [searchParams, router, openAdd]);

  const moveMonth = useCallback((delta: number) => {
    setAnchor((current) => (delta < 0 ? subMonths(current, 1) : addMonths(current, 1)));
    setSelectedDay(null);
  }, []);

  /** Arrow/Home/End/PageUp/PageDown move focus without ever leaving the grid. */
  const onGridKeyDown = (event: React.KeyboardEvent) => {
    const index = cells.findIndex((day) => toDayKey(day) === focusedKey);
    if (index === -1) return;

    const jump: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };

    let nextIndex: number | null = null;
    if (event.key in jump) {
      nextIndex = Math.min(cells.length - 1, Math.max(0, index + jump[event.key]));
    } else if (event.key === "Home") {
      nextIndex = Math.floor(index / 7) * 7;
    } else if (event.key === "End") {
      nextIndex = Math.floor(index / 7) * 7 + 6;
    } else if (event.key === "PageUp") {
      nextIndex = index - cells.filter((day) => day.getMonth() === anchor.getMonth()).length;
    } else if (event.key === "PageDown") {
      nextIndex = index + cells.filter((day) => day.getMonth() === anchor.getMonth()).length;
    } else if (event.key === "Enter" || event.key === " ") {
      const day = cells[index];
      setSelectedDay(day);
      setFocusedKey(toDayKey(day));
      event.preventDefault();
      return;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextKey = toDayKey(cells[nextIndex]);
    setFocusedKey(nextKey);
    // Move DOM focus too, so the roving tabindex is real rather than cosmetic.
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${nextKey}"]`)?.focus();
  };

  const newEventForAnchor = () => {
    const now = new Date();
    openAdd(isSameMonth(now, anchor) ? now : startOfMonth(anchor));
  };

  return (
    <div>
      <PageHeader
        kicker="Schedule"
        title="Calendar"
        description="Classes, exams and commitments for the month."
        actions={
          <Button size="sm" onClick={newEventForAnchor}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New event
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => moveMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => moveMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <h2 className="ml-1 text-lg font-semibold tracking-tight">{format(anchor, "MMMM yyyy")}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const now = new Date();
              setAnchor(startOfMonth(now));
              setSelectedDay(now);
              setFocusedKey(toDayKey(now));
            }}
          >
            Today
          </Button>
        </div>

        {/* The month grid cannot fit 7 event lists on a phone, so below `md`
            the same data is offered as an agenda. */}
        <SegmentedControl
          label="Calendar layout"
          value={layout}
          onChange={setLayout}
          className="md:hidden"
          options={[
            { value: "month", label: "Month" },
            { value: "agenda", label: "Agenda", icon: <List className="h-3.5 w-3.5" aria-hidden /> },
          ]}
        />
      </div>

      {events.isError ? (
        <ErrorState
          error={events.error}
          retry={() => events.refetch()}
          title="Could not load your calendar"
        />
      ) : events.isPending ? (
        <PanelSkeleton label="Loading your calendar">
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
            {WEEKDAYS.map((day) => (
              <div key={day} className="h-9 bg-card" />
            ))}
            {Array.from({ length: 35 }).map((_, index) => (
              <div key={index} className="skeleton h-20 rounded-none" />
            ))}
          </div>
        </PanelSkeleton>
      ) : (
        <>
          {layout === "agenda" ? (
            <AgendaView
              days={agendaDays}
              onAdd={openAdd}
              onEdit={openEdit}
              onSelectDay={(day) => {
                setSelectedDay(day);
                setFocusedKey(toDayKey(day));
              }}
            />
          ) : (
            <div
              ref={gridRef}
              role="grid"
              aria-label={`${format(anchor, "MMMM yyyy")} calendar`}
              aria-rowcount={Math.ceil(cells.length / 7)}
              aria-colcount={7}
              onKeyDown={onGridKeyDown}
              className="overflow-hidden surface-panel"
            >
              <div role="row" className="grid grid-cols-7 border-b border-border bg-muted/40">
                {WEEKDAYS.map((day, index) => (
                  <div
                    key={day}
                    role="columnheader"
                    aria-label={WEEKDAYS_FULL[index]}
                    className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    <span aria-hidden>{day}</span>
                  </div>
                ))}
              </div>
              {Array.from({ length: Math.ceil(cells.length / 7) }).map((_, week) => (
                <div role="row" key={week} className="grid grid-cols-7 border-b border-border last:border-b-0">
                  {cells.slice(week * 7, week * 7 + 7).map((day) => {
                    const key = toDayKey(day);
                    const dayEvents = byDay.get(key) ?? [];
                    const inMonth = isSameMonth(day, anchor);
                    const today = isToday(day);
                    const selected = selectedDay !== null && toDayKey(selectedDay) === key;
                    return (
                      <div
                        key={key}
                        role="gridcell"
                        aria-selected={selected}
                        className={cn(
                          "border-r border-border/60 last:border-r-0",
                          !inMonth && "bg-muted/20",
                        )}
                      >
                        <button
                          type="button"
                          data-day={key}
                          tabIndex={key === focusedKey ? 0 : -1}
                          onClick={() => {
                            setSelectedDay(day);
                            setFocusedKey(key);
                          }}
                          aria-label={`${format(day, "EEEE, MMMM d")}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ", no events"}`}
                          className={cn(
                            "flex h-full min-h-20 w-full flex-col items-start p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring hover:bg-accent/50 sm:min-h-24",
                            selected && "bg-accent/40",
                          )}
                        >
                          <span
                            className={cn(
                              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm",
                              today && "bg-primary font-bold text-primary-foreground",
                              selected && !today && "bg-accent font-bold text-accent-foreground",
                              !inMonth && "text-muted-foreground/40",
                            )}
                          >
                            {format(day, "d")}
                          </span>
                          <span className="mt-1 hidden w-full space-y-1 sm:block">
                            {dayEvents.slice(0, 3).map((event) => (
                              <span
                                key={event.id}
                                className={cn(
                                  "block truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight",
                                  EVENT_TYPE_TONE[event.type],
                                )}
                              >
                                {formatTime(event.startAt)} · {event.title}
                              </span>
                            ))}
                            {dayEvents.length > 3 && (
                              <span className="block px-1.5 text-[11px] text-muted-foreground">
                                +{dayEvents.length - 3} more
                              </span>
                            )}
                          </span>
                          {/* On phones the cells collapse to dots so the month
                              still fits; the agenda view carries the detail. */}
                          <span className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                            {dayEvents.slice(0, 4).map((event) => (
                              <span
                                key={event.id}
                                className={cn("h-1.5 w-1.5 rounded-full", EVENT_TYPE_TONE[event.type])}
                              />
                            ))}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {layout === "agenda" && (
            <button type="button" className="sr-only" onClick={() => setLayout("month")}>
              Switch to month view
            </button>
          )}
        </>
      )}

      <Dialog open={Boolean(selectedDay)} onOpenChange={(o) => !o && setSelectedDay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedDay ? format(selectedDay, "EEEE, MMMM d") : ""}</DialogTitle>
            <DialogDescription>
              {selectedEvents.length === 0
                ? "Nothing scheduled on this day."
                : `${selectedEvents.length} event${selectedEvents.length !== 1 ? "s" : ""} on this day.`}
            </DialogDescription>
          </DialogHeader>

          {selectedEvents.length === 0 ? (
            <div className="rounded-lg bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing scheduled. A clear day.
            </div>
          ) : (
            <ul className="space-y-2">
              {selectedEvents.map((event) => (
                <li key={event.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{event.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <Clock className="mr-1 inline h-3 w-3" aria-hidden />
                        {formatTime(event.startAt)}
                        {event.endAt ? ` – ${formatTime(event.endAt)}` : ""}
                        <span className="ml-2 uppercase">{EVENT_TYPE_LABELS[event.type] ?? event.type}</span>
                      </p>
                      {(event.course || event.location) && (
                        <p className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          {event.course && (
                            <span className="inline-flex items-center gap-1">
                              <Link2 className="h-3 w-3" aria-hidden /> {event.course.name}
                            </span>
                          )}
                          {event.location && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" aria-hidden /> {event.location}
                            </span>
                          )}
                        </p>
                      )}
                      {event.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{event.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(event)} aria-label={`Edit ${event.title}`}>
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-danger hover:text-danger"
                        onClick={() => {
                          // Same reason as `openAdd`: this button lives inside
                          // the day dialog, so it closes before the confirm
                          // sheet opens.
                          setSelectedDay(null);
                          setDeleting(event);
                        }}
                        aria-label={`Delete ${event.title}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button size="sm" onClick={() => selectedDay && openAdd(selectedDay)} disabled={!selectedDay}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EventFormDialog open={formOpen} onOpenChange={setFormOpen} event={editing} defaultDate={formDate} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        title="Delete this event?"
        description={
          deleting ? (
            <>
              This permanently removes{" "}
              <span className="font-medium text-foreground">{deleting.title}</span> from your
              calendar.
            </>
          ) : undefined
        }
        busy={deleteEvent.isPending}
        onConfirm={() => {
          if (!deleting) return;
          void deleteEvent.mutateAsync(deleting.id).then(() => setDeleting(undefined));
        }}
      />
    </div>
  );
}

/** Chronological list of every day in the month that has something on it. */
function AgendaView({
  days,
  onAdd,
  onEdit,
  onSelectDay,
}: {
  days: { day: Date; events: CalEvent[] }[];
  onAdd: (day: Date) => void;
  onEdit: (event: CalEvent) => void;
  onSelectDay: (day: Date) => void;
}) {
  if (days.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
        <p className="text-base font-semibold">Nothing scheduled this month</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add an exam, class or deadline and it will show up here.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-4">
      {days.map(({ day, events }) => (
        <li key={toDayKey(day)}>
          <div className="mb-2 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                isToday(day) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {format(day, "d")}
            </span>
            <h3 className={cn("text-sm font-semibold", isToday(day) && "text-primary")}>
              {format(day, "EEEE")}
              {isToday(day) && " · Today"}
            </h3>
            <button
              type="button"
              onClick={() => onAdd(day)}
              className="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => onSelectDay(day)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Details
            </button>
          </div>
          <ul className="space-y-1.5 pl-9">
            {events.map((event) => (
              <li key={event.id}>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatTime(event.startAt)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{event.title}</span>
                  <Badge variant={EVENT_TYPE_BADGE[event.type]} className="shrink-0">
                    {EVENT_TYPE_LABELS[event.type] ?? event.type}
                  </Badge>
                  <Button variant="ghost" size="icon-sm" onClick={() => onEdit(event)} aria-label={`Edit ${event.title}`}>
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}