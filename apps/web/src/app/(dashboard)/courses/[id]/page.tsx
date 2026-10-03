"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  FileText,
  GraduationCap,
  Library,
  ListTodo,
  MapPin,
  Paperclip,
  Pencil,
  StickyNote,
  Target,
  Timer,
  Trash2,
  UserRound,
} from "lucide-react";

import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { StatCard } from "@/components/domain/stat-card";
import { TaskCard } from "@/components/domain/task-card";
import { Button, LoadingButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useCourse, useCourseSummary, useDeleteCourse } from "@/features/courses/hooks";
import { CourseFormDialog } from "@/features/courses/course-form";
import { useNotes } from "@/features/notes/hooks";
import { useCompleteTask, useTasks, useUpdateTask } from "@/features/tasks/hooks";
import { DialogShell } from "@/features/tasks/task-form";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { formatDate, formatMinutes, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // The summary is the single rollup for every aggregate on this page, so the
  // numbers cannot disagree with each other the way per-module counts did.
  const course = useCourse(id);
  const summary = useCourseSummary(id);
  // Only the two lists that need full records are fetched separately.
  const tasks = useTasks({ courseId: id, limit: 100 });
  const notes = useNotes({ courseId: id, limit: 100 });

  const completeTask = useCompleteTask();
  const updateTask = useUpdateTask();
  const deleteCourse = useDeleteCourse();

  if (course.isPending || summary.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-1/4 opacity-70" />
        <ListSkeleton rows={3} />
      </div>
    );
  }

  if (course.isError) {
    return <ErrorState error={course.error} retry={() => course.refetch()} />;
  }

  if (summary.isError) {
    return <ErrorState error={summary.error} retry={() => summary.refetch()} />;
  }

  const data = course.data!;
  const roll = summary.data!;
  const taskItems = tasks.data?.items ?? [];
  const openTasks = taskItems.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
  const completedTasks = taskItems.filter((t) => t.status === "COMPLETED");
  const noteItems = notes.data?.items ?? [];
  const upcoming = roll.events.upcoming;
  const nextExam = roll.nextExam;

  const toggleTask = (taskId: string, done: boolean) => {
    if (done) {
      void updateTask.mutateAsync({ id: taskId, input: { status: "TODO", completedAt: null } });
    } else {
      void completeTask.mutateAsync(taskId);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
          <Link href="/courses">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> All courses
          </Link>
        </Button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                  data.status === "ACTIVE" && "bg-success/10 text-success",
                  data.status === "COMPLETED" && "bg-primary/10 text-primary",
                  data.status === "DROPPED" && "bg-muted text-muted-foreground",
                )}
              >
                {data.status.toLowerCase()}
              </span>
              {data.semester && <Badge variant="secondary">{data.semester.name}</Badge>}
              {data.credits != null && <Badge variant="muted">{data.credits} credits</Badge>}
              {data.code && <Badge variant="outline">{data.code}</Badge>}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{data.name}</h1>
            {data.instructor && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" aria-hidden /> {data.instructor}
              </p>
            )}
            {data.description && (
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{data.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1.5 h-4 w-4" aria-hidden /> Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Delete
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={ListTodo}
          label="Open tasks"
          value={roll.tasks.open}
          hint={
            roll.tasks.total > 0
              ? `${roll.tasks.completed}/${roll.tasks.total} done${roll.tasks.overdue > 0 ? ` · ${roll.tasks.overdue} overdue` : ""}`
              : "No tasks yet"
          }
          tone={roll.tasks.overdue > 0 ? "danger" : roll.tasks.open > 0 ? "warning" : "success"}
        />
        <StatCard
          icon={GraduationCap}
          label="Grade average"
          value={roll.grades.average !== null ? `${roll.grades.average}%` : "—"}
          hint={
            roll.grades.total > 0
              ? `${roll.grades.scored} of ${roll.grades.total} scored`
              : "No grades recorded yet"
          }
        />
        <StatCard
          icon={Timer}
          label="Study time"
          value={formatMinutes(roll.study.totalMinutes)}
          hint={`${roll.study.sessions} session${roll.study.sessions === 1 ? "" : "s"} logged`}
        />
        <StatCard
          icon={CalendarClock}
          label="Next exam"
          value={nextExam ? formatDate(nextExam.startAt, "MMM d") : "—"}
          hint={
            nextExam
              ? `${nextExam.title}${nextExam.location ? ` · ${nextExam.location}` : ""}`
              : roll.events.examCount > 0
                ? `${roll.events.examCount} exam${roll.events.examCount === 1 ? "" : "s"} in the past`
                : "No exam scheduled"
          }
        />
      </div>

      {roll.tasks.total > 0 && roll.tasks.progress !== null && (
        <section className="surface-panel p-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Task progress</span>
            <span className="text-muted-foreground">
              {roll.tasks.completed} of {roll.tasks.total} complete · {roll.tasks.progress}%
            </span>
          </div>
          <Progress
            label="Course task progress"
            value={roll.tasks.progress}
            valueText={`${roll.tasks.completed} of ${roll.tasks.total} tasks complete`}
          />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden /> Upcoming
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/calendar">
                Open calendar <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nothing scheduled"
              description="Events for this course will appear here."
              className="py-6"
            />
          ) : (
            <ul className="space-y-2.5">
              {upcoming.slice(0, 6).map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2"
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      event.type === "EXAM" ? "bg-danger" : "bg-primary",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{event.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(event.startAt, "MMM d")} · {formatTime(event.startAt)}
                      {event.location && (
                        <span className="ml-1 inline-flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" aria-hidden />
                          {event.location}
                        </span>
                      )}
                    </span>
                  </span>
                  <Badge variant={event.type === "EXAM" ? "danger" : "muted"} className="shrink-0">
                    {EVENT_TYPE_LABELS[event.type] ?? event.type}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <ListTodo className="h-4 w-4 text-primary" aria-hidden /> Open tasks
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/tasks">
                All tasks <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
          {tasks.isPending ? (
            <ListSkeleton rows={3} />
          ) : openTasks.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title="All caught up"
              description="No open tasks for this course right now."
              className="py-6"
            />
          ) : (
            <ul className="space-y-2.5">
              {openTasks.slice(0, 6).map((task) => (
                <li key={task.id}>
                  <TaskCard
                    task={task}
                    onToggle={() => toggleTask(task.id, task.status === "COMPLETED")}
                  />
                </li>
              ))}
            </ul>
          )}
          {completedTasks.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {completedTasks.length} completed task{completedTasks.length !== 1 ? "s" : ""} hidden
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <StickyNote className="h-4 w-4 text-primary" aria-hidden /> Notes
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/notes?course=${id}`}>
                All notes <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
          {notes.isPending ? (
            <ListSkeleton rows={2} />
          ) : noteItems.length === 0 ? (
            <EmptyState icon={StickyNote} title="No notes yet" className="py-6" />
          ) : (
            <ul className="space-y-2.5">
              {noteItems.slice(0, 6).map((note) => (
                <li key={note.id}>
                  <Link
                    href={`/notes?note=${note.id}`}
                    className="block rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40"
                  >
                    <span className="block truncate text-sm font-medium">{note.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatDate(note.updatedAt)} · {note.content.length} chars
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <FileText className="h-4 w-4 text-primary" aria-hidden /> Recent grades
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/analytics">
                Analytics <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
          {roll.grades.recent.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No grades recorded"
              description="Record results on the Analytics page and they will show up here."
              className="py-6"
            />
          ) : (
            <ul className="space-y-2.5">
              {roll.grades.recent.slice(0, 6).map((grade) => (
                <li
                  key={grade.id}
                  className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {grade.title}
                    <span className="ml-2 text-xs uppercase text-muted-foreground">
                      {grade.type.toLowerCase()}
                    </span>
                  </span>
                  <span className="ml-2 shrink-0 font-semibold text-primary">
                    {grade.score != null ? grade.score : "—"}
                    {grade.maxScore != null ? ` / ${grade.maxScore}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-panel p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <Paperclip className="h-4 w-4 text-primary" aria-hidden /> Resources
          </h2>
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Library className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <p className="text-2xl font-bold tracking-tight">{roll.resources.total}</p>
              <p className="text-sm text-muted-foreground">
                resource{roll.resources.total === 1 ? "" : "s"} linked to this course
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href={`/resources?course=${id}`}>
              Browse resource library
              <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </section>

        <section className="surface-panel p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <Target className="h-4 w-4 text-primary" aria-hidden /> Related goals
          </h2>
          {roll.goals.relatedActive === 0 ? (
            <EmptyState
              icon={Target}
              title="No active goals"
              description="Goals whose title matches this course are linked here automatically."
              className="py-6"
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {roll.goals.relatedActive} active goal
                {roll.goals.relatedActive === 1 ? "" : "s"} matched to this course by name.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/goals">
                  Open goals
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            </>
          )}
        </section>
      </div>

      <CourseFormDialog open={editOpen} onOpenChange={setEditOpen} course={data} />

      <DialogShell
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete course"
        description={`This removes "${data.name}" from your courses. Linked tasks, notes, events and grades will remain. This cannot be undone.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <LoadingButton
            variant="destructive"
            loading={deleteCourse.isPending}
            onClick={() => {
              void deleteCourse.mutateAsync(id).then(() => {
                if (typeof window !== "undefined") window.location.replace("/courses");
              });
            }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Delete course
          </LoadingButton>
        </div>
      </DialogShell>
    </div>
  );
}
