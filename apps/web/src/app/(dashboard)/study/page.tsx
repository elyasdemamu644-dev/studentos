"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInSeconds, format } from "date-fns";
import { Flame, Play, Square, Timer, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { StatCard } from "@/components/domain/stat-card";
import { Button, LoadingButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DialogShell } from "@/features/tasks/task-form";
import { useCourses } from "@/features/courses/hooks";
import {
  useCompleteSession,
  useDeleteSession,
  useSessions,
  useStartSession,
} from "@/features/study/hooks";
import type { StudySession } from "@/features/api-types";
import { formatMinutes, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "25 min", value: 25 },
  { label: "45 min", value: 45 },
  { label: "60 min", value: 60 },
];

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function StudyPage() {
  const courses = useCourses();
  const todaySessions = useSessions({ range: "today", limit: 100 });
  const startSession = useStartSession();
  const completeSession = useCompleteSession();
  const deleteSession = useDeleteSession();

  const [courseId, setCourseId] = useState("");
  const [topic, setTopic] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [active, setActive] = useState<StudySession | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [completeOpen, setCompleteOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
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

  useEffect(() => {
    if (!active || !endTime || remainingSeconds > 0) return;
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setCompleteOpen(true);
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
    const actual = Math.max(1, Math.round(elapsedSeconds / 60));
    void completeSession.mutateAsync(
      { id: active.id, input: { endedAt: new Date().toISOString(), durationMinutes: actual, focusRating } },
      { onSuccess: () => setActive(null) },
    );
    setCompleteOpen(false);
    autoOpenedRef.current = false;
  };

  const onCancel = () => {
    if (active) void deleteSession.mutateAsync(active.id);
    setActive(null);
    setEndTime(null);
    autoOpenedRef.current = false;
  };

  const summary = todaySessions.data?.summary;
  const sessionItems = todaySessions.data?.items ?? [];

  return (
    <div>
      <PageHeader
        kicker="Focus"
        title="Study"
        description="Run a focused study session and log your progress."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Flame}
          label="Studied today"
          value={formatMinutes(summary?.totalMinutes)}
          tone="primary"
        />
        <StatCard
          icon={Timer}
          label="Sessions today"
          value={summary?.count ?? 0}
        />
        <StatCard
          icon={Flame}
          label="Avg. session"
          value={
            summary && summary.count > 0
              ? formatMinutes(Math.round(summary.totalMinutes / summary.count))
              : "—"
          }
          tone="success"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-6 shadow-card">
          {active ? (
            <div className="text-center">
              <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Focus session
              </p>
              <p className="mt-1 truncate font-semibold">{active.topic ?? active.course?.name ?? "Focused study"}</p>
              <p className="mt-6 font-mono text-6xl font-bold tabular-nums tracking-tight">
                {endTime ? formatClock(remainingSeconds) : formatClock(elapsedSeconds)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {endTime ? "remaining" : "elapsed"} · started {format(new Date(active.startedAt), "h:mm a")}
              </p>
              {endTime && (
                <Progress className="mt-6" value={(elapsedSeconds / (minutes * 60)) * 100} />
              )}
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button size="lg" onClick={() => setCompleteOpen(true)}>
                  <Square className="mr-1.5 h-4 w-4" aria-hidden /> Finish & log
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDeleteOpen(true)}>
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
                <Label htmlFor="study-course">Course <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger id="study-course">
                    <SelectValue placeholder="General study" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">General study</SelectItem>
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
                <Label>Duration</Label>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setMinutes(p.value)}
                      aria-pressed={minutes === p.value}
                      className={cn(
                        "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                        minutes === p.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:border-primary/50",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
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

        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Timer className="h-4 w-4 text-primary" aria-hidden /> Today&apos;s sessions
            </h2>
            <span className="text-xs text-muted-foreground">
              {summary?.count ?? 0} session{summary?.count !== 1 ? "s" : ""}
            </span>
          </div>
          {todaySessions.isPending ? (
            <ListSkeleton rows={4} />
          ) : todaySessions.isError ? (
            <ErrorState error={todaySessions.error} retry={() => todaySessions.refetch()} />
          ) : sessionItems.length === 0 ? (
            <EmptyState
              icon={Timer}
              title="No sessions yet today"
              description="The timer on the left is ready when you are."
              className="py-8"
            />
          ) : (
            <ul className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
              {sessionItems.map((session) => (
                <li key={session.id} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
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
                    onClick={() => deleteSession.mutateAsync(session.id)}
                    aria-label="Delete session"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={completeOpen} onOpenChange={(o) => { setCompleteOpen(o); autoOpenedRef.current = false; }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finish session</DialogTitle>
            <DialogDescription>
              You focused for {formatMinutes(Math.round(elapsedSeconds / 60))}. How did it go?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Focus level</Label>
            <div className="flex items-center gap-2" role="radiogroup" aria-label="Focus rating">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  role="radio"
                  aria-checked={focusRating === rating}
                  onClick={() => setFocusRating(rating)}
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-lg border text-sm font-semibold transition-colors",
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
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => { setCompleteOpen(false); autoOpenedRef.current = false; }}>
              Keep studying
            </Button>
            <LoadingButton loading={completeSession.isPending} onClick={onComplete}>
              Log session
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>

      <DialogShell
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Cancel session"
        description="This discards the current session without logging any study time."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDeleteOpen(false)}>Keep going</Button>
          <LoadingButton variant="destructive" loading={deleteSession.isPending} onClick={onCancel}>
            <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Discard session
          </LoadingButton>
        </div>
      </DialogShell>
    </div>
  );
}