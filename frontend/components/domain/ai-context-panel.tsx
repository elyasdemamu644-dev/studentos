"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  ChevronDown,
  Clock,
  ListTodo,
  PanelRightOpen,
  Sparkles,
  Target,
  Timer,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Drawer } from "@/components/ui/drawer";
import { useDashboard } from "@/features/dashboard/hooks";
import { formatMinutes } from "@/lib/format";
import { CourseSwatch } from "@/components/domain/course-swatch";
import { ListSkeleton } from "@/components/feedback";

/**
 * The StudentOS Context panel — a compact, real-time view of the student's
 * academic state, shown alongside the AI chat so the assistant's answers
 * can be grounded in what the student actually has.
 *
 * Every section reads from the real dashboard API. No invented data.
 */

function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: typeof BookOpen;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

function CompactCourse({ course }: { course: { id: string; code: string | null; name: string; taskProgress: number | null; gradeAverage: number | null; taskCompleted: number; taskTotal: number } }) {
  return (
    <li>
      <Link
        href={`/courses/${course.id}`}
        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
      >
        <CourseSwatch id={course.id} className="h-6 w-6 shrink-0 rounded" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{course.name}</span>
          <span className="block text-[10px] text-muted-foreground">
            {course.code ?? "—"} · {course.taskCompleted}/{course.taskTotal} tasks
            {course.gradeAverage !== null && ` · avg ${course.gradeAverage}%`}
          </span>
        </span>
        {course.taskProgress !== null && (
          <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
            {course.taskProgress}%
          </span>
        )}
      </Link>
    </li>
  );
}

function CompactTask({ task }: { task: { id: string; title: string; dueDate: string | null; priority: string; status: string; course: { code: string | null; name: string } | null } }) {
  const overdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== "COMPLETED";
  const dueSoon = task.dueDate && !overdue && new Date(task.dueDate).getTime() - Date.now() < 24 * 60 * 60 * 1000;

  return (
    <li>
      <Link
        href="/tasks"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            overdue ? "bg-danger" : dueSoon ? "bg-warning" : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs">{task.title}</span>
        {task.course && (
          <span className="shrink-0 text-[10px] text-muted-foreground">{task.course.code ?? task.course.name}</span>
        )}
      </Link>
    </li>
  );
}

