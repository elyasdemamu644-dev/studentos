import { describe, expect, it } from "vitest";
import { resolveCourseId } from "@/features/study/course-selection";

describe("study page course sentinel", () => {
  it("maps General study and empty selections to a null courseId", () => {
    expect(resolveCourseId("__general")).toBeNull();
    expect(resolveCourseId("")).toBeNull();
  });

  it("passes a real course id through unchanged", () => {
    expect(resolveCourseId("course-123")).toBe("course-123");
  });
});
