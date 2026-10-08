"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Book,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Flame,
  GraduationCap,
  History,
  ListTodo,
  Paperclip,
  Plus,
  Sparkles,
  Target,
  Timer,
  Award,
} from "lucide-react";
import { format } from "date-fns";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}



import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/domain/stat-card";
import { EmptyState } from "@/components/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useDashboard } from "@/features/dashboard/hooks";
import { useCompleteTask } from "@/features/tasks/hooks";
import { useAuth } from "@/features/auth/auth-provider";
import type { ActivityKind, DashboardActivity, DashboardTask } from "@/types/api-types";
import { dueLabel, formatMinutes, relativeTime } from "@/lib/format";
import { CourseSwatch } from "@/components/domain/course-swatch";
import { cn } from "@/lib/utils";

// ─── Activity Row ──────────────────────────────────────

const ACTIVITY_META: Record<ActivityKind, { icon: typeof ListTodo; href: string; label: string }> = {
  task: { icon: ListTodo, href: "/tasks", label: "Task" },
  note: { icon: Book, href: "/notes", label: "Note" },
  grade: { icon: Award, href: "/analytics", label: "Grade" },
  event: { icon: CalendarClock, href: "/calendar", label: "Event" },
  goal: { icon: Target, href: "/goals", label: "Goal" },
  resource: { icon: Paperclip, href: "/resources", label: "Resource" },
};

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
        className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50"
      >
        {body}
      </Link>
    </li>
  ) : (
    <li className="flex items-center gap-3 rounded-lg px-3 py-2">{body}</li>
  );
}

// ─── Task Row (with quick complete) ───────────────────

/**
 * One task line used by Overdue and What's next. The check button is a real
 * mutation — it completes the task in place and the dashboard query is
 * invalidated, so the counts move without a reload.
 */
