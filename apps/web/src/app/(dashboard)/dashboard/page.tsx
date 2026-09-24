"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  FileText,
  Flame,
  ListTodo,
  Plus,
  Sparkles,
  StickyNote,
  Target,
  Timer,
} from "lucide-react";
import { format } from "date-fns";

import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/domain/stat-card";
import { EmptyState, GridSkeleton } from "@/components/feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useDashboard } from "@/features/dashboard/hooks";
import { useAuth } from "@/features/auth/auth-provider";
import { formatMinutes, relativeTime } from "@/lib/format";
import { dueLabel } from "@/lib/format";
import { courseColorSoft } from "@/features/courses/courses-api";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const dashboard = useDashboard();

  if (dashboard.isPending) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-1/2 animate-pulse rounded bg-muted" />
        <GridSkeleton />
        <div className="h-40 animate-pulse rounded-xl bg-muted/50" />
      </div>
    );
  }

  if (dashboard.isError) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Could not load your dashboard"
        description="The app could not reach the API. Start the backend with `pnpm --filter @studentos/api dev` and refresh."
        action={undefined}
      />
    );
  }

  const data = dashboard.data!;
  const firstName = user?.firstName ?? "there";
  const todoCount = data.tasks.byStatus.TODO ?? 0;
  const inProgress = data.tasks.byStatus.IN_PROGRESS ?? 0;

  return (
    <div className="space-y-8">
      {/* Greeting + quick actions */}
      <PageHeader
        kicker={format(new Date(), "EEEE, MMMM d")}
        title={`${greeting()}, ${firstName}.`}
        description="Here is your day at a glance."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/study">
                <Timer className="mr-1.5 h-4 w-4" aria-hidden /> Start study
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/tasks?new=1">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New task
              </Link>
            </Button>
          </>
        }
      />

      {/* Overview cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={BookOpen}
          label="Active courses"
          value={data.courses.active}
          hint={`${data.courses.total} total`}
        />
        <StatCard
          icon={ListTodo}
          label="Tasks to do"
          value={todoCount}
          hint={inProgress ? `${inProgress} in progress` : "All caught up"}
          tone={todoCount > 0 ? "warning" : "success"}
        />
        <StatCard
          icon={Flame}
          label="Studied today"
          value={formatMinutes(data.studySessions.todayMinutes)}
          hint={`${data.studySessions.todayCount} session${data.studySessions.todayCount !== 1 ? "s" : ""}`}
          tone="primary"
        />
        <StatCard
          icon={CalendarClock}
          label="Unread notifications"
          value={data.notifications.unreadCount}
          hint={data.notifications.unreadCount > 0 ? "Tap Settings to review" : "All clear"}
          tone={data.notifications.unreadCount > 0 ? "danger" : "neutral"}
        />
      </div>

      {/* Today's focus + study progress */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
              Today&apos;s focus
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/tasks">View tasks <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden /></Link>
            </Button>
          </div>
          {data.events.today.length === 0 && data.upcomingTasks.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nothing scheduled yet"
              description="Add a task or a calendar event to see it here."
              className="py-8"
            />
          ) : (
            <ul className="space-y-2.5">
              {data.events.today.map((event) => (
                <li key={`evt-${event.id}`} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">{event.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </li>
              ))}
              {data.upcomingTasks.slice(0, 5).map((task) => {
                const l = dueLabel(task.dueDate, task.status);
                return (
                  <li key={`task-${task.id}`} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <span className={`text-xs ${l.tone === "overdue" ? "font-medium text-danger" : l.tone === "soon" ? "font-medium text-warning" : "text-muted-foreground"}`}>
                      {l.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Timer className="h-4 w-4 text-primary" aria-hidden />
              Study progress
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/study">Open study <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden /></Link>
            </Button>
          </div>
          {data.studySessions.recent.length === 0 ? (
            <EmptyState
              icon={Timer}
              title="No study sessions yet"
              description="Start a focus session with the Study timer and your progress lands here."
              className="py-8"
            />
          ) : (
            <ul className="space-y-2.5">
              {data.studySessions.recent.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{s.topic ?? "Focused study"}</span>
                  <span className="text-xs text-muted-foreground">{relativeTime(s.startedAt)}</span>
                  {s.durationMinutes !== null && (
                    <Badge variant="secondary" className="shrink-0">
                      {formatMinutes(s.durationMinutes)}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Course overview */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Course overview</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/courses">All courses <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden /></Link>
          </Button>
        </div>
        {data.courses.recent.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No courses yet"
            description="Add your first course to track assignments, notes and grades."
            action={
              <Button asChild size="sm">
                <Link href="/courses?new=1">
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add a course
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.courses.recent.map((course) => (
              <Link
                key={course.id}
                href={`/courses/${course.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
              >
                <span
                  className="h-9 w-9 shrink-0 rounded-lg"
                  style={{ backgroundColor: courseColorSoft(course.id) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{course.name}</span>
                  <span className="block text-xs text-muted-foreground">{course.code ?? "—"}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Goals, notes, grades */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold"><Target className="h-4 w-4 text-primary" aria-hidden /> Active goals</h2>
            <Button asChild variant="ghost" size="sm"><Link href="/goals">Manage</Link></Button>
          </div>
          {data.activeGoals.length === 0 ? (
            <EmptyState icon={Target} title="No active goals" className="py-6" />
          ) : (
            <ul className="space-y-4">
              {data.activeGoals.slice(0, 4).map((goal) => (
                <li key={goal.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="truncate font-medium">{goal.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{goal.progress}%</span>
                  </div>
                  <Progress value={goal.progress} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold"><StickyNote className="h-4 w-4 text-primary" aria-hidden /> Recent notes</h2>
            <Button asChild variant="ghost" size="sm"><Link href="/notes">Open</Link></Button>
          </div>
          {data.recentNotes.length === 0 ? (
            <EmptyState icon={StickyNote} title="No notes yet" className="py-6" />
          ) : (
            <ul className="space-y-2.5">
              {data.recentNotes.slice(0, 4).map((note) => (
                <li key={note.id}>
                  <Link href={`/notes?note=${note.id}`} className="block rounded-lg bg-muted/50 px-3 py-2 text-sm transition-colors hover:bg-muted">
                    <span className="block truncate font-medium">{note.title}</span>
                    <span className="text-xs text-muted-foreground">{relativeTime(note.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" aria-hidden /> Recent grades</h2>
            <Button asChild variant="ghost" size="sm"><Link href="/analytics">Analytics</Link></Button>
          </div>
          {data.recentGrades.length === 0 ? (
            <EmptyState icon={Sparkles} title="No grades recorded" description="Grades you record will appear here." className="py-6" />
          ) : (
            <ul className="space-y-2.5">
              {data.recentGrades.slice(0, 4).map((grade) => (
                <li key={grade.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{grade.title}</span>
                  <span className="ml-2 shrink-0 font-semibold text-primary">
                    {grade.score !== null ? grade.score : "—"}
                    {grade.maxScore ? ` / ${grade.maxScore}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}