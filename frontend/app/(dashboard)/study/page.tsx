"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInSeconds, format } from "date-fns";
import { Flame, Play, Square, Timer, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Chip } from "@/components/panel";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { StatCard } from "@/components/domain/stat-card";
import { SectionCard } from "@/components/ui/surface";
import { Button, LoadingButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { useAcademicBreadcrumb } from "@/features/academics/use-academic-breadcrumb";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCourses } from "@/features/courses/hooks";
import { useCourseContext } from "@/features/academics/academic-context";
import {
  useCompleteSession,
  useDeleteSession,
  useSessions,
  useStartSession,
} from "@/features/study/hooks";
import type { StudySession } from "@/types/api-types";
import { formatMinutes, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRESETS = [25, 45, 60] as const;

/** `25:00`, `1:05:00` for anything an hour or longer. */
function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Rounds *before* splitting. `formatMinutes` composed from a raw
 * `minutes % 60`, which rendered durations like "1 hr 35.5 min".
 */
function formatDuration(totalSeconds: number): string {
  return formatMinutes(Math.round(totalSeconds / 60));
}

export default function StudyPage() {
  const courses = useCourses();
  const courseContext = useCourseContext();
  const todaySessions = useSessions({ range: "today", limit: 100 });
  const startSession = useStartSession();
  const completeSession = useCompleteSession();
  const deleteSession = useDeleteSession();

  const [courseId, setCourseId] = useState(courseContext ?? "");
  const [topic, setTopic] = useState("");
  const [minutes, setMinutes] = useState<number>(25);
  const [active, setActive] = useState<StudySession | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [completeOpen, setCompleteOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StudySession | null>(null);
  const [focusRating, setFocusRating] = useState<number>(3);
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const elapsedSeconds = useMemo(() => {
    if (!active) return 0;
    return Math.max(0, differenceInSeconds(new Date(now), new Date(active.startedAt)));
  }, [active, now]);

  const remainingSeconds = useMemo(() => {
    if (!endTime) return 0;
    return Math.max(0, Math.round((endTime - now) / 1000));
  }, [endTime, now]);

  // Opens the log dialog the moment the timer hits zero.
  useEffect(() => {
    if (!active || !endTime || remainingSeconds > 0) return;
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setCompleteOpen(true);
  }, [active, endTime, remainingSeconds]);

  // Announced to screen readers rather than shown, because a live clock that
  // ticks every second would otherwise flood the reader with updates.
  const [clockAnnouncement, setClockAnnouncement] = useState("");
  useEffect(() => {
    if (!active || !endTime) return;
    const marks: Record<number, string> = {
      300: "5 minutes remaining",
      60: "1 minute remaining",
      30: "30 seconds remaining",
      10: "10 seconds remaining",
    };
    if (marks[remainingSeconds]) setClockAnnouncement(marks[remainingSeconds]);
  }, [active, endTime, remainingSeconds]);

  const onStart = () => {
    autoOpenedRef.current = false;
    void startSession
      .mutateAsync({
        courseId: courseId || null,
        topic: topic.trim() || null,
        startedAt: new Date().toISOString(),
      })
      .then((session) => {
        setActive(session);
        setEndTime(Date.now() + minutes * 60 * 1000);
      });
  };

  const onComplete = () => {
    if (!active) return;
    // Round first, so a 25:40 session logs as 26 rather than being floored to 25.
    const actual = Math.max(1, Math.round(elapsedSeconds / 60));
    void completeSession.mutateAsync(
      { id: active.id, input: { endedAt: new Date().toISOString(), durationMinutes: actual, focusRating } },
      { onSuccess: () => setActive(null) },
    );
    setCompleteOpen(false);
    autoOpenedRef.current = false;
  };

  const onDiscard = () => {
    if (active) void deleteSession.mutateAsync(active.id);
    setActive(null);
    setEndTime(null);
    setDiscardOpen(false);
    autoOpenedRef.current = false;
  };

  const onDeleteLogged = () => {
    if (!deleteTarget) return;
    void deleteSession.mutateAsync(deleteTarget.id, { onSettled: () => setDeleteTarget(null) });
  };

  const summary = todaySessions.data?.summary;
  const sessionItems = todaySessions.data?.items ?? [];
  const counted = summary && summary.count > 0 ? summary.totalMinutes / summary.count : 0;
  // A failed fetch used to render as literal zeros ("Studied today: 0m"),
  // which is a claim, not a gap. Show the gap instead.
  const statsDown = todaySessions.isError;
  const breadcrumbItems = useAcademicBreadcrumb(courseId, "Study");

  return (
    <div>
      <Breadcrumb items={breadcrumbItems} />
      <PageHeader
        kicker="Focus"
        title="Study"
        description="Run a focused study session and log your progress."
        chips={
          todaySessions.data ? (
            <>
              <Chip tone="primary" icon={Flame}>
                {formatMinutes(summary?.totalMinutes)} studied today
              </Chip>
              <Chip tone="neutral" icon={Timer}>
                {summary?.count ?? 0} session{(summary?.count ?? 0) !== 1 ? "s" : ""}
              </Chip>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Flame}
          label="Studied today"
          value={statsDown ? "Unavailable" : formatMinutes(summary?.totalMinutes)}
          tone="primary"
        />
        <StatCard
          icon={Timer}
          label="Sessions today"
          value={statsDown ? "Unavailable" : summary?.count ?? 0}
          hint={statsDown ? "Couldn't load today's sessions" : summary?.count ? "Logged" : "None yet"}
        />
        <StatCard
          icon={Flame}
          label="Avg. session"
          value={statsDown ? "Unavailable" : summary && summary.count > 0 ? formatMinutes(Math.round(counted)) : "—"}
          tone="success"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section
          className={cn(
            "surface-panel p-6 transition-colors",
            active && "border-primary/40",
          )}
          style={
            active
              ? {
                  backgroundImage:
                    "linear-gradient(140deg, hsl(var(--primary) / 0.12), transparent 65%)",
                }
              : undefined
          }
        >
          <h2 className="sr-only">{active ? "Active focus session" : "Start a focus session"}</h2>
          {active ? (
            <div className="text-center">
              <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Focus session
              </p>
              <p className="mt-1 truncate font-semibold">{active.topic ?? active.course?.name ?? "Focused study"}</p>
              <p
                role="timer"
                aria-label={endTime ? "Time remaining" : "Time elapsed"}
                aria-live="off"
                className="mt-6 font-mono text-6xl font-bold tabular-nums tracking-tight"
              >
                {endTime ? formatClock(remainingSeconds) : formatClock(elapsedSeconds)}
              </p>
              <span role="status" aria-live="polite" className="sr-only">
                {clockAnnouncement}
              </span>
              <p className="mt-2 text-sm text-muted-foreground">
                {endTime ? "remaining" : "elapsed"} · started {format(new Date(active.startedAt), "h:mm a")}
              </p>
              {endTime && (
                <Progress
                  className="mt-6"
                  label="Session progress"
                  value={(elapsedSeconds / (minutes * 60)) * 100}
                  valueText={`${formatDuration(elapsedSeconds)} of ${formatDuration(minutes * 60)}`}
                />
              )}
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button size="lg" onClick={() => setCompleteOpen(true)}>
                  <Square className="mr-1.5 h-4 w-4" aria-hidden /> Finish & log
                </Button>
                <Button variant="ghost" onClick={() => setDiscardOpen(true)}>
                  Cancel session
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Start a session
              </p>
              <div className="space-y-2">
                <Label htmlFor="study-course">
                  Course <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger id="study-course">
                    <SelectValue placeholder="General study" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__general">General study</SelectItem>
                    {(courses.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="study-topic">Topic</Label>
                <Input
                  id="study-topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Chapter 5 review"
                />
              </div>
              <div className="space-y-2">
                <Label id="study-duration-label">Duration</Label>
                <SegmentedControl
                  label="Duration"
                  value={String(minutes)}
                  onChange={(value) => setMinutes(Number(value))}
                  options={PRESETS.map((preset) => ({
                    value: String(preset),
                    label: `${preset} min`,
                  }))}
                />
              </div>
              <Button
                className="w-full"
                size="lg"
                disabled={startSession.isPending}
                onClick={onStart}
              >
                <Play className="mr-1.5 h-4 w-4" aria-hidden /> Start focus
              </Button>
            </div>
          )}
        </section>

        <SectionCard
          title="Today's sessions"
          icon={Timer}
          className="p-5"
          headerExtra={
            <span className="shrink-0 text-xs text-muted-foreground">
              {summary?.count ?? 0} session{summary?.count !== 1 ? "s" : ""}
            </span>
          }
        >
          {todaySessions.isPending ? (
            <ListSkeleton rows={4} label="Loading today’s study sessions" />
          ) : todaySessions.isError ? (
            <ErrorState error={todaySessions.error} retry={() => todaySessions.refetch()} />
          ) : sessionItems.length === 0 ? (
            <EmptyState
              icon={Timer}
              title="No sessions yet today"
              description="The timer on the left is ready when you are."
              compact
            />
          ) : (
            <ul className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
              {sessionItems.map((session) => (
                <li key={session.id} className="flex items-center gap-3 rounded-lg border border-primary/30 bg-muted/50 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {session.topic ?? session.course?.name ?? "Focused study"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {relativeTime(session.startedAt)}
                      {session.focusRating ? ` · focus ${session.focusRating}/5` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                    {session.durationMinutes != null ? formatMinutes(session.durationMinutes) : "—"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => setDeleteTarget(session)}
                    aria-label={`Delete session: ${session.topic ?? session.course?.name ?? "focused study"}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <Dialog
        open={completeOpen}
        onOpenChange={(o) => {
          setCompleteOpen(o);
          autoOpenedRef.current = false;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finish session</DialogTitle>
            <DialogDescription>
              You focused for {formatDuration(elapsedSeconds)}. How did it go?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label id="focus-rating-label">Focus level</Label>
            <div className="flex items-center gap-2" role="radiogroup" aria-labelledby="focus-rating-label">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  role="radio"
                  aria-checked={focusRating === rating}
                  aria-label={`${rating} of 5`}
                  onClick={() => setFocusRating(rating)}
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    focusRating === rating
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-primary/50",
                  )}
                >
                  {rating}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setCompleteOpen(false);
                autoOpenedRef.current = false;
              }}
            >
              Keep studying
            </Button>
            <LoadingButton loading={completeSession.isPending} onClick={onComplete}>
              Log session
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Cancel session"
        description="This discards the current session without logging any study time."
        confirmLabel="Discard session"
        busy={deleteSession.isPending}
        onConfirm={onDiscard}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete this session?"
        description={
          <>
            This removes{" "}
            <span className="font-medium text-foreground">
              {deleteTarget?.topic ?? deleteTarget?.course?.name ?? "this focus session"}
            </span>{" "}
            from today&rsquo;s log. The time will no longer count toward your totals.
          </>
        }
        busy={deleteSession.isPending}
        onConfirm={onDeleteLogged}
      />
    </div>
  );
}