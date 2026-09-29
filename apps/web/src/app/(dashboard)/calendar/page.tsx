"use client";

import { useMemo, useState } from "react";
import { addMonths, format, isSameMonth, isToday, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, Clock, Link2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { Button, LoadingButton } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCalendarEvents, useDeleteEvent } from "@/features/events/hooks";
import { buildCalendar, mapEventsToCalendarDays, toDayKey } from "@/features/events/calendar-utils";
import { EventFormDialog } from "@/features/events/event-form";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { formatTime } from "@/lib/format";
import type { CalEvent } from "@/types/api-types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarPage() {
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState(() => toDayKey(new Date()));
  const [editing, setEditing] = useState<CalEvent | undefined>(undefined);
  const [deleting, setDeleting] = useState<CalEvent | undefined>(undefined);

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

  const openDay = (day: Date) => setSelectedDay(day);

  const openAdd = (day: Date) => {
    setEditing(undefined);
    setFormDate(toDayKey(day));
    setFormOpen(true);
  };

  const openAddForDay = (day: Date) => {
    setSelectedDay(day);
    openAdd(day);
  };

  const openEdit = (event: CalEvent) => {
    setEditing(event);
    setFormOpen(true);
  };

  if (events.isError) {
    return <ErrorState error={events.error} retry={() => events.refetch()} />;
  }

  return (
    <div>
      <PageHeader
        kicker="Schedule"
        title="Calendar"
        description="Classes, exams and commitments for the month."
        actions={
          <Button
            size="sm"
            onClick={() => {
              const now = new Date();
              openAdd(isSameMonth(now, anchor) ? now : startOfMonth(anchor));
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New event
          </Button>
        }
      />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => setAnchor((m) => addMonths(m, -1))} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setAnchor((m) => addMonths(m, 1))} aria-label="Next month">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <h2 className="ml-1 text-lg font-semibold tracking-tight">{format(anchor, "MMMM yyyy")}</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const now = new Date();
            setAnchor(startOfMonth(now));
            setSelectedDay(now);
          }}
        >
          Today
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day) => {
            const key = toDayKey(day);
            const dayEvents = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, anchor);
            const today = isToday(day);
            const selected = selectedDay && toDayKey(selectedDay) === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => openDay(day)}
                aria-label={`${format(day, "MMMM d")}${dayEvents.length ? `, ${dayEvents.length} events` : ""}`}
                className={cn(
                  "min-h-24 border-b border-r border-border/60 p-2 text-left align-top transition-colors last:border-r-0 hover:bg-accent/50",
                  !inMonth && "bg-muted/20",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-sm",
                    today && "bg-primary font-bold text-primary-foreground",
                    selected && !today && "bg-accent font-bold text-accent-foreground",
                    !inMonth && "text-muted-foreground/40",
                  )}
                >
                  {format(day, "d")}
                </span>
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 3).map((event) => (
                    <span
                      key={event.id}
                      className={cn(
                        "block truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight",
                        event.type === "EXAM" && "bg-danger/15 text-danger",
                        event.type === "ASSIGNMENT" && "bg-warning/15 text-warning",
                        event.type === "CLASS" && "bg-primary/10 text-primary",
                        event.type === "MEETING" && "bg-success/10 text-success",
                        (event.type === "PERSONAL" || event.type === "OTHER" || event.type === "PROJECT" || event.type === "STUDY") && "bg-muted text-muted-foreground",
                      )}
                    >
                      {formatTime(event.startAt)} · {event.title}
                    </span>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="block px-1.5 text-[11px] text-muted-foreground">+{dayEvents.length - 3} more</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={Boolean(selectedDay)} onOpenChange={(o) => !o && setSelectedDay(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedDay ? format(selectedDay, "EEEE, MMMM d") : ""}
            </DialogTitle>
            <DialogDescription>
              {selectedEvents.length} event{selectedEvents.length !== 1 ? "s" : ""} on this day
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {selectedEvents.length === 0 && (
              <p className="rounded-lg bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">
                Nothing scheduled.
              </p>
            )}
            {selectedEvents.map((event) => (
              <div key={event.id} className="rounded-lg border border-border p-3">
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
                    <Button variant="ghost" size="icon-sm" onClick={() => openEdit(event)} aria-label="Edit event">
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="text-danger hover:text-danger" onClick={() => setDeleting(event)} aria-label="Delete event">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => openAddForDay(selectedDay!)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editing}
        defaultDate={formDate}
      />

      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete event</DialogTitle>
            <DialogDescription>
              This permanently removes &quot;{deleting?.title}&quot;. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>Cancel</Button>
            <LoadingButton
              variant="destructive"
              loading={deleteEvent.isPending}
              onClick={() => {
                if (!deleting) return;
                void deleteEvent.mutateAsync(deleting.id).then(() => setDeleting(undefined));
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Delete
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}