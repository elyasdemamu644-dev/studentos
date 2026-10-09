"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Award,
  Bell,
  Book,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock,
  Flame,
  GraduationCap,
  History,
  Library,
  ListTodo,
  MapPin,
  Paperclip,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Timer,
} from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";

import { StatCard } from "@/components/domain/stat-card";
import { CourseSwatch } from "@/components/domain/course-swatch";
import { PriorityBadge } from "@/components/domain/priority-badge";
import { EmptyState, GridSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { IconChip } from "@/components/ui/surface";
import { Chip, Panel, type Tone } from "@/components/panel";
import { useDashboard } from "@/features/dashboard/hooks";
import { useCompleteTask } from "@/features/tasks/hooks";
import { useAuth } from "@/features/auth/auth-provider";
import type {
  ActivityKind,
  DashboardActivity,
  DashboardEvent,
  DashboardTask,
} from "@/types/api-types";
import { dueLabel, formatMinutes, relativeTime } from "@/lib/format";
import { TASK_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** Circular progress ring for the term card. Colours come from theme tokens. */
function ProgressRing({ value, label }: { value: number; label: string }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 88 88" className="h-24 w-24 -rotate-90" role="img" aria-label={label}>
        <circle cx="44" cy="44" r={radius} fill="none" strokeWidth="8" className="stroke-primary/15" />
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="stroke-primary transition-[stroke-dashoffset]"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums">
        {clamped}%
      </span>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

// ─── Task row (quick complete) ────────────────────────

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
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        late
          ? "border-danger/20 bg-danger/5"
          : "border-warning/30 hover:border-warning/60 hover:bg-muted/40",
      )}
    >
      {task.course ? (
        <CourseSwatch id={task.course.id} className="h-7 w-7 shrink-0 rounded-md" />
      ) : (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden
        >
          <ListTodo className="h-3.5 w-3.5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium", late && "text-danger")}>
          {task.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {task.course?.code ?? task.course?.name ?? "No course"} · {l.label}
        </span>
      </span>
      <span className="hidden shrink-0 sm:block">
        <PriorityBadge priority={task.priority} />
      </span>
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

// ─── Schedule row (agenda) ────────────────────────────

function ScheduleRow({ event, upcoming = false }: { event: DashboardEvent; upcoming?: boolean }) {
  const start = new Date(event.startAt);
  const isExam = event.type === "EXAM";

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        isExam
          ? "border-danger/25 bg-danger/5 hover:border-danger/40"
          : "border-primary/30 bg-muted/20 hover:border-primary/60 hover:bg-muted/50",
      )}
    >
      <span className="w-14 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
        {upcoming ? format(start, "EEE d") : format(start, "h:mm")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {isExam && (
            <span className="mr-1.5 inline-flex items-center rounded-badge bg-danger/15 px-1.5 py-px text-[10px] font-bold uppercase text-danger">
              Exam
            </span>
          )}
          {event.title}
        </span>
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {event.course && <span className="truncate">{event.course.code ?? event.course.name}</span>}
          {event.location && (
            <>
              {event.course && <span aria-hidden>·</span>}
              <MapPin className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{event.location}</span>
            </>
          )}
          {upcoming && <span aria-hidden>·</span>}
          {upcoming && <span className="shrink-0">{format(start, "h:mm a")}</span>}
        </span>
      </span>
    </li>
  );
}

// ─── Activity row ─────────────────────────────────────

const ACTIVITY_META: Record<
  ActivityKind,
  { icon: LucideIcon; href: string; label: string; tone: Tone }
> = {
  task: { icon: ListTodo, href: "/tasks", label: "Task", tone: "primary" },
  note: { icon: Book, href: "/notes", label: "Note", tone: "neutral" },
  grade: { icon: Award, href: "/analytics", label: "Grade", tone: "success" },
  event: { icon: CalendarClock, href: "/calendar", label: "Event", tone: "warning" },
  goal: { icon: Target, href: "/goals", label: "Goal", tone: "primary" },
  resource: { icon: Paperclip, href: "/resources", label: "Resource", tone: "neutral" },
};

