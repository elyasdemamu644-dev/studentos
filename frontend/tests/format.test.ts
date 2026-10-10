import { describe, expect, it } from "vitest";
import { addDays, format, subDays } from "date-fns";
import {
  dueLabel,
  formatBytes,
  formatDate,
  formatMinutes,
  formatTime,
  relativeTime,
} from "@/lib/format";

function midDayIso(date: Date): string {
  return `${format(date, "yyyy-MM-dd")}T12:00:00`;
}

describe("lib/format formatDate", () => {
  it("formats ISO strings for a pattern", () => {
    expect(formatDate("2026-09-23T12:00:00", "yyyy-MM-dd")).toBe("2026-09-23");
  });

  it("returns an em dash for empty input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });

  it("returns an em dash for invalid input", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("lib/format formatTime", () => {
  it("formats a time", () => {
    expect(formatTime("2026-09-23T09:05:00")).toMatch(/9:0[0-9] (AM|am)/);
  });

  it("returns an em dash for empty input", () => {
    expect(formatTime(null)).toBe("—");
  });
});

describe("lib/format formatMinutes", () => {
  it("formats minute counts", () => {
    expect(formatMinutes(90)).toBe("1 hr 30 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 hr");
    expect(formatMinutes(null)).toBe("0 min");
  });
});

describe("lib/format formatBytes", () => {
  it("formats byte counts across units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });

  it("returns an em dash for missing or invalid sizes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("lib/format relativeTime", () => {
  it("labels just-now times", () => {
    expect(relativeTime(new Date().toISOString())).toBe("just now");
  });
});

describe("lib/format dueLabel", () => {
  it("handles tasks without a due date", () => {
    expect(dueLabel(null)).toEqual({ label: "No due date", tone: "ok" });
  });

  it("labels completed tasks", () => {
    const iso = midDayIso(subDays(new Date(), 5));
    expect(dueLabel(iso, "COMPLETED")).toEqual({ label: "Completed", tone: "done" });
  });

  it("labels overdue tasks", () => {
    const iso = midDayIso(subDays(new Date(), 2));
    const label = dueLabel(iso);
    expect(label.tone).toBe("overdue");
    expect(label.label).toContain("Overdue");
  });

  it("labels today and tomorrow", () => {
    expect(dueLabel(midDayIso(new Date()))).toMatchObject({ label: "Due today", tone: "soon" });
    expect(dueLabel(midDayIso(addDays(new Date(), 1)))).toMatchObject({ label: "Due tomorrow", tone: "soon" });
  });

  it("handles invalid dates without crashing", () => {
    const label = dueLabel("garbage");
    expect(label.tone).toBe("ok");
  });
});