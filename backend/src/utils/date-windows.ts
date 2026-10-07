/**
 * Shared local-day boundaries.
 *
 * "Overdue" and "due today" are calendar-day buckets, not instant comparisons:
 * a task due at 09:00 is still *due today* at 14:00, not overdue. Every module
 * that buckets by day must use these so the dashboard, course rollups and the
 * tasks page never disagree about what counts as overdue.
 */

/** Local midnight at the start of the day containing `ref`. */
export function startOfLocalDay(ref: Date = new Date()): Date {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Local midnight at the start of the day after the day containing `ref`. */
export function endOfLocalDay(ref: Date = new Date()): Date {
  const d = startOfLocalDay(ref);
  d.setDate(d.getDate() + 1);
  return d;
}

/** Overdue = open and due strictly before local midnight today. */
export function isOverdue(dueDate: Date | null, status: string, ref: Date = new Date()): boolean {
  return dueDate !== null && dueDate < startOfLocalDay(ref) && isOpenStatus(status);
}

/** Due today = due within today's local calendar day. */
export function isDueToday(dueDate: Date | null, status: string, ref: Date = new Date()): boolean {
  if (dueDate === null || !isOpenStatus(status)) return false;
  const start = startOfLocalDay(ref);
  return dueDate >= start && dueDate < endOfLocalDay(ref);
}

export function isOpenStatus(status: string): boolean {
  return status === "TODO" || status === "IN_PROGRESS";
}

/** Prisma `dueDate` filter matching {@link isOverdue} for open tasks. */
export function overdueDueDateFilter(ref: Date = new Date()) {
  return { lt: startOfLocalDay(ref) };
}