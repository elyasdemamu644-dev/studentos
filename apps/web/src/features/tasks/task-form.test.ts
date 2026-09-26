import { describe, expect, it } from "vitest";
import { toDateValue } from "@/features/tasks/task-form";

describe("toDateValue", () => {
  it("uses the local calendar date", () => {
    expect(toDateValue(new Date(2026, 8, 23, 0, 5).toISOString())).toBe("2026-09-23");
    expect(toDateValue(new Date(2026, 8, 23, 23, 55).toISOString())).toBe("2026-09-23");
  });

  it("handles empty and invalid input", () => {
    expect(toDateValue(null)).toBe("");
    expect(toDateValue(undefined)).toBe("");
    expect(toDateValue("not-a-date")).toBe("");
  });
});