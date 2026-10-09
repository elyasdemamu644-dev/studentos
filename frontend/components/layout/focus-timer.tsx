"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Play, Timer, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { cn, clamp } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompleteSession, useDeleteSession, useStartSession } from "@/features/study/hooks";

const FOCUS_KEY = "studentos.focus.active";
const PRESETS = [15, 25, 45, 60] as const;

interface ActiveFocus {
  sessionId: string;
  startedAt: string;
  endTime: number;
  minutes: number;
}

function readActive(): ActiveFocus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FOCUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveFocus;
    if (
      typeof parsed?.sessionId !== "string" ||
      typeof parsed?.endTime !== "number" ||
      typeof parsed?.startedAt !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeActive(active: ActiveFocus | null): void {
  if (typeof window === "undefined") return;
  try {
    if (active) window.localStorage.setItem(FOCUS_KEY, JSON.stringify(active));
    else window.localStorage.removeItem(FOCUS_KEY);
  } catch {
    // best effort
  }
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * A focus timer that lives in the shell so a session survives navigation
 * between pages. It reuses the study-session API: starting opens a session,
 * finishing closes it with the elapsed minutes, and discarding deletes it. The
 * running session is mirrored to localStorage so a refresh does not lose it.
 */
export function FocusTimer({ compact = false }: { compact?: boolean }) {
  const [active, setActive] = useState<ActiveFocus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const completing = useRef(false);

  const start = useStartSession();
  const complete = useCompleteSession();
  const discard = useDeleteSession();

  useEffect(() => {
    setActive(readActive());
  }, []);

  const finish = useCallback(
    (auto: boolean) => {
      const current = readActive();
      if (!current) return;
      const elapsed = clamp(
        Math.round((Date.now() - Date.parse(current.startedAt)) / 60_000),
        1,
        24 * 60,
      );
      complete.mutate(
        {
          id: current.sessionId,
          input: { endedAt: new Date().toISOString(), durationMinutes: elapsed },
        },
        {
          onSuccess: () => {
            writeActive(null);
            setActive(null);
            toast.success(
              auto
                ? `Focus session complete — ${elapsed}m logged`
                : `${elapsed}m focus logged`,
            );
          },
        },
      );
    },
    [complete],
  );

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  // Auto-complete the moment the countdown reaches zero.
  useEffect(() => {
    if (!active || completing.current) return;
    if (now >= active.endTime) {
      completing.current = true;
      finish(true);
      window.setTimeout(() => {
        completing.current = false;
      }, 0);
    }
  }, [active, now, finish]);

  const startSession = (minutes: number) => {
    const startedAt = new Date().toISOString();
    start.mutate(
      { startedAt, topic: "Focus session" },
      {
        onSuccess: (session) => {
          const next: ActiveFocus = {
            sessionId: session.id,
            startedAt,
            endTime: Date.now() + minutes * 60_000,
            minutes,
          };
          writeActive(next);
          setActive(next);
          setNow(Date.now());
        },
      },
    );
  };

  const discardSession = () => {
    const current = readActive();
    if (!current) {
      writeActive(null);
      setActive(null);
      return;
    }
    discard.mutate(current.sessionId, {
      onSuccess: () => {
        writeActive(null);
        setActive(null);
        toast("Focus session discarded");
      },
    });
  };

  if (!active) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={compact ? "icon" : "sm"}
            className={cn("gap-2 text-muted-foreground", !compact && "border border-dashed")}
            aria-label="Start a focus session"
            title="Start a focus session"
          >
            <Timer className="h-4 w-4" aria-hidden />
            {!compact && <span>Focus</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Start focus session</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PRESETS.map((minutes) => (
            <DropdownMenuItem key={minutes} onSelect={() => startSession(minutes)}>
              <Play className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span>{minutes} minutes</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const remaining = active.endTime - now;
  const progress = clamp(1 - remaining / (active.minutes * 60_000), 0, 1);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="relative gap-2 overflow-hidden tabular-nums"
          aria-label={`Focus session, ${formatClock(remaining)} remaining`}
          title="Focus session running"
        >
          <span
            className="absolute inset-x-0 bottom-0 h-0.5 bg-primary transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress * 100}%` }}
            aria-hidden
          />
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span>{formatClock(remaining)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Focus session</span>
          <span className="text-xs font-normal text-muted-foreground">{active.minutes}m goal</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => finish(false)}>
          <Check className="h-4 w-4 text-muted-foreground" aria-hidden />
          Finish and log now
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={discardSession}>
          <Trash2 className="h-4 w-4" aria-hidden />
          Discard session
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
