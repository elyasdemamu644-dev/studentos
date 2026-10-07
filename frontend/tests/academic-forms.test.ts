import { describe, expect, it } from "vitest";
import { semesterFormSchema, yearFormSchema } from "@/features/academics/academic-forms";

const validYear = {
  name: "2025/2026",
  startDate: "2025-09-01",
  endDate: "2026-06-30",
  status: "ACTIVE" as const,
};

const validSemester = {
  academicYearId: "year-1",
  name: "Fall Semester",
  startDate: "2025-09-01",
  endDate: "2026-01-31",
  status: "ACTIVE" as const,
};

describe("academic year form", () => {
  it("accepts a well-formed year", () => {
    expect(yearFormSchema.safeParse(validYear).success).toBe(true);
  });

  it("requires a name", () => {
    const result = yearFormSchema.safeParse({ ...validYear, name: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["name"]);
    }
  });

  it("rejects an end date before the start date", () => {
    const result = yearFormSchema.safeParse({
      ...validYear,
      startDate: "2026-09-01",
      endDate: "2025-06-30",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["endDate"]);
    }
  });

  it("allows a single-day year", () => {
    const sameDay = { ...validYear, startDate: "2025-09-01", endDate: "2025-09-01" };
    expect(yearFormSchema.safeParse(sameDay).success).toBe(true);
  });
});

describe("semester form", () => {
  it("accepts a well-formed semester", () => {
    expect(semesterFormSchema.safeParse(validSemester).success).toBe(true);
  });

  it("requires a parent academic year", () => {
    const result = semesterFormSchema.safeParse({ ...validSemester, academicYearId: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["academicYearId"]);
    }
  });

  it("rejects an inverted semester range", () => {
    const result = semesterFormSchema.safeParse({
      ...validSemester,
      startDate: "2026-02-01",
      endDate: "2026-01-31",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["endDate"]);
    }
  });
});