function CompactExam({ exam }: { exam: { id: string; title: string; startAt: string; course: { code: string | null; name: string } | null } }) {
  const days = Math.ceil((new Date(exam.startAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const tone = days <= 1 ? "danger" : days <= 3 ? "warning" : "muted";

  return (
    <li>
      <Link
        href="/exams"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs">{exam.title}</span>
        <span
          className={cn(
            "shrink-0 text-[10px] font-medium",
            tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-muted-foreground",
          )}
        >
          {days <= 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d`}
        </span>
      </Link>
    </li>
  );
}

function CompactGoal({ goal }: { goal: { id: string; title: string; progress: number; milestoneCompleted: number; milestoneTotal: number } }) {
  return (
    <li>
      <Link
        href="/goals"
        className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{goal.title}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{goal.progress}%</span>
        </span>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary transition-all"
            style={{ width: `${goal.progress}%` }}
          />
        </span>
        <span className="mt-0.5 block text-[10px] text-muted-foreground">
          {goal.milestoneCompleted}/{goal.milestoneTotal} milestones
        </span>
      </Link>
    </li>
  );
}

/**
 * The panel body: the student's academic state, section by section.
 *
 * Every section reads from the real dashboard API. No invented data.
 *
 * The header is not here. In the workspace it is the `WorkspacePanel` that
 * wraps this, which is also where the single collapse control lives; the drawer
 * below supplies its own. The body is deliberately headerless so the two
 * placements cannot end up with two headers — or two collapse buttons.
 *
 * Collapse state is likewise not here: the workspace owns it, and a panel that
 * keeps its own copy is a panel with two sources of truth. The query runs on
 * mount regardless, so hiding the panel keeps its data warm and revealing it
 * again is instant.
 */
export function AiContextPanel() {
  const dashboard = useDashboard();

  const data = dashboard.data;

  const overdueCount = data?.tasks.overdue ?? 0;
  const unreadCount = data?.notifications.unreadCount ?? 0;

  return (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden"
      aria-label="StudentOS context"
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        tabIndex={0}
        role="region"
        aria-label="StudentOS context details"
      >
        {dashboard.isPending ? (
          <div className="space-y-2 p-3">
            <ListSkeleton rows={3} />
          </div>
        ) : dashboard.isError ? (
          <div className="p-3">
            <p className="text-xs text-muted-foreground">Unable to load context.</p>
          </div>
        ) : data ? (
          <>
            {/* Courses */}
            <Section title="Courses" icon={BookOpen}>
              {data.courses.recent.length === 0 ? (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">No courses yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {data.courses.recent.slice(0, 5).map((course) => (
                    <CompactCourse key={course.id} course={course} />
                  ))}
                </ul>
              )}
            </Section>

            {/* Tasks */}
            <Section title="Tasks" icon={ListTodo}>
              {data.upcomingTasks.length === 0 && data.overdueTasks.length === 0 ? (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">No tasks yet.</p>
              ) : (
                <ul className="space-y-0.5">
                  {data.overdueTasks.slice(0, 3).map((task) => (
                    <CompactTask key={`overdue-${task.id}`} task={task} />
                  ))}
                  {data.upcomingTasks.slice(0, 5).map((task) => (
                    <CompactTask key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </Section>

            {/* Exams */}
            <Section title="Exams" icon={CalendarClock}>
              {data.exams.upcoming.length === 0 ? (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">No exams scheduled.</p>
              ) : (
                <ul className="space-y-0.5">
                  {data.exams.upcoming.slice(0, 4).map((exam) => (
                    <CompactExam key={exam.id} exam={exam} />
                  ))}
                </ul>
              )}
            </Section>

            {/* Goals */}
            <Section title="Goals" icon={Target}>
              {data.activeGoals.length === 0 ? (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">No active goals.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.activeGoals.slice(0, 3).map((goal) => (
                    <CompactGoal key={goal.id} goal={goal} />
                  ))}
                </ul>
              )}
            </Section>

            {/* Study progress */}
            <Section title="Study" icon={Timer}>
              <div className="space-y-1.5 px-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Today</span>
                  <span className="font-medium">{formatMinutes(data.studySessions.todayMinutes)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">This week</span>
                  <span className="font-medium">{formatMinutes(data.studySessions.weekMinutes)}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Sessions today</span>
                  <span className="font-medium">{data.studySessions.todayCount}</span>
                </div>
              </div>
            </Section>

            {/* What asking well gets you */}
            <Section title="Try asking" icon={Sparkles} defaultOpen={false}>
              <ul className="space-y-1.5 px-2 text-[11px] text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Read:</span> “What’s due this week?”,
                  “How am I doing in PSYC300?”
                </li>
                <li>
                  <span className="font-medium text-foreground">Analyse:</span> “When should I start
                  revising for the Database exam?”
                </li>
                <li>
                  <span className="font-medium text-foreground">Change:</span> “Add a task to read
                  chapter 4 by Friday” — you approve it first.
                </li>
                <li>
                  <span className="font-medium text-foreground">Plan:</span> “Draft a study plan for
                  next week.”
                </li>
              </ul>
              <p className="mt-2.5 border-t border-border/60 px-2 pt-2 text-[10px] text-muted-foreground/80">
                Every change is shown as a proposal and applied only after you confirm it.
              </p>
            </Section>

            {/* Alerts */}
            {(overdueCount > 0 || unreadCount > 0) && (
              <Section title="Alerts" icon={AlertTriangle}>
                <div className="space-y-1 px-2">
                  {overdueCount > 0 && (
                    <Link
                      href="/tasks"
                      className="flex items-center gap-2 rounded-lg bg-danger/5 px-2 py-1.5 text-[11px] text-danger transition-colors hover:bg-danger/10"
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="font-medium">{overdueCount} overdue task{overdueCount !== 1 ? "s" : ""}</span>
                    </Link>
                  )}
                  {unreadCount > 0 && (
                    <Link
                      href="/notifications"
                      className="flex items-center gap-2 rounded-lg bg-warning/5 px-2 py-1.5 text-[11px] text-warning transition-colors hover:bg-warning/10"
                    >
                      <Clock className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="font-medium">{unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}</span>
                    </Link>
                  )}
                </div>
              </Section>
            )}
          </>
        ) : null}
      </div>
    </aside>
  );
}

/**
 * Drawer version of the context panel, for the widths where the workspace has
 * no room for a third column. The trigger disappears exactly when the column
 * appears, so the two are never both offering the same panel — and the drawer
 * carries its own heading, because the column's heading belongs to its
 * `WorkspacePanel` and there is no control here to collapse.
 */
export function AiContextDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open StudentOS context"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-ai px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-card transition-colors hover:text-foreground min-[1360px]:hidden"
      >
        <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
        Context
      </button>

      <Drawer
        open={open}
        onOpenChange={setOpen}
        side="right"
        title="StudentOS Context"
        description="What the assistant can read"
      >
        <AiContextPanel />
      </Drawer>
    </>
  );
}
