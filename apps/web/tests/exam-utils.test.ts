import { describe, expect, it } from "vitest";
import {
  countCoursesWithExams,
  countdownLabel,
  isExamOver,
  partitionExams,
} from "@/features/events/exam-utils";
import type { CalEvent } from "@/types/api-types";

const NOW = new Date(2026, 8, 26, 12);

function makeExam(overrides: Partial<CalEvent> = {}): CalEvent {
  return {
    id: "exam-1",
    courseId: "course-1",
    title: "Midterm",
    description: null,
    type: "EXAM",
    startAt: NOW.toISOString(),
    endAt: null,
    location: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    course: null,
    ...overrides,
  };
}

describe("exam countdown", () => {
  it("escalates the tone as the exam approaches", () => {
    expect(countdownLabel(new Date(2026, 8, 20).toISOString(), NOW)).toEqual({
      label: "Past",
      tone: "muted",
    });
    expect(countdownLabel(new Date(2026, 8, 26).toISOString(), NOW)).toEqual({
      label: "Today",
      tone: "danger",
    });
    expect(countdownLabel(new Date(2026, 8, 27).toISOString(), NOW)).toEqual({
      label: "Tomorrow",
      tone: "danger",
    });
    expect(countdownLabel(new Date(2026, 8, 30).toISOString(), NOW)).toEqual({
      label: "In 4 days",
      tone: "warning",
    });
  });

  it("relaxes the tone once an exam is more than a week out", () => {
    expect(countdownLabel(new Date(2026, 9, 10).toISOString(), NOW)).toEqual({
      label: "In 14 days",
      tone: "muted",
    });
  });

  it("treats the same calendar day as today even at a later hour", () => {
    expect(countdownLabel(new Date(2026, 8, 26, 23, 30).toISOString(), NOW).label).toBe("Today");
  });
});

describe("exam partitioning", () => {
  it("counts an exam as finished only after its end time", () => {
    const running = makeExam({
      startAt: new Date(2026, 8, 26, 9).toISOString(),
      endAt: new Date(2026, 8, 26, 11).toISOString(),
    });
    expect(isExamOver(running, NOW)).toBe(true);

    const ongoing = makeExam({
      startAt: new Date(2026, 8, 26, 9).toISOString(),
      endAt: new Date(2026, 8, 26, 15).toISOString(),
    });
    expect(isExamOver(ongoing, NOW)).toBe(false);
  });

  it("falls back to the start time for open-ended exams", () => {
    const past = makeExam({ startAt: new Date(2026, 8, 25, 9).toISOString(), endAt: null });
    expect(isExamOver(past, NOW)).toBe(true);
  });

  it("orders upcoming ascending and past descending", () => {
    const { upcoming, past } = partitionExams(
      [
        makeExam({ id: "late", startAt: new Date(2026, 9, 10).toISOString() }),
        makeExam({ id: "soon", startAt: new Date(2026, 8, 28).toISOString() }),
        makeExam({ id: "old", startAt: new Date(2026, 7, 1).toISOString() }),
        makeExam({ id: "recent", startAt: new Date(2026, 8, 20).toISOString() }),
      ],
      NOW,
    );

    expect(upcoming.map((e) => e.id)).toEqual(["soon", "late"]);
    expect(past.map((e) => e.id)).toEqual(["recent", "old"]);
  });

  it("counts distinct courses with upcoming exams, ignoring course-less ones", () => {
    expect(
      countCoursesWithExams([
        makeExam({ id: "a", courseId: "course-1" }),
        makeExam({ id: "b", courseId: "course-1" }),
        makeExam({ id: "c", courseId: "course-2" }),
        makeExam({ id: "d", courseId: null }),
      ]),
    ).toBe(2);
  });
});
