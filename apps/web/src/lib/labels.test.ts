import { describe, expect, it } from "vitest";
import {
  EVENT_TYPE_LABELS,
  MILESTONE_STATUS_LABELS,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
} from "@/lib/labels";

describe("lib/labels", () => {
  it("maps every task status to a friendly label", () => {
    expect(TASK_STATUS_LABELS["COMPLETED"]).toBe("Completed");
    expect(Object.keys(TASK_STATUS_LABELS)).toEqual(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
  });

  it("maps every priority", () => {
    expect(PRIORITY_LABELS["URGENT"]).toBe("Urgent");
    expect(PRIORITY_LABELS["LOW"]).toBe("Low");
  });

  it("covers all milestone statuses", () => {
    expect(Object.keys(MILESTONE_STATUS_LABELS)).toEqual(["TODO", "IN_PROGRESS", "COMPLETED"]);
  });

  it("covers the event types used by the calendar", () => {
    for (const type of ["CLASS", "EXAM", "ASSIGNMENT", "PROJECT", "STUDY", "MEETING", "PERSONAL", "OTHER"]) {
      expect(EVENT_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it("maps every task type", () => {
    for (const type of ["ASSIGNMENT", "HOMEWORK", "PROJECT", "READING", "PRACTICE", "REVISION", "OTHER"]) {
      expect(TASK_TYPE_LABELS[type as keyof typeof TASK_TYPE_LABELS]).toBeTruthy();
    }
  });
});