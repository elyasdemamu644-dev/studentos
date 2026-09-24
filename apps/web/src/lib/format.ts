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

export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "0 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}