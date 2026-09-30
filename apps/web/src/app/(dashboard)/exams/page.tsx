"use client";

import { useState } from "react";
import { CalendarClock, Clock, MapPin, Pencil, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { StatCard } from "@/components/domain/stat-card";
import { Button, LoadingButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEvents, useDeleteEvent } from "@/features/events/hooks";
import { EventFormDialog } from "@/features/events/event-form";
import { countCoursesWithExams, countdownLabel, partitionExams } from "@/features/events/exam-utils";
import { useCourses } from "@/features/courses/hooks";
import { DialogShell } from "@/features/tasks/task-form";
import type { CalEvent } from "@/types/api-types";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Exams are calendar events with `type = "EXAM"` — there is no separate exam
 * model. This page is a focused view over that data, so nothing is duplicated:
 * creating here writes an event the calendar also shows.
 */
export default function ExamsPage() {
  const [courseFilter, setCourseFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalEvent | undefined>(undefined);
  const [deleting, setDeleting] = useState<CalEvent | null>(null);

  // Fetch all exams (past and future) so the page can show history too.
  const exams = useEvents({
    type: "EXAM",
    courseId: courseFilter || undefined,
    limit: 100,
  });
  const courses = useCourses();
  const deleteEvent = useDeleteEvent();

  const { upcoming, past } = partitionExams(exams.data?.items ?? []);

  const next = upcoming[0] ?? null;
  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const renderExam = (exam: CalEvent) => {
    const countdown = countdownLabel(exam.startAt);
    return (
      <li
        key={exam.id}
        className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-card"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg",
              countdown.tone === "danger"
                ? "bg-danger/10 text-danger"
                : countdown.tone === "warning"
                  ? "bg-warning/15 text-warning"
                  : "bg-primary/10 text-primary",
            )}
            aria-hidden
          >
            <span className="text-[10px] font-semibold uppercase leading-none">
              {formatDate(exam.startAt, "MMM")}
            </span>
            <span className="text-sm font-bold leading-tight">{formatDate(exam.startAt, "d")}</span>
          </span>

          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{exam.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden />
                {formatTime(exam.startAt)}
                {exam.endAt && ` – ${formatTime(exam.endAt)}`}
              </span>
              {exam.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" aria-hidden />
                  {exam.location}
                </span>
              )}
            </p>
            {exam.course && (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {exam.course.code ? `${exam.course.code} · ` : ""}
                {exam.course.name}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge
            variant={
              countdown.tone === "danger"
                ? "danger"
                : countdown.tone === "warning"
                  ? "warning"
                  : "muted"
            }
          >
            {countdown.label}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${exam.title}`}
            onClick={() => {
              setEditing(exam);
              setFormOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${exam.title}`}
            className="text-danger hover:text-danger"
            onClick={() => setDeleting(exam)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div>
      <PageHeader
        kicker="Assessment"
        title="Exams"
        description="Every exam you have scheduled, with a countdown to the next one."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add exam
          </Button>
        }
      />

      <div className="mb-4 max-w-xs">
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger aria-label="Filter exams by course">
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
      </div>

      {exams.isPending ? (
        <ListSkeleton rows={3} />
      ) : exams.isError ? (
        <ErrorState error={exams.error} retry={() => exams.refetch()} />
      ) : upcoming.length === 0 && past.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={courseFilter ? "No exams for this course" : "No exams scheduled"}
          description={
            courseFilter
              ? "Try another course, or clear the filter to see every exam."
              : "Add your exam dates so the dashboard can warn you before they start."
          }
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add exam
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={CalendarClock}
              label="Next exam"
              value={next ? formatDate(next.startAt, "MMM d") : "—"}
              hint={next ? countdownLabel(next.startAt).label : "Nothing scheduled"}
              tone={next ? "warning" : "neutral"}
            />
            <StatCard
              icon={CalendarClock}
              label="Upcoming exams"
              value={upcoming.length}
              hint="Across all courses"
            />
            <StatCard
              icon={Clock}
              label="Completed exams"
              value={past.length}
              hint="This academic year"
              tone="success"
            />
            <StatCard
              icon={MapPin}
              label="Courses with exams"
              value={countCoursesWithExams(upcoming)}
            />
          </div>

          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 font-semibold">Upcoming</h2>
              <ul className="space-y-2.5">{upcoming.map(renderExam)}</ul>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="mb-3 font-semibold text-muted-foreground">Past</h2>
              <ul className="space-y-2.5 opacity-75">{past.map(renderExam)}</ul>
            </section>
          )}
        </div>
      )}

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editing}
        lockType="EXAM"
      />

      <DialogShell
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete exam"
        description={
          deleting
            ? `This removes "${deleting.title}" from your schedule. This cannot be undone.`
            : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <LoadingButton
            variant="destructive"
            loading={deleteEvent.isPending}
            onClick={() => {
              if (!deleting) return;
              void deleteEvent.mutateAsync(deleting.id).then(() => setDeleting(null));
            }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Delete
          </LoadingButton>
        </div>
      </DialogShell>
    </div>
  );
}
