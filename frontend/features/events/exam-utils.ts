import { differenceInCalendarDays, parseISO } from "date-fns";
import type { CalEvent } from "@/types/api-types";

export type CountdownTone = "danger" | "warning" | "muted";

export interface Countdown {
  label: string;
  tone: CountdownTone;
}

/**
 * Exams are events with `type = "EXAM"`. The countdown is what makes the page
 * useful, so it is extracted for testing rather than inlined in the component.
 */
export function countdownLabel(startAt: string, now: Date = new Date()): Countdown {
  const days = differenceInCalendarDays(parseISO(startAt), now);
  if (days < 0) return { label: "Past", tone: "muted" };
  if (days === 0) return { label: "Today", tone: "danger" };
  if (days === 1) return { label: "Tomorrow", tone: "danger" };
  if (days <= 7) return { label: `In ${days} days`, tone: "warning" };
  return { label: `In ${days} days`, tone: "muted" };
}

/**
 * An exam is finished once its end (or start, when open-ended) is past.
 * Compared explicitly rather than via date-fns `isPast`, which always reads the
 * real clock and would ignore the injected reference date.
 */
export function isExamOver(event: CalEvent, now: Date = new Date()): boolean {
  return parseISO(event.endAt ?? event.startAt).getTime() < now.getTime();
}

export interface PartitionedExams {
  upcoming: CalEvent[];
  past: CalEvent[];
}

/**
 * Upcoming exams stay in chronological order; past exams are most-recent-first
 * so the newest finished exam is still visible after a long gap.
 */
export function partitionExams(exams: CalEvent[], now: Date = new Date()): PartitionedExams {
  const sorted = [...exams].sort((a, b) => a.startAt.localeCompare(b.startAt));
  return {
    upcoming: sorted.filter((exam) => !isExamOver(exam, now)),
    past: sorted.filter((exam) => isExamOver(exam, now)).reverse(),
  };
}

/** Distinct courses that have at least one upcoming exam. */
export function countCoursesWithExams(exams: CalEvent[]): number {
  return new Set(exams.map((e) => e.courseId).filter((id): id is string => Boolean(id))).size;
}
