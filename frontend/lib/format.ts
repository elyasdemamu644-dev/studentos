import { format, formatDistanceToNowStrict, isToday, isTomorrow, parseISO } from "date-fns";

export function formatDate(value: string | null | undefined, pattern = "MMM d, yyyy"): string {
  if (!value) return "—";
  const date = typeof value === "string" ? parseISO(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, pattern);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "h:mm a");
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "MMM d, yyyy · h:mm a");
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    const label = formatDistanceToNowStrict(date, { addSuffix: true });
    return label === "0 seconds ago" ? "just now" : label;
  } catch {
    return "—";
  }
}

export interface DueLabel {
  label: string;
  tone: "ok" | "soon" | "overdue" | "done";
}

export function dueLabel(dueDate: string | null | undefined, status?: string): DueLabel {
  if (!dueDate) return { label: "No due date", tone: "ok" };
  if (status === "COMPLETED") return { label: "Completed", tone: "done" };
  const date = parseISO(dueDate);
  if (Number.isNaN(date.getTime())) return { label: "Invalid date", tone: "ok" };
  if (isToday(date)) return { label: "Due today", tone: "soon" };
  if (isTomorrow(date)) return { label: "Due tomorrow", tone: "soon" };
  if (date.getTime() < Date.now()) return { label: `Overdue · ${format(date, "MMM d")}`, tone: "overdue" };
  return { label: `Due ${format(date, "MMM d")}`, tone: "ok" };
}

export type GradeTone = "muted" | "success" | "primary" | "warning" | "danger";

/**
 * Tone bucket for a grade. Thresholds are on the *percentage* (score /
 * maxScore), not the raw score: 45/50 is a 90% grade, not a failing one. When
 * maxScore is missing the score is treated as the percentage.
 */
export function gradeTone(score: number | null, maxScore: number | null): GradeTone {
  if (score === null) return "muted";
  const percent = maxScore && maxScore > 0 ? (score / maxScore) * 100 : score;
  if (percent >= 90) return "success";
  if (percent >= 80) return "primary";
  if (percent >= 70) return "warning";
  return "danger";
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "0 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/** Human file size, e.g. `512 B`, `1.5 KB`, `2 MB`. `null`/invalid → `—`. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}