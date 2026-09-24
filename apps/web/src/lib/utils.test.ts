import { describe, expect, it } from "vitest";
import { clamp, readableForeground, isHexColor, formatMinutes as compactMinutes } from "@/lib/utils";

describe("lib/utils formatMinutes", () => {
  it("handles nullish and small values", () => {
    expect(compactMinutes(null)).toBe("0m");
    expect(compactMinutes(undefined)).toBe("0m");
    expect(compactMinutes(0)).toBe("0m");
    expect(compactMinutes(5)).toBe("5m");
  });

  it("renders hours and minutes", () => {
    expect(compactMinutes(95)).toBe("1h 35m");
    expect(compactMinutes(120)).toBe("2h");
    expect(compactMinutes(59)).toBe("59m");
  });

  it("clamps negative durations", () => {
    expect(compactMinutes(-10)).toBe("0m");
  });
});

describe("lib/utils clamp", () => {
  it("bounds values within the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(999, 0, 100)).toBe(100);
  });
});

describe("lib/utils readableForeground", () => {
  it("picks white for dark colours and dark for light colours", () => {
    expect(readableForeground("#000000")).toBe("#ffffff");
    expect(readableForeground("#123456")).toBe("#ffffff");
    expect(readableForeground("#eeeeee")).toBe("#1a202c");
  });

  it("defaults to white for invalid input", () => {
    expect(readableForeground("nope")).toBe("#ffffff");
  });
});

describe("lib/utils isHexColor", () => {
  it("recognises 6-digit hex colours only", () => {
    expect(isHexColor("#6366f1")).toBe(true);
    expect(isHexColor("6366f1")).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});