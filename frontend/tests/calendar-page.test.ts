import { describe, expect, it } from "vitest";
import { buildCalendar, mapEventsToCalendarDays } from "@/features/events/calendar-utils";
import { isoToDateInput } from "@/features/events/event-form";
import type { CalEvent } from "@/types/api-types";

function makeEvent(overrides: Partial<CalEvent> = {}): CalEvent {
  return {
    id: "event-1",
    courseId: null,
    title: "Calendar event",
    description: null,
    type: "CLASS",
    startAt: new Date(2026, 8, 15, 9).toISOString(),
    endAt: null,
    location: null,
    createdAt: new Date(2026, 8, 1).toISOString(),
    updatedAt: new Date(2026, 8, 1).toISOString(),
    course: null,
    ...overrides,
  };
}

describe("calendar mapping", () => {
  it("queries the complete visible grid within the API limit", () => {
    const calendar = buildCalendar(new Date(2026, 8, 15, 12));

    expect(calendar.start.getDay()).toBe(0);
    expect(calendar.end.getDay()).toBe(6);
    expect(calendar.start.getDate()).toBe(30);
    expect(calendar.end.getDate()).toBe(3);
    expect(calendar.cells).toHaveLength(35);
    expect(calendar.query.startFrom).toBe(calendar.start.toISOString());
    expect(calendar.query.startTo).toBe(calendar.end.toISOString());
    expect(calendar.query.limit).toBe(100);
  });

  it("maps a multi-day event onto every covered local day", () => {
    const calendar = buildCalendar(new Date(2026, 8, 15, 12));
    const event = makeEvent({
      id: "multi-day",
      startAt: new Date(2026, 7, 31, 23).toISOString(),
      endAt: new Date(2026, 8, 2, 1).toISOString(),
    });

    const mapped = mapEventsToCalendarDays([event], calendar.start, calendar.end);

    expect(mapped.get("2026-08-31")?.map((item) => item.id)).toEqual(["multi-day"]);
    expect(mapped.get("2026-09-01")?.map((item) => item.id)).toEqual(["multi-day"]);
    expect(mapped.get("2026-09-02")?.map((item) => item.id)).toEqual(["multi-day"]);
  });

  it("keeps event dates in the browser's local calendar", () => {
    expect(isoToDateInput(new Date(2026, 8, 1, 0, 30).toISOString())).toBe("2026-09-01");
    expect(isoToDateInput("invalid")).toBe("");
  });
});
