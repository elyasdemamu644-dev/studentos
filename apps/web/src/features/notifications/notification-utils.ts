import type { AppNotification, NotificationStatus } from "@/types/api-types";

export type NotificationFilter = "all" | NotificationStatus;

export const NOTIFICATION_FILTERS: Array<{ value: NotificationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "UNREAD", label: "Unread" },
  { value: "READ", label: "Read" },
  { value: "ARCHIVED", label: "Archived" },
];

/**
 * The API treats `status` as an exact match, so every filter but "all" is
 * resolved server-side. "All" returns archived rows too, which is why the page
 * also offers a client-side archived toggle.
 */
export function serverStatusForFilter(filter: NotificationFilter): NotificationStatus | undefined {
  return filter === "all" ? undefined : filter;
}

/**
 * Archived reminders stay out of the default inbox so it reflects what is still
 * actionable; the other filters arrive pre-filtered from the API.
 */
export function applyNotificationFilter(
  items: AppNotification[],
  filter: NotificationFilter,
  showArchived: boolean,
): AppNotification[] {
  if (filter !== "all") return items;
  return showArchived ? items : items.filter((n) => n.status !== "ARCHIVED");
}

export function unreadCountOf(items: AppNotification[]): number {
  return items.filter((n) => n.status === "UNREAD").length;
}
