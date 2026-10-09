"use client";

import { useState } from "react";
import { CalendarClock, CheckCircle2, Clock, MapPin, Pencil, Plus, Timer, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Chip, Panel } from "@/components/panel";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { StatCard } from "@/components/domain/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FilterBar, SelectFilter } from "@/components/ui/filter-bar";
import { useEvents, useDeleteEvent } from "@/features/events/hooks";
import { EventFormDialog } from "@/features/events/event-form";
import { countCoursesWithExams, countdownLabel, partitionExams } from "@/features/events/exam-utils";
import { useCourses } from "@/features/courses/hooks";
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
      <li key={exam.id} className="flex">
        <div className="flex w-full flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-background/50 p-4 transition-colors hover:border-primary/30">
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
        chips={
          exams.data ? (
            <>
              <Chip tone="primary" icon={CalendarClock}>
                {upcoming.length} upcoming
              </Chip>
              {next && (
                <Chip
                  tone={
                    countdownLabel(next.startAt).tone === "danger"
                      ? "danger"
                      : countdownLabel(next.startAt).tone === "warning"
                        ? "warning"
                        : "primary"
                  }
                  icon={Timer}
                >
                  {countdownLabel(next.startAt).label}
                </Chip>
              )}
              <Chip tone="success" icon={CheckCircle2}>
                {past.length} done
              </Chip>
            </>
          ) : undefined
        }
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add exam
          </Button>
        }
      />

      <FilterBar onClear={courseFilter ? () => setCourseFilter("") : undefined}>
        <SelectFilter
          value={courseFilter}
          onChange={setCourseFilter}
          label="Filter exams by course"
          placeholder="All courses"
          allLabel="All courses"
          options={(courses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          className="sm:w-64"
        />
      </FilterBar>

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
            <Panel
              title="Upcoming"
              icon={CalendarClock}
              tone="primary"
              collapsible={false}
              actions={<Chip tone="primary">{upcoming.length}</Chip>}
            >
              <ul className="space-y-2.5">{upcoming.map(renderExam)}</ul>
            </Panel>
          )}

          {past.length > 0 && (
            <Panel
              title="Past"
              icon={CheckCircle2}
              tone="success"
              defaultOpen={false}
              actions={<Chip tone="neutral">{past.length}</Chip>}
            >
              <ul className="space-y-2.5">{past.map(renderExam)}</ul>
            </Panel>
          )}
        </div>
      )}

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editing}
        lockType="EXAM"
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete exam"
        description={
          deleting
            ? `"${deleting.title}" will be removed from your schedule. This cannot be undone.`
            : undefined
        }
        busy={deleteEvent.isPending}
        onConfirm={() => {
          if (!deleting) return;
          void deleteEvent.mutateAsync(deleting.id).then(() => setDeleting(null));
        }}
      />
    </div>
  );
}
