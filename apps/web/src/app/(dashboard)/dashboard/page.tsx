"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  FileText,
  Flame,
  GraduationCap,
  History,
  Library,
  ListTodo,
  Paperclip,
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
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useDashboard } from "@/features/dashboard/hooks";
import { useAuth } from "@/features/auth/auth-provider";
import type { ActivityKind, DashboardActivity } from "@/types/api-types";
import { dueLabel, formatMinutes, relativeTime } from "@/lib/format";
import { courseColorSoft } from "@/features/courses/courses-api";
import { cn } from "@/lib/utils";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const ACTIVITY_META: Record<ActivityKind, { icon: typeof ListTodo; href: string; label: string }> = {
  task: { icon: ListTodo, href: "/tasks", label: "Task" },
  note: { icon: StickyNote, href: "/notes", label: "Note" },
  grade: { icon: Sparkles, href: "/analytics", label: "Grade" },
  event: { icon: CalendarClock, href: "/calendar", label: "Event" },
  goal: { icon: Target, href: "/goals", label: "Goal" },
  resource: { icon: Paperclip, href: "/resources", label: "Resource" },
};

function SectionCard({
  title,
  icon: Icon,
  href,
  linkLabel,
  children,
}: {
  title: string;
  icon: typeof ListTodo;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icon className="h-4 w-4 text-primary" aria-hidden />
          {title}
        </h2>
        {href && linkLabel && (
          <Button asChild variant="ghost" size="sm">
            <Link href={href}>
              {linkLabel}
              <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

function ActivityRow({ item }: { item: DashboardActivity }) {
  const meta = ACTIVITY_META[item.kind];
  const Icon = meta.icon;
  const body = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{item.title}</span>
        <span className="block text-xs text-muted-foreground">
          {meta.label} · {relativeTime(item.at)}
        </span>
      </span>
    </>
  );

  return item.href ? (
    <li>
      <Link
        href={item.href}
        className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 transition-colors hover:bg-muted"
      >
        {body}
      </Link>
    </li>
  ) : (
    <li className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">{body}</li>
  );
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
      <ErrorState error={dashboard.error} retry={() => dashboard.refetch()} />
    );
  }

  const data = dashboard.data!;
  const firstName = user?.firstName ?? "there";
  const todoCount = data.tasks.byStatus.TODO ?? 0;
  const inProgress = data.tasks.byStatus.IN_PROGRESS ?? 0;
  const nextExam = data.exams.upcoming[0] ?? null;
  const termLabel = data.currentSemester
    ? `${data.currentSemester.name}${data.currentAcademicYear ? ` · ${data.currentAcademicYear.name}` : ""}`
    : (data.currentAcademicYear?.name ?? "No active term");

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={format(new Date(), "EEEE, MMMM d")}
        title={`${greeting()}, ${firstName}.`}
        description={termLabel}
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

      {/* Alerts that need attention now */}
      {(data.tasks.overdue > 0 || data.notifications.unreadCount > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.tasks.overdue > 0 && (
            <Link
              href="/tasks?status=TODO"
              className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 transition-colors hover:bg-danger/10"
            >
              <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold text-danger">
                  {data.tasks.overdue} overdue task{data.tasks.overdue !== 1 ? "s" : ""}
                </span>
                <span className="block text-muted-foreground">Review and reschedule them</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-danger" aria-hidden />
            </Link>
          )}
          {data.notifications.unreadCount > 0 && (
            <Link
              href="/notifications"
              className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 transition-colors hover:bg-warning/20"
            >
              <Bell className="h-5 w-5 shrink-0 text-warning-foreground" aria-hidden />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">
                  {data.notifications.unreadCount} unread reminder
                  {data.notifications.unreadCount !== 1 ? "s" : ""}
                </span>
                <span className="block text-muted-foreground">Exams, deadlines and due tasks</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
            </Link>
          )}
        </div>
      )}

      {/* Command center overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={BookOpen}
          label="Active courses"
          value={data.courses.active}
          hint={`${data.courses.total} total · ${data.courses.completed} completed`}
        />
        <StatCard
          icon={ListTodo}
          label="Tasks to do"
          value={todoCount}
          hint={
            data.tasks.overdue > 0
              ? `${data.tasks.overdue} overdue`
              : data.tasks.dueToday > 0
                ? `${data.tasks.dueToday} due today`
                : inProgress
                  ? `${inProgress} in progress`
                  : "All caught up"
          }
          tone={data.tasks.overdue > 0 ? "danger" : todoCount > 0 ? "warning" : "success"}
        />
        <StatCard
          icon={CalendarClock}
          label="Next exam"
          value={nextExam ? format(new Date(nextExam.startAt), "MMM d") : "—"}
          hint={
            nextExam
              ? data.exams.nextInDays === 0
                ? "Today"
                : data.exams.nextInDays === 1
                  ? "Tomorrow"
                  : `In ${data.exams.nextInDays} days`
              : "Nothing scheduled"
          }
          tone={
            data.exams.nextInDays !== null && data.exams.nextInDays <= 3 ? "danger" : "primary"
          }
        />
        <StatCard
          icon={Flame}
          label="Studied today"
          value={formatMinutes(data.studySessions.todayMinutes)}
          hint={`${formatMinutes(data.studySessions.weekMinutes)} this week`}
          tone="primary"
        />
      </div>

      {/* Today's focus + study progress */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Today's focus" icon={CalendarClock} href="/tasks" linkLabel="View tasks">
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
                <li
                  key={`evt-${event.id}`}
                  className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">{event.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.startAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
              {data.upcomingTasks.slice(0, 5).map((task) => {
                const l = dueLabel(task.dueDate, task.status);
                return (
                  <li
                    key={`task-${task.id}`}
                    className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <span
                      className={cn(
                        "text-xs",
                        l.tone === "overdue" && "font-medium text-danger",
                        l.tone === "soon" && "font-medium text-warning",
                        l.tone === "ok" && "text-muted-foreground",
                      )}
                    >
                      {l.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Study progress"
          icon={Timer}
          href="/study"
          linkLabel="Open study"
        >
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
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {s.topic ?? "Focused study"}
                  </span>
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
        </SectionCard>
      </div>

      {/* Overdue + exams */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Overdue" icon={AlertTriangle} href="/tasks" linkLabel="All tasks">
          {data.overdueTasks.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing overdue"
              description="Every dated task is still on schedule."
              className="py-6"
            />
          ) : (
            <ul className="space-y-2.5">
              {data.overdueTasks.slice(0, 6).map((task) => {
                const l = dueLabel(task.dueDate, task.status);
                return (
                  <li
                    key={task.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-danger/5 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{task.title}</span>
                      {task.course && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {task.course.code ?? task.course.name}
                        </span>
                      )}
                    </span>
                    <Badge variant="danger" className="shrink-0">
                      {l.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Upcoming exams" icon={CalendarClock} href="/exams" linkLabel="All exams">
          {data.exams.upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No exams scheduled"
              description="Add exam dates so you get warned before they start."
              className="py-6"
              action={
                <Button asChild size="sm">
                  <Link href="/exams">
                    <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add exam
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2.5">
              {data.exams.upcoming.slice(0, 6).map((exam) => (
                <li
                  key={exam.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{exam.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {format(new Date(exam.startAt), "MMM d, HH:mm")}
                      {exam.location ? ` · ${exam.location}` : ""}
                    </span>
                  </span>
                  {exam.course && (
                    <Badge variant="muted" className="shrink-0">
                      {exam.course.code ?? exam.course.name}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Course overview with progress + average */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Course overview</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/courses">
              All courses
              <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Link>
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
                className="rounded-xl border border-border bg-card p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-9 w-9 shrink-0 rounded-lg"
                    style={{ backgroundColor: courseColorSoft(course.id) }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{course.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {course.code ?? "—"}
                    </span>
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {course.taskCompleted}/{course.taskTotal} tasks
                  </span>
                  <span>
                    {course.gradeAverage !== null
                      ? `Avg ${course.gradeAverage}%`
                      : `${course.gradeCount} grade${course.gradeCount === 1 ? "" : "s"}`}
                  </span>
                </div>
                {course.taskProgress !== null && (
                  <Progress value={course.taskProgress} className="mt-2" />
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Goals, notes, grades, resources, activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Active goals" icon={Target} href="/goals" linkLabel="Manage">
          {data.activeGoals.length === 0 ? (
            <EmptyState icon={Target} title="No active goals" className="py-6" />
          ) : (
            <ul className="space-y-4">
              {data.activeGoals.slice(0, 4).map((goal) => (
                <li key={goal.id}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{goal.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {goal.milestoneCompleted}/{goal.milestoneTotal} · {goal.progress}%
                    </span>
                  </div>
                  <Progress value={goal.progress} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Recent notes" icon={StickyNote} href="/notes" linkLabel="Open">
          {data.recentNotes.length === 0 ? (
            <EmptyState icon={StickyNote} title="No notes yet" className="py-6" />
          ) : (
            <ul className="space-y-2.5">
              {data.recentNotes.slice(0, 4).map((note) => (
                <li key={note.id}>
                  <Link
                    href={`/notes?note=${note.id}`}
                    className="block rounded-lg bg-muted/50 px-3 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="block truncate font-medium">{note.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {note.course?.code ?? relativeTime(note.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Recent grades" icon={Sparkles} href="/analytics" linkLabel="Analytics">
          {data.recentGrades.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No grades recorded"
              description="Grades you record will appear here."
              className="py-6"
            />
          ) : (
            <ul className="space-y-2.5">
              {data.recentGrades.slice(0, 4).map((grade) => (
                <li
                  key={grade.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{grade.title}</span>
                  <span className="shrink-0 font-semibold text-primary">
                    {grade.score !== null ? grade.score : "—"}
                    {grade.maxScore ? ` / ${grade.maxScore}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Recent activity" icon={History} href="/settings" linkLabel="Settings">
          {data.activity.length === 0 ? (
            <EmptyState
              icon={History}
              title="No activity yet"
              description="Work you do across the app is summarised here."
              className="py-6"
            />
          ) : (
            <ul className="space-y-2.5">
              {data.activity.slice(0, 7).map((item) => (
                <ActivityRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Resources" icon={Library} href="/resources" linkLabel="Library">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Library className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <p className="text-2xl font-bold tracking-tight">{data.resources.total}</p>
              <p className="text-sm text-muted-foreground">
                resource{data.resources.total === 1 ? "" : "s"} saved across your courses
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Term structure"
          icon={GraduationCap}
          href="/academics"
          linkLabel="Manage"
        >
          {data.currentSemester ? (
            <div className="space-y-1 text-sm">
              <p className="font-medium">{data.currentSemester.name}</p>
              <p className="text-muted-foreground">
                {format(new Date(data.currentSemester.startDate), "MMM d, yyyy")} –{" "}
                {format(new Date(data.currentSemester.endDate), "MMM d, yyyy")}
              </p>
              {data.academicYears.length > 1 && (
                <p className="pt-2 text-xs text-muted-foreground">
                  {data.academicYears.length} academic years on record
                </p>
              )}
            </div>
          ) : (
            <EmptyState
              icon={GraduationCap}
              title="No active semester"
              description="Set up your academic years to unlock term-scoped planning."
              className="py-6"
              action={
                <Button asChild size="sm">
                  <Link href="/academics">Set up academics</Link>
                </Button>
              }
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
