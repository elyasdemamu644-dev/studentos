import { describe, expect, it } from "vitest";
import {
  applyNotificationFilter,
  serverStatusForFilter,
  unreadCountOf,
} from "@/features/notifications/notification-utils";
import type { AppNotification } from "@/types/api-types";

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n1",
    title: "Exam in 3 days",
    message: "Organic Chemistry midterm is coming up.",
    type: "EXAM_REMINDER",
    delivery: "IN_APP",
    channel: null,
    status: "UNREAD",
    readAt: null,
    relatedType: "Event",
    relatedId: "e1",
    createdAt: new Date(2026, 8, 26).toISOString(),
    updatedAt: new Date(2026, 8, 26).toISOString(),
    ...overrides,
  };
}

describe("notification filtering", () => {
  const items = [
    makeNotification({ id: "unread", status: "UNREAD" }),
    makeNotification({ id: "read", status: "READ" }),
    makeNotification({ id: "archived", status: "ARCHIVED" }),
  ];

  it("hides archived reminders from the default inbox", () => {
    expect(applyNotificationFilter(items, "all", false).map((n) => n.id)).toEqual([
      "unread",
      "read",
    ]);
  });

  it("includes archived reminders once the user opts in", () => {
    expect(applyNotificationFilter(items, "all", true)).toHaveLength(3);
  });

  it("passes through results the API already filtered", () => {
    // The status filters resolve server-side, so the client must not re-filter.
    const unreadFromServer = [items[0]];
    expect(applyNotificationFilter(unreadFromServer, "UNREAD", false)).toEqual(unreadFromServer);
    const archivedFromServer = [items[2]];
    expect(applyNotificationFilter(archivedFromServer, "ARCHIVED", false)).toEqual(
      archivedFromServer,
    );
  });

  it("lets the server resolve every filter except the combined inbox", () => {
    expect(serverStatusForFilter("all")).toBeUndefined();
    expect(serverStatusForFilter("ARCHIVED")).toBe("ARCHIVED");
    expect(serverStatusForFilter("UNREAD")).toBe("UNREAD");
    expect(serverStatusForFilter("READ")).toBe("READ");
  });

  it("counts only unread reminders", () => {
    expect(unreadCountOf(items)).toBe(1);
  });
});
