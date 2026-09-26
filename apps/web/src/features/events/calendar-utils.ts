import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { CalEvent } from "@/features/api-types";

export function toDayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function buildCalendar(anchor: Date) {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const start = startOfWeek(monthStart, { weekStartsOn: 0 });
  const end = endOfWeek(monthEnd, { weekStartsOn: 0 });

  return {
    cells: eachDayOfInterval({ start, end }),
    start,
    end,
    query: {
      startFrom: start.toISOString(),
      startTo: end.toISOString(),
      limit: 100,
    },
  };
}

export function mapEventsToCalendarDays(
  items: CalEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>();
  const firstVisibleDay = startOfDay(rangeStart);
  const lastVisibleDay = startOfDay(rangeEnd);

  for (const item of items) {
    const startAt = parseISO(item.startAt);
    if (Number.isNaN(startAt.getTime())) continue;

    const parsedEndAt = item.endAt ? parseISO(item.endAt) : startAt;
    const endAt = Number.isNaN(parsedEndAt.getTime()) || parsedEndAt < startAt ? startAt : parsedEndAt;
    const eventFirstDay = startOfDay(startAt);
    const eventLastDay = startOfDay(endAt);
    const firstDay = eventFirstDay < firstVisibleDay ? firstVisibleDay : eventFirstDay;
    const lastDay = eventLastDay > lastVisibleDay ? lastVisibleDay : eventLastDay;
    if (firstDay > lastDay) continue;

    for (const day of eachDayOfInterval({ start: firstDay, end: lastDay })) {
      const key = toDayKey(day);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.title.localeCompare(b.title));
  }

  return map;
}