function TaskRow({ task, variant }: { task: DashboardTask; variant: "overdue" | "upcoming" }) {
  const complete = useCompleteTask();
  const l = dueLabel(task.dueDate, task.status);
  const late = variant === "overdue" || l.tone === "overdue";

  return (
    <li className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50">
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", late ? "bg-danger" : l.tone === "soon" ? "bg-warning" : "bg-primary")}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", late && "font-medium text-danger")}>{task.title}</span>
        <span className="block text-xs text-muted-foreground">
          {task.course?.code ?? task.course?.name ?? "No course"} · {l.label}
        </span>
      </span>
      {late && (
        <span className="shrink-0 rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
          Overdue
        </span>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Mark ${task.title} complete`}
        disabled={complete.isPending}
        onClick={() => complete.mutate(task.id)}
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden />
      </Button>
    </li>
  );
}

// ─── Collapsible Section ──────────────────────────────

function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
  extraActions,
}: {
  title: string;
  icon: typeof ListTodo;
  defaultOpen?: boolean;
  children: React.ReactNode;
  extraActions?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="surface-panel p-5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2"
        >
          <Icon className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="font-semibold">{title}</h2>
        </button>
        <div className="flex items-center gap-2">
          {extraActions}
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "rotate-90")}
            aria-hidden
          />
        </div>
      </div>
      {open && <div className="pt-3">{children}</div>}
    </section>
  );
}

// ─── Quick Action Widget ──────────────────────────────

function QuickAction({
  icon: Icon,
  label,
  href,
  chip,
}: {
  icon: typeof ListTodo;
  label: string;
  href: string;
  /** Background/tint classes for the icon chip only. */
  chip: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border px-3 py-2 transition-colors hover:border-primary/40 hover:bg-muted/50"
    >
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", chip)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="truncate text-xs font-medium">{label}</span>
    </Link>
  );
}


// ─── Dashboard Page ────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const dashboard = useDashboard();

  if (dashboard.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-1/2" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl opacity-50" />)}
        </div>
        <Skeleton className="h-40 rounded-xl opacity-50" />
      </div>
    );
  }

  if (dashboard.isError) {
    return <ErrorState error={dashboard.error} retry={() => dashboard.refetch()} />;
  }

  const data = dashboard.data!;
  const firstName = user?.firstName ?? "there";
  const todoCount = data.tasks.byStatus.TODO ?? 0;
  const inProgress = data.tasks.byStatus.IN_PROGRESS ?? 0;

  // Term progress, from the real start/end dates on the dashboard payload.
  // No term configured (or malformed dates) simply omits the panel.
  const term = data.currentSemester;
  const termStart = term ? new Date(term.startDate) : null;
  const termEnd = term ? new Date(term.endDate) : null;
  const termValid = Boolean(
    termStart &&
      termEnd &&
      !Number.isNaN(termStart.getTime()) &&
      !Number.isNaN(termEnd.getTime()) &&
      termEnd.getTime() > termStart.getTime(),
  );
  const now = Date.now();
  const termPct =
    termValid && termStart && termEnd
      ? Math.min(
          100,
          Math.max(0, Math.round(((now - termStart.getTime()) / (termEnd.getTime() - termStart.getTime())) * 100)),
        )
      : 0;
  const termStarted = Boolean(termValid && termStart && now >= termStart.getTime());
  const termDaysLeft =
    termValid && termEnd ? Math.ceil((termEnd.getTime() - now) / 86_400_000) : 0;

  return (
    <div>
      <PageHeader
        kicker="Command center"
        title={`${greeting()}, ${firstName}`}
        description={`You have ${todoCount} todo, ${inProgress} in progress, ${data.tasks.overdue} overdue`}
        actions={
          <Button size="sm" variant="outline" onClick={() => void dashboard.refetch()}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={ListTodo}
          label="Todo"
          value={todoCount}
          hint={
            todoCount === 0
              ? "All caught up"
              : `${data.tasks.overdue} overdue${todoCount > 0 ? `, ${todoCount} todo` : ""}`
          }
          tone={todoCount > 0 ? (data.tasks.overdue > 0 ? "danger" : "warning") : "success"}
        />
        <StatCard
          icon={BookOpen}
          label="Active courses"
          value={data.courses.active}
          hint={`${data.courses.total} total${data.courses.completed > 0 ? `, ${data.courses.completed} done` : ""}`}
          tone="primary"
        />
        <StatCard
          icon={CalendarClock}
          label="Next exam"
          value={data.exams.upcoming[0] ? format(new Date(data.exams.upcoming[0].startAt), "MMM d") : "—"}
          hint={
            data.exams.upcoming[0]
              ? data.exams.nextInDays === 0
                ? "Today"
                : data.exams.nextInDays === 1
                ? "Tomorrow"
                : `In ${data.exams.nextInDays} days`
              : "Nothing scheduled"
          }
          tone={data.exams.nextInDays !== null && data.exams.nextInDays <= 3 ? "danger" : "primary"}
        />
        <StatCard
          icon={Flame}
          label="Studied today"
          value={formatMinutes(data.studySessions.todayMinutes)}
          hint={`${formatMinutes(data.studySessions.weekMinutes)} this week`}
          tone="primary"
        />
      </div>

      {term && termValid && termStart && termEnd && (
        <section className="surface-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
              <h2 className="font-semibold">{term.name}</h2>
              <span className="text-xs text-muted-foreground">Current term</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {!termStarted
                ? `Starts ${format(termStart, "MMM d, yyyy")}`
                : termDaysLeft <= 0
                ? `Ended ${format(termEnd, "MMM d, yyyy")}`
                : `${termPct}% through · ${termDaysLeft === 1 ? "1 day left" : `${termDaysLeft} days left`}`}
            </p>
          </div>
          <Progress
            className="mt-3"
            label={`${term.name} progress`}
            value={termStarted ? termPct : 0}
            valueText={
              !termStarted
                ? "Not started"
                : termDaysLeft <= 0
                ? "Finished"
                : `${termPct}% through, ${termDaysLeft} days left`
            }
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {format(termStart, "MMM d")} – {format(termEnd, "MMM d, yyyy")}
          </p>
        </section>
      )}

      <section className="surface-panel p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="font-semibold">Quick actions</h2>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/ai">
              Ask AI <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
        {/* Every one of these lands somewhere that acts: `?new=1` / `?note=new`
            open the editor on the target page, the rest open the tool itself. */}
        <div className="flex flex-wrap gap-2">
          <QuickAction icon={Plus} label="Add task" href="/tasks?new=1" chip="bg-primary/10 text-primary" />
          <QuickAction icon={BookOpen} label="Add note" href="/notes?note=new" chip="bg-blue-500/10 text-blue-500" />
          <QuickAction icon={Target} label="Add goal" href="/goals?new=1" chip="bg-violet-500/10 text-violet-500" />
          <QuickAction icon={GraduationCap} label="Add course" href="/courses?new=1" chip="bg-amber-500/10 text-amber-600" />
          <QuickAction icon={Timer} label="Start study" href="/study" chip="bg-green-500/10 text-green-600" />
          <QuickAction icon={CalendarClock} label="Calendar" href="/calendar" chip="bg-orange-500/10 text-orange-600" />
          <QuickAction icon={Sparkles} label="Ask AI" href="/ai" chip="bg-primary/10 text-primary" />
        </div>
      </section>

      {/* The two things a student must not have to hunt for: what is late and
          what is unread. Both come straight from the dashboard payload. */}
      {(data.tasks.overdue > 0 || data.notifications.unreadCount > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {data.tasks.overdue > 0 && (
            <Button asChild variant="outline" size="sm" className="border-danger/40 text-danger hover:bg-danger/10">
              <Link href="/tasks">
                <AlertTriangle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {data.tasks.overdue} overdue task{data.tasks.overdue !== 1 ? "s" : ""}
              </Link>
            </Button>
          )}
          {data.notifications.unreadCount > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href="/notifications">
                {data.notifications.unreadCount} unread notification
                {data.notifications.unreadCount !== 1 ? "s" : ""}
              </Link>
            </Button>
          )}
        </div>
      )}

      <div className="space-y-4">
        {/* Overdue — the first question a command center has to answer. */}
        <CollapsibleSection title="Overdue" icon={AlertTriangle} defaultOpen={true}>
          {data.overdueTasks.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing overdue"
              description="Every deadline is still ahead of you."
              className="py-4"
            />
          ) : (
            <ul className="space-y-1">
              {data.overdueTasks.slice(0, 6).map((task) => (
                <TaskRow key={task.id} task={task} variant="overdue" />
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* What's next */}
        <CollapsibleSection title="What's next" icon={CalendarClock} defaultOpen={true}>
          {data.upcomingTasks.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="All caught up" description="Nothing due. Enjoy the calm." className="py-4" />
          ) : (
            <ul className="space-y-1">
              {data.upcomingTasks.slice(0, 5).map((task) => (
                <TaskRow key={task.id} task={task} variant="upcoming" />
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* Exams */}
        <CollapsibleSection title="Exams" icon={AlertTriangle} defaultOpen={true}>
          {data.exams.upcoming.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No exams scheduled" description="Planned exams will show up here." className="py-4" />
          ) : (
            <ul className="space-y-1">
              {data.exams.upcoming.slice(0, 5).map((exam) => (
                <li key={exam.id}>
                  <Link
                    href="/exams"
                    className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{exam.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {exam.course?.code ?? exam.course?.name ?? "No course"}
                        {exam.location ? ` · ${exam.location}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {format(new Date(exam.startAt), "EEE · MMM d")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* Tasks summary */}
        <CollapsibleSection title="Tasks" icon={ListTodo} defaultOpen={true}>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">To do</span>
                <span className="text-sm font-bold tabular-nums">{todoCount}</span>
              </div>
              <Progress value={(todoCount / Math.max(1, data.tasks.total)) * 100} className="mt-2" label="" />
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">In progress</span>
                <span className="text-sm font-bold tabular-nums">{inProgress}</span>
              </div>
              <Progress value={(inProgress / Math.max(1, data.tasks.total)) * 100} className="mt-2" label="" />
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Completed</span>
                <span className="text-sm font-bold tabular-nums">{data.tasks.byStatus.COMPLETED ?? 0}</span>
              </div>
              <Progress value={((data.tasks.byStatus.COMPLETED || 0) / Math.max(1, data.tasks.total)) * 100} className="mt-2" label="" />
            </div>
          </div>
        </CollapsibleSection>

        {/* Courses — where each subject stands, straight from the payload. */}
        <CollapsibleSection title="Courses" icon={BookOpen} defaultOpen={false}>
          {data.courses.recent.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No courses yet"
              description="Add a course to connect tasks, notes and grades to it."
              className="py-4"
            />
          ) : (
            <ul className="space-y-1">
              {data.courses.recent.slice(0, 6).map((course) => (
                <li key={course.id}>
                  <Link
                    href="/courses"
                    className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50"
                  >
                    <CourseSwatch id={course.id} className="h-6 w-6 shrink-0 rounded" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {course.code ? `${course.code} · ` : ""}
                        {course.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {course.taskCompleted}/{course.taskTotal} tasks done
                        {course.gradeAverage !== null ? ` · ${course.gradeAverage.toFixed(0)}%` : ""}
                      </span>
                    </span>
                    {course.taskProgress !== null && (
                      <Progress value={course.taskProgress} className="h-1.5 w-20 shrink-0" label="" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* Calendar */}
        <CollapsibleSection title="Calendar" icon={CalendarClock} defaultOpen={true}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Today</p>
              {data.events.today.length === 0 ? (
                <p className="rounded px-2 py-1 text-xs text-muted-foreground">Nothing scheduled</p>
              ) : (
                <ul className="space-y-1">
                  {data.events.today.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/calendar?eventId=${e.id}`}
                        className="block truncate rounded px-2 py-1 text-xs hover:bg-muted/50 transition-colors"
                      >
                        <span className="font-medium">{e.title}</span>
                        <span className="text-muted-foreground"> · {format(new Date(e.startAt), "h:mm")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Upcoming</p>
              {data.events.upcoming.length === 0 ? (
                <p className="rounded px-2 py-1 text-xs text-muted-foreground">Nothing scheduled</p>
              ) : (
                <ul className="space-y-1">
                  {data.events.upcoming.slice(0, 5).map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/calendar?eventId=${e.id}`}
                        className="block truncate rounded px-2 py-1 text-xs hover:bg-muted/50 transition-colors"
                      >
                        <span className="font-medium">{e.title}</span>
                        <span className="text-muted-foreground"> · {format(new Date(e.startAt), "MMM d · h:mm")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CollapsibleSection>


        {/* Study */}
        <CollapsibleSection title="Study" icon={Timer} defaultOpen={true}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Today</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold tabular-nums">{formatMinutes(data.studySessions.todayMinutes)}</span>
                <span className="text-xs text-muted-foreground">sessions: {data.studySessions.todayCount}</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">This week</p>
              <span className="text-2xl font-bold tabular-nums">{formatMinutes(data.studySessions.weekMinutes)}</span>
            </div>
          </div>
          {data.studySessions.recent.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Recent</p>
              <ul className="space-y-1">
                {data.studySessions.recent.slice(0, 4).map((s) => (
                  <li key={s.id}>
                    <span className="block truncate text-xs">{s.topic ?? "Untagged session"}</span>
                    <span className="text-xs text-muted-foreground"> · {formatMinutes(s.durationMinutes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CollapsibleSection>

        {/* Goals */}
        <CollapsibleSection title="Goals" icon={Target} defaultOpen={true}>
          {data.activeGoals.length === 0 ? (
            <EmptyState icon={Target} title="No active goals" description="Set a goal to track your progress." className="py-4" />
          ) : (
            <div className="space-y-2">
              {data.activeGoals.slice(0, 5).map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">{g.title}</p>
                    <div className="mt-1"><Progress value={g.progress} className="h-1.5" label="" /></div>
                  </div>
                  <span className="text-xs text-muted-foreground">{g.progress}%</span>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* Notes */}
        <CollapsibleSection title="Notes" icon={BookOpen} defaultOpen={false}>
          {data.recentNotes.length === 0 ? (
            <EmptyState icon={BookOpen} title="No notes yet" description="Create your first note or import a resource." className="py-4" />
          ) : (
            <ul className="space-y-1">
              {data.recentNotes.slice(0, 5).map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/notes?note=${n.id}`}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{n.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {n.updatedAt ? format(new Date(n.updatedAt), "MMM d · h:mm") : "No updated date"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* Grades */}
        <CollapsibleSection title="Grades" icon={Award} defaultOpen={false}>
          {data.recentGrades.length === 0 ? (
            <EmptyState icon={Award} title="No grade data" description="Grade data will appear once synced." className="py-4" />
          ) : (
            <div className="space-y-2">
              {data.recentGrades.slice(0, 5).map((g) => (
                <div key={g.id} className="flex items-center gap-3 rounded-lg px-3 py-2">
                  <CourseSwatch id={g.course?.id ?? "default"} className="h-6 w-6 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{g.course?.name ?? g.title}</span>
                    <span className="block text-xs text-muted-foreground">{format(new Date(g.recordedAt), "yyyy")} · {g.type ?? "Score"}</span>
                  </span>
                  <span
                    className={cn(
                      "text-sm font-bold tabular-nums",
                      g.score !== null && g.score >= 90
                        ? "text-success"
                        : g.score !== null && g.score >= 80
                        ? "text-primary"
                        : g.score !== null && g.score >= 70
                        ? "text-warning"
                        : "text-danger",
                    )}
                  >
                    {g.score !== null ? g.score.toFixed(1) : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>


        {/* Activity */}
        <CollapsibleSection title="Recent activity" icon={History} defaultOpen={false}>
          {data.activity.length === 0 ? (
            <EmptyState icon={History} title="No activity yet" description="Your actions will show up here." className="py-4" />
          ) : (
            <ul className="space-y-1">
              {data.activity.slice(0, 8).map((a) => (
                <ActivityRow key={a.id} item={a} />
              ))}
            </ul>
          )}
        </CollapsibleSection>

        {/* Resources */}
        <CollapsibleSection title="Resources" icon={Paperclip} defaultOpen={false}>
          <Link
            href="/resources"
            className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50"
          >
            <span className="text-sm">{data.resources.total} resource{data.resources.total !== 1 ? "s" : ""} stored</span>
            <span className="flex items-center gap-1 text-xs font-medium text-primary">
              Open library <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          </Link>
        </CollapsibleSection>

        {/* AI — its own block, never mixed into Analytics. */}
        <section className="surface-panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                <h2 className="font-semibold">AI Study Assistant</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask about a course, what to study next, upcoming deadlines or your tasks — grounded in your own
                StudentOS data.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/ai">
                Open assistant <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
        </section>


        {/* Term structure */}
        <CollapsibleSection title="Term calendar" icon={CalendarClock} defaultOpen={false}>
          {!data.currentSemester?.startDate || !data.currentSemester?.endDate ? (
            <EmptyState icon={CalendarClock} title="No term data" description="Term dates will appear once configured." className="py-4" />
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Start</p>
                  <p className="text-sm font-semibold">{format(new Date(data.currentSemester.startDate), "MMMM d, yyyy")}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">End</p>
                  <p className="text-sm font-semibold">{format(new Date(data.currentSemester.endDate), "MMMM d, yyyy")}</p>
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Current term</p>
                <p className="text-sm font-semibold">{data.currentSemester.name}</p>
                {data.currentSemester.academicYear && (
                  <p className="text-xs text-muted-foreground">
                    Academic year {format(new Date(data.currentSemester.academicYear.startDate), "yyyy")}–
                    {format(new Date(data.currentSemester.academicYear.endDate), "yyyy")}
                  </p>
                )}
              </div>
            </div>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}

