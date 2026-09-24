import { describe, expect, it } from "vitest";
import { toDateValue } from "@/features/tasks/task-form";

describe("toDateValue", () => {
  it("turns ISO timestamps into yyyy-MM-dd", () => {
    expect(toDateValue("2026-09-23T09:05:00Z")).toBe("2026-09-23");
  });

  it("handles empty and invalid input", () => {
    expect(toDateValue(null)).toBe("");
    expect(toDateValue(undefined)).toBe("");
    expect(toDateValue("not-a-date")).toBe("");
  });
});