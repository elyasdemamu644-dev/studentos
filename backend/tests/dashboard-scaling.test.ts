import { describe, it, expect, beforeAll } from "vitest";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";

const BASE = "/api/v1";

/**
 * The command center must stay balanced as real data grows: list sections are
 * capped to what fits on screen while the counters above them still reflect
 * the full totals, and long titles come through intact for the UI to truncate.
 */
describe("Dashboard data scaling", () => {
  const dayMs = 24 * 60 * 60 * 1000;

  let token: string;
  let userId: string;

  const longTitle = "A deliberately long task title ".repeat(12).trim();

  beforeAll(async () => {
    const auth = await registerAndLogin("dash-scale@test.com", "Pass123!");
    token = auth.token;
    userId = auth.user.id;

    const now = Date.now();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    // 10 overdue + 10 upcoming tasks (all open), 10 events spread across today.
    await prisma.task.createMany({
      data: [
        ...Array.from({ length: 10 }, (_, i) => ({
          userId,
          title: `Overdue task ${i}`,
          status: "TODO" as const,
          priority: "MEDIUM" as const,
          dueDate: new Date(startOfToday.getTime() - (10 - i) * dayMs),
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          userId,
          title: `Upcoming task ${i}`,
          status: "TODO" as const,
          priority: "MEDIUM" as const,
          dueDate: new Date(startOfToday.getTime() + (i + 1) * dayMs),
        })),
        {
          userId,
          title: longTitle,
          status: "TODO" as const,
          priority: "URGENT" as const,
          dueDate: new Date(startOfToday.getTime() - 20 * dayMs),
        },
      ],
    });

    await prisma.event.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        userId,
        title: `Today event ${i}`,
        type: "CLASS" as const,
        startAt: new Date(startOfToday.getTime() + i * 60 * 60 * 1000),
        endAt: new Date(startOfToday.getTime() + (i + 1) * 60 * 60 * 1000),
      })),
    });
  });

  it("caps list sections while counters keep the full totals", async () => {
    const res = await authRequestJson("get", `${BASE}/dashboard`, token);
    expect(res.status).toBe(200);

    const d = res.body.data;

    expect(d.tasks.total).toBe(21);
    expect(d.tasks.byStatus.TODO).toBe(21);
    expect(d.tasks.overdue).toBe(11);
    expect(d.tasks.dueToday).toBe(0);

    // Lists are capped to what the UI shows; the counters are not.
    expect(d.overdueTasks).toHaveLength(8);
    expect(d.upcomingTasks).toHaveLength(8);
    expect(d.events.today).toHaveLength(8);
  });

  it("orders the capped lists by due date with the soonest deadline first", async () => {
    const res = await authRequestJson("get", `${BASE}/dashboard`, token);
    const d = res.body.data;

    const overdueDates = d.overdueTasks.map((t: { dueDate: string }) => new Date(t.dueDate).getTime());
    expect([...overdueDates].sort((a, b) => a - b)).toEqual(overdueDates);

    const upcomingTitles = d.upcomingTasks.map((t: { title: string }) => t.title);
    expect(upcomingTitles).toEqual(
      Array.from({ length: 8 }, (_, i) => `Upcoming task ${i}`),
    );
  });

  it("returns long titles intact for the UI to truncate", async () => {
    const res = await authRequestJson("get", `${BASE}/dashboard`, token);
    const d = res.body.data;

    expect(d.overdueTasks.map((t: { title: string }) => t.title)).toContain(longTitle);
  });

  it("stays balanced for a brand new user", async () => {
    const fresh = await registerAndLogin("dash-scale-empty@test.com", "Pass123!");
    const res = await authRequestJson("get", `${BASE}/dashboard`, fresh.token);
    const d = res.body.data;

    expect(d.tasks.total).toBe(0);
    expect(d.overdueTasks).toEqual([]);
    expect(d.upcomingTasks).toEqual([]);
    expect(d.events.today).toEqual([]);
    expect(d.courses.recent).toEqual([]);
  });
});