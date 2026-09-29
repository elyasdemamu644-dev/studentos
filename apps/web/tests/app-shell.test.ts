import { describe, expect, it } from "vitest";
import { isNavActive, MOBILE_NAV_HREFS, NAV_ITEMS } from "@/components/layout/app-shell";

const hrefs = NAV_ITEMS.map((item) => item.href);

describe("app shell navigation", () => {
  it("exposes every core surface", () => {
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/dashboard",
        "/courses",
        "/academics",
        "/tasks",
        "/calendar",
        "/exams",
        "/notes",
        "/resources",
        "/study",
        "/goals",
        "/analytics",
      ]),
    );
  });

  it("has no duplicate routes", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("marks nested routes active but treats dashboard as exact", () => {
    expect(isNavActive("/courses", "/dashboard")).toBe(false);
    expect(isNavActive("/dashboard", "/dashboard")).toBe(true);
    expect(isNavActive("/dashboard/tasks", "/dashboard")).toBe(false);
    expect(isNavActive("/courses/abc-123", "/courses")).toBe(true);
    expect(isNavActive("/exams", "/exams")).toBe(true);
  });

  it("does not confuse sibling routes that share a prefix", () => {
    expect(isNavActive("/notes", "/notifications")).toBe(false);
    expect(isNavActive("/notifications", "/notes")).toBe(false);
  });

  it("keeps every mobile destination present in the sidebar list", () => {
    for (const href of MOBILE_NAV_HREFS) {
      expect(hrefs).toContain(href);
    }
  });

  it("keeps the mobile bar to a thumb-friendly number of items", () => {
    expect(MOBILE_NAV_HREFS.length).toBeLessThanOrEqual(5);
  });
});
