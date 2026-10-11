"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Bell,
  Book,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
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

import { CourseSwatch } from "@/components/domain/course-swatch";
import { PriorityBadge } from "@/components/domain/priority-badge";
import { EmptyState } from "@/components/feedback";
import { ErrorState } from "@/components/states";
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
  DashboardData,
  DashboardEvent,
  DashboardTask,
} from "@/types/api-types";
import { dueLabel, formatMinutes, relativeTime } from "@/lib/format";
import { TASK_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** Academic context selector - shows current semester and allows switching */
function AcademicContextSelector({ 
  currentSemester, 
  currentAcademicYear
}: { 
  currentSemester: DashboardData["currentSemester"]; 
  currentAcademicYear: DashboardData["currentAcademicYear"];
}) {
  if (!currentSemester || !currentAcademicYear) return null;
  
  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-muted/50 border border-border">
      <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{currentSemester.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {currentAcademicYear.name} · {format(new Date(currentSemester.startDate), "MMM d")} – {format(new Date(currentSemester.endDate), "MMM d, yyyy")}
        </p>
      </div>
      <Button variant="ghost" size="sm" asChild>
        <Link href="/academics" className="flex items-center gap-1">
          <span className="text-xs font-medium">Manage</span>
          <ChevronDown className="h-3 w-3" aria-hidden />
        </Link>
      </Button>
    </div>
  );
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
            <svg
              viewBox="0 0 88 88"
              className="h-24 w-24 -rotate-90 text-muted-foreground"
              role="img"
              aria-label="Loading"
            >
              <circle
                cx="44"
                cy="44"
                r="36"
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                d="M33.94 37.9 a 12.16 12.16 0 0 1 0 24.23"
              />
            </svg>
            <p className="mt-4 text-center text-muted-foreground">Loading dashboard</p>
          </div>
        </div>
      </div>
    );
  }

  if (dashboard.isError) {
    return (
      <ErrorState
        error={dashboard.error}
        retry={() => void dashboard.refetch()}
      />
    );
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
      {/* ── Header: Greeting + Academic Context ───────────────────── */}
      <header className="surface-panel animate-fade-in">
        <div className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              {format(new Date(), "EEEE, MMMM d")}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              {greeting()}, {firstName}
            </h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <AcademicContextSelector 
              currentSemester={data.currentSemester} 
              currentAcademicYear={data.currentAcademicYear}
            />
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
        
        {/* Alert chips row */}
        <div className="border-t border-border/60 px-6 py-3">
          <div className="flex flex-wrap gap-2">
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
      </header>

      {/* ── Semester Progress Bar (compact) ──────────────────────── */}
      {termValid && termStart && termEnd && term && (
        <section className="surface-panel animate-fade-in" style={{ animationDelay: "40ms" }}>
          <div className="px-6 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{term.name}</p>
                <p className="text-xs text-muted-foreground">
                  {format(termStart, "MMM d")} – {format(termEnd, "MMM d, yyyy")}
                  {term.academicYear && (
                    <> · AY {format(new Date(term.academicYear.startDate), "yyyy")}–{format(new Date(term.academicYear.endDate), "yyyy")}</>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-4 w-full sm:w-auto">
                <Progress
                  className="flex-1 h-1.5 max-w-xs"
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
                <span className="text-sm font-medium tabular-nums text-muted-foreground shrink-0">
                  {termStarted ? `${termPct}%` : "Not started"}
                </span>
                {termStarted && termDaysLeft > 0 && (
                  <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    {termDaysLeft === 1 ? "1 day left" : `${termDaysLeft} days left`}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

{/* ── Primary workspace: today's work ────────────────────────── */}
      <section className="lg:col-span-2 space-y-4">
        <Panel
          title="Overdue"
          icon={AlertTriangle}
          tone="danger"
          href="/tasks"
          linkLabel="All tasks"
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

        <Panel
          title="What's next"
          icon={Clock}
          tone="warning"
          href="/tasks"
          linkLabel="All tasks"
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

        <Panel title="Schedule" icon={CalendarClock} href="/calendar" linkLabel="Calendar">
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
      </section>

      {/* ── Semester overview ───────────────────────────────────────── */}
      <section className="space-y-4">
        {/* Term progress */}
        {termValid && termStart && termEnd && term && (
          <div className="surface-panel p-5">
            <div className="flex items-center gap-2.5">
              <IconChip icon={CalendarClock} />
              <h2 className="min-w-0 flex-1 truncate font-semibold">Term progress</h2>
              <span className="shrink-0 text-xs text-muted-foreground">Current term</span>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <Progress
                className="flex-1 h-1.5 max-w-xs"
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
              <span className="text-sm font-medium tabular-nums text-muted-foreground shrink-0">
                {termStarted ? `${termPct}%` : "Not started"}
              </span>
              {termStarted && termDaysLeft > 0 && (
                <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                  {termDaysLeft === 1 ? "1 day left" : `${termDaysLeft} days left`}
                </span>
              )}
            </div>
            {term.academicYear && (
              <p className="mt-2 text-xs text-muted-foreground">
                AY {format(new Date(term.academicYear.startDate), "yyyy")}–
                {format(new Date(term.academicYear.endDate), "yyyy")}
              </p>
            )}
          </div>
        )}

        {/* Study */}
        <div className="surface-panel p-5">
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
        </div>
      </section>

      {/* ── Supporting information and quick access ───────────────────── */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Tasks overview */}
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

        {/* Exams */}
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

        {/* Grades */}
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

        {/* Recent activity */}
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

        {/* Library & quick actions */}
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
      </section>
    </div>
  );
}