function ActivityRow({ item }: { item: DashboardActivity }) {
  const meta = ACTIVITY_META[item.kind];
  const Icon = meta.icon;
  const body = (
    <>
      <IconChip icon={Icon} tone={meta.tone} className="h-7 w-7" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {meta.label} · {relativeTime(item.at)}
        </span>
      </span>
    </>
  );
  return item.href ? (
    <li>
      <Link
        href={item.href}
                    className="flex items-center gap-3 rounded-lg border border-primary/30 px-2 py-2 transition-colors hover:bg-muted/50"
      >
        {body}
      </Link>
    </li>
  ) : (
    <li className="flex items-center gap-3 rounded-lg border border-primary/20 px-2 py-2">{body}</li>
  );
}

// ─── Quick action tile ────────────────────────────────

function QuickAction({
  icon: Icon,
  label,
  href,
  chip,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  /** Background/tint classes for the icon chip only. */
  chip: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 items-center gap-2.5 rounded-lg border border-primary/30 bg-muted/30 px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:bg-muted/60"
    >
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", chip)}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      <ArrowUpRight
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
    </Link>
  );
}

// ─── Dashboard page ───────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const dashboard = useDashboard();

  if (dashboard.isPending) {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className="space-y-4">
        <span className="sr-only">Loading dashboard</span>
        <div aria-hidden className="space-y-4">
          <div className="surface-panel p-6">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-3 h-9 w-80 max-w-full" />
            <Skeleton className="mt-3 h-4 w-96 max-w-full" />
            <div className="mt-5 flex gap-2">
              <Skeleton className="h-6 w-24 rounded-badge" />
              <Skeleton className="h-6 w-28 rounded-badge" />
              <Skeleton className="h-6 w-32 rounded-badge" />
            </div>
          </div>
          <GridSkeleton cards={4} />
          <div className="grid grid-flow-row-dense gap-4 lg:grid-cols-3">
            <div className="surface-panel p-5 lg:col-span-2">
              <Skeleton className="h-5 w-32" />
              <div className="mt-4 space-y-3">
                <Skeleton className="h-14 rounded-lg" />
                <Skeleton className="h-14 rounded-lg" />
              </div>
            </div>
            <div className="surface-panel p-5">
              <Skeleton className="h-5 w-32" />
              <div className="mt-4 flex items-center gap-4">
                <Skeleton className="h-24 w-24 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            </div>
            <div className="surface-panel p-5 lg:col-span-2">
              <Skeleton className="h-5 w-40" />
              <div className="mt-4 space-y-3">
                <Skeleton className="h-14 rounded-lg" />
                <Skeleton className="h-14 rounded-lg" />
                <Skeleton className="h-14 rounded-lg" />
              </div>
            </div>
            <div className="surface-panel p-5">
              <Skeleton className="h-5 w-28" />
              <div className="mt-4 space-y-2">
                <Skeleton className="h-9 rounded-lg" />
                <Skeleton className="h-9 rounded-lg" />
                <Skeleton className="h-9 rounded-lg" />
              </div>
            </div>
          </div>
        </div>
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
  const completedCount = data.tasks.byStatus.COMPLETED ?? 0;
  const cancelledCount = data.tasks.byStatus.CANCELLED ?? 0;
  const overdue = data.tasks.overdue;
  const dueToday = data.tasks.dueToday;
  const unread = data.notifications.unreadCount;
  const nextExam = data.exams.upcoming[0];

  const summary = [
    `${todoCount} todo`,
    `${inProgress} in progress`,
    ...(dueToday > 0 ? [`${dueToday} due today`] : []),
    ...(overdue > 0 ? [`${overdue} overdue`] : []),
  ].join(" · ");

  const hasAlerts = overdue > 0 || dueToday > 0 || unread > 0 || nextExam !== undefined;

  // Term progress, from the real start/end dates on the dashboard payload.
  // No term configured (or malformed dates) simply omits the panels.
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
  const termDaysLeft = termValid && termEnd ? Math.ceil((termEnd.getTime() - now) / 86_400_000) : 0;

  const taskTotal = Math.max(1, data.tasks.total);
  const statusSegments = [
    { key: "TODO", label: TASK_STATUS_LABELS.TODO, value: todoCount, bar: "bg-warning", dot: "bg-warning" },
    { key: "IN_PROGRESS", label: TASK_STATUS_LABELS.IN_PROGRESS, value: inProgress, bar: "bg-primary", dot: "bg-primary" },
    { key: "COMPLETED", label: TASK_STATUS_LABELS.COMPLETED, value: completedCount, bar: "bg-success", dot: "bg-success" },
    { key: "CANCELLED", label: TASK_STATUS_LABELS.CANCELLED, value: cancelledCount, bar: "bg-muted-foreground/30", dot: "bg-muted-foreground/50" },
  ];
  const visibleSegments = statusSegments.filter((s) => s.value > 0);
  const breakdownLabel = statusSegments
    .filter((s) => s.value > 0)
    .map((s) => `${s.value} ${s.label.toLowerCase()}`)
    .join(", ");

  return (
    <div className="space-y-4">
      {/* ── Hero ───────────────────────────────────── */}
      <header
        className="surface-panel relative overflow-hidden animate-fade-in"
        style={{
          backgroundImage:
            "linear-gradient(120deg, hsl(var(--primary) / 0.14), hsl(var(--accent) / 0.08) 45%, transparent 75%)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Command center · {format(new Date(), "EEEE, MMMM d")}
            </p>
            <h1 className="mt-1.5 text-3xl font-bold tracking-tight">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {hasAlerts ? (
                <>
                  {overdue > 0 && (
                    <Chip tone="danger" icon={AlertTriangle} href="/tasks">
                      {overdue} overdue task{overdue !== 1 ? "s" : ""}
                    </Chip>
                  )}
                  {dueToday > 0 && (
                    <Chip tone="warning" icon={Clock} href="/tasks">
                      {dueToday} due today
                    </Chip>
                  )}
                  {unread > 0 && (
                    <Chip tone="primary" icon={Bell} href="/notifications">
                      {unread} unread notification{unread !== 1 ? "s" : ""}
                    </Chip>
                  )}
                  {nextExam && (
                    <Chip
                      tone={daysUntil(nextExam.startAt) <= 3 ? "danger" : "neutral"}
                      icon={GraduationCap}
                      href="/exams"
                    >
                      {nextExam.title} · {daysUntil(nextExam.startAt) === 0 ? "today" : `in ${daysUntil(nextExam.startAt)}d`}
                    </Chip>
                  )}
                </>
              ) : (
                <Chip tone="success" icon={CheckCircle2}>
                  All clear — nothing needs you right now
                </Chip>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button asChild>
              <Link href="/tasks?new=1">
                <Plus className="mr-1 h-4 w-4" aria-hidden /> New task
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/study">
                <Timer className="mr-1 h-4 w-4" aria-hidden /> Start focus
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/ai">
                <Sparkles className="mr-1 h-4 w-4" aria-hidden /> Ask AI
              </Link>
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh dashboard"
              disabled={dashboard.isFetching}
              onClick={() => void dashboard.refetch()}
            >
              <RefreshCw className={cn("h-4 w-4", dashboard.isFetching && "animate-spin")} aria-hidden />
            </Button>
          </div>
        </div>
        {termValid && termStart && termEnd && term && (
          <div className="relative border-t border-border/60 px-6 py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span className="font-medium">
                {term.name}
                {termStarted && termDaysLeft > 0 && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {termPct}% through · {termDaysLeft === 1 ? "1 day left" : `${termDaysLeft} days left`}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">
                {format(termStart, "MMM d")} – {format(termEnd, "MMM d, yyyy")}
              </span>
            </div>
            <Progress
              className="mt-2 h-1.5"
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
          </div>
        )}
      </header>

      {/* ── Stats ──────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-fade-in" style={{ animationDelay: "60ms" }}>
        <StatCard
          icon={ListTodo}
          label="Todo"
          value={todoCount}
          href="/tasks"
          action={<ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
          hint={
            todoCount === 0
              ? "All caught up"
              : `${dueToday} due today${overdue > 0 ? ` · ${overdue} overdue` : ""}`
          }
          tone={todoCount > 0 ? (overdue > 0 ? "danger" : "warning") : "success"}
        />
        <StatCard
          icon={BookOpen}
          label="Active courses"
          value={data.courses.active}
          href="/courses"
          action={<ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
          hint={`${data.courses.total} total${data.courses.completed > 0 ? ` · ${data.courses.completed} done` : ""}`}
          tone="primary"
        />
        <StatCard
          icon={CalendarClock}
          label="Next exam"
          value={nextExam ? format(new Date(nextExam.startAt), "MMM d") : "—"}
          href="/exams"
          action={<ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
          hint={
            nextExam
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
          href="/study"
          action={<ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
          hint={`${formatMinutes(data.studySessions.weekMinutes)} last 7 days`}
          tone="primary"
        />
      </div>

      {/* ── Main columns ───────────────────────────── */}
      <div className="grid grid-flow-row-dense gap-4 lg:grid-cols-3">
        <div className="contents">
          {/* Overdue — the first question a command center has to answer. */}
          <Panel
            title="Overdue"
            icon={AlertTriangle}
            tone="danger"
            href="/tasks"
            linkLabel="All tasks"
            className="lg:col-span-2"
          >
            {overdue === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nothing overdue"
                description="Every deadline is still ahead of you."
                className="py-6"
              />
            ) : (
              <ul className="space-y-1.5">
                {data.overdueTasks.slice(0, 6).map((task) => (
                  <TaskRow key={task.id} task={task} variant="overdue" />
                ))}
              </ul>
            )}
          </Panel>

          {/* What's next */}
          <Panel
            title="What's next"
            icon={Clock}
            tone="warning"
            href="/tasks"
            linkLabel="All tasks"
            className="lg:col-span-2"
          >
            {data.upcomingTasks.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="All caught up"
                description="Nothing due. Enjoy the calm."
                className="py-6"
              />
            ) : (
              <ul className="space-y-1.5">
                {data.upcomingTasks.slice(0, 5).map((task) => (
                  <TaskRow key={task.id} task={task} variant="upcoming" />
                ))}
              </ul>
            )}
          </Panel>

          {/* Schedule — today's agenda plus what's just over the horizon. */}
          <Panel
            title="Schedule"
            icon={CalendarClock}
            href="/calendar"
            linkLabel="Calendar"
            className="lg:col-span-2"
          >
            {data.events.today.length === 0 && data.events.upcoming.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Nothing scheduled"
                description="Your calendar is clear for now."
                className="py-6"
              />
            ) : (
              <div className="space-y-4">
                {data.events.today.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Today
                    </p>
                    <ul className="space-y-1.5">
                      {data.events.today.slice(0, 4).map((e) => (
                        <ScheduleRow key={e.id} event={e} />
                      ))}
                    </ul>
                  </div>
                )}
                {data.events.upcoming.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Coming up
                    </p>
                    <ul className="space-y-1.5">
                      {data.events.upcoming.slice(0, 4).map((e) => (
                        <ScheduleRow key={e.id} event={e} upcoming />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Panel>

          {/* Courses — where each subject stands, straight from the payload. */}
          <Panel
            title="Courses"
            icon={BookOpen}
            href="/courses"
            linkLabel="All courses"
            className="lg:col-span-2"
          >
            {data.courses.recent.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No courses yet"
                description="Add a course to connect tasks, notes and grades to it."
                className="py-6"
              />
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {data.courses.recent.slice(0, 6).map((course) => (
                  <Link
                    key={course.id}
                    href="/courses"
                    className="group flex items-center gap-3 rounded-lg border border-primary/30 bg-muted/20 px-3 py-3 transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:bg-muted/50"
                  >
                    <CourseSwatch id={course.id} className="h-10 w-10 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {course.code ? `${course.code} · ` : ""}
                        {course.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {course.taskCompleted}/{course.taskTotal} tasks
                        {course.gradeAverage !== null ? ` · ${course.gradeAverage.toFixed(0)}%` : ""}
                      </span>
                      {course.taskProgress !== null && (
                        <Progress
                          className="mt-1.5 h-1.5"
                          label={`${course.name} task progress`}
                          value={course.taskProgress}
                          valueText={`${course.taskProgress}% of tasks done`}
                        />
                      )}
                    </span>
                    <ArrowUpRight
                      className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="contents">
          {/* Term */}
          {termValid && termStart && termEnd && term && (
            <section className="surface-panel p-5">
              <div className="flex items-center gap-2.5">
                <IconChip icon={CalendarClock} />
                <h2 className="min-w-0 flex-1 truncate font-semibold">Term progress</h2>
                <span className="shrink-0 text-xs text-muted-foreground">Current term</span>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <ProgressRing
                  value={termStarted ? termPct : 0}
                  label={`${term.name} progress, ${termStarted ? `${termPct}%` : "not started"}`}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{term.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {!termStarted
                      ? `Starts ${format(termStart, "MMM d, yyyy")}`
                      : termDaysLeft <= 0
                        ? `Ended ${format(termEnd, "MMM d, yyyy")}`
                        : termDaysLeft === 1
                          ? "1 day left"
                          : `${termDaysLeft} days left`}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {format(termStart, "MMM d")} – {format(termEnd, "MMM d, yyyy")}
                  </p>
                  {term.academicYear && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      AY {format(new Date(term.academicYear.startDate), "yyyy")}–
                      {format(new Date(term.academicYear.endDate), "yyyy")}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Study */}
          <section className="surface-panel p-5">
            <div className="flex items-center gap-2.5">
              <IconChip icon={Flame} tone="warning" />
              <h2 className="min-w-0 flex-1 truncate font-semibold">Study momentum</h2>
              <Button asChild variant="ghost" size="sm" className="-mr-1.5 shrink-0">
                <Link href="/study">
                  Open
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-bold tabular-nums tracking-tight">
                  {formatMinutes(data.studySessions.todayMinutes)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  today · {data.studySessions.todayCount} session
                  {data.studySessions.todayCount !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tabular-nums">
                  {formatMinutes(data.studySessions.weekMinutes)}
                </p>
                <p className="text-xs text-muted-foreground">last 7 days</p>
              </div>
            </div>
            {data.studySessions.weekMinutes > 0 ? (
              <Progress
                className="mt-3"
                label="Share of the last 7 days studied today"
                value={Math.min(
                  100,
                  Math.round((data.studySessions.todayMinutes / data.studySessions.weekMinutes) * 100),
                )}
                valueText={`${formatMinutes(data.studySessions.todayMinutes)} of ${formatMinutes(data.studySessions.weekMinutes)}`}
              />
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                No study time logged in the last 7 days.
              </p>
            )}
            {data.studySessions.recent.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-border/60 pt-3">
                {data.studySessions.recent.slice(0, 3).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate font-medium">{s.topic ?? "Untagged session"}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatMinutes(s.durationMinutes)} · {relativeTime(s.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Quick actions */}
          <section className="surface-panel p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <IconChip icon={Sparkles} />
              <h2 className="min-w-0 flex-1 truncate font-semibold">Quick actions</h2>
              <Button asChild variant="ghost" size="sm" className="-mr-1.5 shrink-0">
                <Link href="/ai">
                  Ask AI
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
            {/* Every one of these lands somewhere that acts: `?new=1` / `?note=new`
                open the editor on the target page, the rest open the tool itself. */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <QuickAction icon={Plus} label="Add task" href="/tasks?new=1" chip="bg-primary/10 text-primary" />
              <QuickAction icon={BookOpen} label="Add note" href="/notes?note=new" chip="bg-blue-500/10 text-blue-500" />
              <QuickAction icon={Target} label="Add goal" href="/goals?new=1" chip="bg-violet-500/10 text-violet-500" />
              <QuickAction icon={GraduationCap} label="Add course" href="/courses?new=1" chip="bg-amber-500/10 text-amber-600" />
              <QuickAction icon={Timer} label="Start study" href="/study" chip="bg-green-500/10 text-green-600" />
              <QuickAction icon={CalendarClock} label="Calendar" href="/calendar" chip="bg-orange-500/10 text-orange-600" />
            </div>
          </section>

          {/* Goals */}
          <Panel title="Goals" icon={Target} href="/goals" linkLabel="All goals">
            {data.activeGoals.length === 0 ? (
              <EmptyState
                compact
                icon={Target}
                title="No active goals"
                description="Set a goal to track your progress."
              />
            ) : (
              <ul className="space-y-3.5">
                {data.activeGoals.slice(0, 5).map((g) => {
                  const goalOverdue =
                    g.deadline !== null && new Date(g.deadline).getTime() < Date.now();
                  return (
                    <li key={g.id}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">{g.title}</p>
                        <span className="shrink-0 text-xs font-bold tabular-nums">{g.progress}%</span>
                      </div>
                      <Progress
                        className="mt-1.5 h-1.5"
                        label={`${g.title} progress`}
                        value={g.progress}
                        valueText={`${g.progress}%`}
                      />
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {g.milestoneTotal > 0 && (
                          <span>
                            {g.milestoneCompleted}/{g.milestoneTotal} milestones
                          </span>
                        )}
                        {g.deadline && (
                          <span className={goalOverdue ? "font-medium text-danger" : ""}>
                            {goalOverdue ? "Overdue · " : "Due "}
                            {format(new Date(g.deadline), "MMM d")}
                          </span>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* ── Tasks · exams · grades ─────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Tasks" icon={ListTodo} href="/tasks" linkLabel="Open">
          <div
            role="img"
            aria-label={breakdownLabel || "No tasks yet"}
            className="flex h-3 w-full overflow-hidden rounded-badge bg-muted"
          >
            {visibleSegments.map((s) => (
              <div
                key={s.key}
                className={cn("h-full transition-[width]", s.bar)}
                style={{ width: `${(s.value / taskTotal) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {statusSegments.map((s) => (
              <li
                key={s.key}
                className="flex items-center justify-between gap-2 rounded-md border border-primary/25 bg-muted/40 px-2.5 py-1.5 text-xs"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} aria-hidden />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="shrink-0 font-bold tabular-nums">{s.value}</span>
              </li>
            ))}
          </ul>
          {data.tasks.total === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">No tasks yet — add your first one.</p>
          )}
        </Panel>

        <Panel title="Exams" icon={GraduationCap} tone="danger" href="/exams" linkLabel="All exams">
          {data.exams.upcoming.length === 0 ? (
            <EmptyState
              compact
              icon={GraduationCap}
              title="No exams scheduled"
              description="Planned exams will show up here."
            />
          ) : (
            <ul className="space-y-1.5">
              {data.exams.upcoming.slice(0, 5).map((exam) => {
                const start = new Date(exam.startAt);
                const days = daysUntil(exam.startAt);
                const tone: Tone = isToday(start)
                  ? "danger"
                  : days <= 3
                    ? "danger"
                    : days <= 7
                      ? "warning"
                      : "neutral";
                return (
                  <li key={exam.id}>
                    <Link
                      href="/exams"
                      className="flex items-center gap-3 rounded-lg border border-danger/25 px-3 py-2.5 transition-colors hover:border-danger/50 hover:bg-muted/50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{exam.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {exam.course?.code ?? exam.course?.name ?? "No course"}
                          {exam.location ? ` · ${exam.location}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs font-semibold">
                          {format(start, "EEE · MMM d")}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {format(start, "h:mm a")}
                        </span>
                      </span>
                      <Chip tone={tone} className="shrink-0">
                        {isToday(start)
                          ? "Today"
                          : isTomorrow(start)
                            ? "Tomorrow"
                            : `In ${days}d`}
                      </Chip>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Grades" icon={Award} tone="success" href="/analytics" linkLabel="Analytics">
          {data.recentGrades.length === 0 ? (
            <EmptyState
              compact
              icon={Award}
              title="No grade data"
              description="Grade data will appear once synced."
            />
          ) : (
            <ul className="space-y-1.5">
              {data.recentGrades.slice(0, 5).map((g) => {
                const scoreTone =
                  g.score === null
                    ? "bg-muted text-muted-foreground"
                    : g.score >= 90
                      ? "bg-success/10 text-success"
                      : g.score >= 80
                        ? "bg-primary/10 text-primary"
                        : g.score >= 70
                          ? "bg-warning/15 text-warning"
                          : "bg-danger/15 text-danger";
                return (
                  <li
                    key={g.id}
                    className="flex items-center gap-3 rounded-lg border border-success/30 px-2 py-2 transition-colors hover:bg-muted/40"
                  >
                    <CourseSwatch id={g.course?.id ?? "default"} className="h-7 w-7 shrink-0 rounded-md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {g.course?.name ?? g.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {g.title} · {format(new Date(g.recordedAt), "MMM d")}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-badge px-2 py-0.5 text-xs font-bold tabular-nums",
                        scoreTone,
                      )}
                    >
                      {g.score !== null ? g.score.toFixed(1) : "—"}
                      {g.maxScore ? `/${g.maxScore}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Notes · activity · library & AI ────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Recent notes" icon={Book} href="/notes" linkLabel="All notes">
          {data.recentNotes.length === 0 ? (
            <EmptyState
              compact
              icon={BookOpen}
              title="No notes yet"
              description="Create your first note or import a resource."
            />
          ) : (
            <ul className="space-y-1.5">
              {data.recentNotes.slice(0, 5).map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/notes?note=${n.id}`}
        className="flex items-center gap-3 rounded-lg border border-primary/20 px-2 py-2 transition-colors hover:bg-muted/50"
                  >
                    {n.course ? (
                      <CourseSwatch id={n.course.id} className="h-7 w-7 shrink-0 rounded-md" />
                    ) : (
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                        aria-hidden
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{n.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {n.updatedAt ? format(new Date(n.updatedAt), "MMM d · h:mm") : "No updated date"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity" icon={History} tone="neutral">
          {data.activity.length === 0 ? (
            <EmptyState
              compact
              icon={History}
              title="No activity yet"
              description="Your actions will show up here."
            />
          ) : (
            <ul className="space-y-1.5">
              {data.activity.slice(0, 8).map((a) => (
                <ActivityRow key={a.id} item={a} />
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Library" icon={Library} href="/resources" linkLabel="Open" collapsible={false}>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-muted/20 px-3 py-3">
              <div>
                <p className="text-xl font-bold tabular-nums">{data.resources.total}</p>
                <p className="text-xs text-muted-foreground">
                  resource{data.resources.total !== 1 ? "s" : ""} stored
                </p>
              </div>
              <Paperclip className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            {unread > 0 && (
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <Link href="/notifications">
                  <Bell className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {unread} unread notification{unread !== 1 ? "s" : ""}
                </Link>
              </Button>
            )}
          </Panel>

          {/* AI — its own block, never mixed into Analytics. */}
          <section
            className="surface-panel relative flex-1 overflow-hidden p-5"
            style={{
              backgroundImage:
                "linear-gradient(135deg, hsl(var(--primary) / 0.12), transparent 70%)",
            }}
          >
            <div className="relative">
              <div className="flex items-center gap-2.5">
                <IconChip icon={Sparkles} />
                <h2 className="min-w-0 flex-1 truncate font-semibold">AI Study Assistant</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask about a course, what to study next, upcoming deadlines or your tasks — grounded
                in your own StudentOS data.
              </p>
              <Button asChild size="sm" className="mt-4">
                <Link href="/ai">
                  Open assistant
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
