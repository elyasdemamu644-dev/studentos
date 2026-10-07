import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";

const BASE = "/api/v1";

describe("Notifications Module", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("notif@test.com", "Pass123!");
    token = auth.token;
    userId = auth.user.id;

    // Seed a mix of notifications directly (there is no create endpoint).
    // Distinct createdAt values so ordering by createdAt desc is deterministic.
    await prisma.notification.createMany({
      data: [
        {
          userId,
          title: "Homework due",
          message: "CS101 homework is due Friday",
          type: "ASSIGNMENT_DUE",
          status: "UNREAD",
          createdAt: new Date("2035-01-01T10:00:00.000Z"),
        },
        {
          userId,
          title: "Goal achieved",
          message: "You completed a goal",
          type: "GOAL_REMINDER",
          status: "READ",
          readAt: new Date("2035-01-02T10:00:00.000Z"),
          createdAt: new Date("2035-01-02T10:00:00.000Z"),
        },
        {
          userId,
          title: "Exam reminder",
          message: "Midterm starts at 09:00",
          type: "EXAM_REMINDER",
          status: "UNREAD",
          createdAt: new Date("2035-01-03T10:00:00.000Z"),
        },
      ],
    });
  });

  describe("GET /notifications", () => {
    it("should list notifications newest-first with unreadCount", async () => {
      const res = await authRequestJson("get", `${BASE}/notifications`, token);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(3);
      expect(res.body.data.unreadCount).toBe(2);
      expect(res.body.data.items[0].status).toBe("UNREAD");
    });

    it("should filter by status", async () => {
      const res = await authRequestJson("get", `${BASE}/notifications?status=READ`, token);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].status).toBe("READ");
    });

    it("should filter by unread=true", async () => {
      const res = await authRequestJson("get", `${BASE}/notifications?unread=true`, token);
      expect(res.body.data.items).toHaveLength(2);
    });
  });

  describe("GET /notifications/:id", () => {
    it("should return a single notification", async () => {
      const list = await authRequestJson("get", `${BASE}/notifications`, token);
      const id = list.body.data.items[0].id;

      const res = await authRequestJson("get", `${BASE}/notifications/${id}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(id);
    });
  });

  describe("POST /notifications/:id/read", () => {
    it("should mark a single notification as read", async () => {
      const list = await authRequestJson("get", `${BASE}/notifications?status=UNREAD`, token);
      const id = list.body.data.items[0].id;

      const res = await authRequestJson("post", `${BASE}/notifications/${id}/read`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("READ");
      expect(res.body.data.readAt).not.toBeNull();
    });
  });

  describe("POST /notifications/read-all", () => {
    it("should mark all unread notifications as read", async () => {
      const res = await authRequestJson("post", `${BASE}/notifications/read-all`, token);

      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBeGreaterThan(0);

      const list = await authRequestJson("get", `${BASE}/notifications`, token);
      expect(list.body.data.unreadCount).toBe(0);
    });
  });

  describe("PATCH /notifications/:id", () => {
    it("should archive a notification", async () => {
      const list = await authRequestJson("get", `${BASE}/notifications`, token);
      const id = list.body.data.items[0].id;

      const res = await authRequestJson("patch", `${BASE}/notifications/${id}`, token, {
        status: "ARCHIVED",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("ARCHIVED");
    });
  });

  describe("Cross-user isolation", () => {
    it("should not expose another user's notification", async () => {
      const other = await registerAndLogin("notif-other@test.com", "Pass123!");

      const mine = await prisma.notification.create({
        data: {
          userId,
          title: "Private",
          message: "secret",
          type: "GENERAL",
        },
      });

      const res = await authRequestJson("get", `${BASE}/notifications/${mine.id}`, other.token);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /notifications/generate", () => {
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    let genToken: string;
    let genUserId: string;

    beforeAll(async () => {
      const auth = await registerAndLogin("notif-generate@test.com", "Pass123!");
      genToken = auth.token;
      genUserId = auth.user.id;

      // Everything below is relative to "now" so the windows are deterministic.
      const now = Date.now();

      await prisma.task.createMany({
        data: [
          {
            userId: genUserId,
            title: "Due in two days",
            status: "TODO",
            dueDate: new Date(now + 2 * dayMs),
          },
          {
            userId: genUserId,
            title: "Overdue by one day",
            status: "IN_PROGRESS",
            dueDate: new Date(now - 1 * dayMs),
          },
          {
            userId: genUserId,
            title: "Far future task",
            status: "TODO",
            dueDate: new Date(now + 30 * dayMs),
          },
          {
            userId: genUserId,
            title: "Already done",
            status: "COMPLETED",
            dueDate: new Date(now + 1 * dayMs),
          },
        ],
      });

      await prisma.event.createMany({
        data: [
          {
            userId: genUserId,
            title: "Midterm",
            type: "EXAM",
            startAt: new Date(now + 3 * dayMs),
            endAt: new Date(now + 3 * dayMs + 2 * hourMs),
          },
          {
            userId: genUserId,
            title: "Lecture",
            type: "CLASS",
            startAt: new Date(now + 1 * dayMs),
            endAt: new Date(now + 1 * dayMs + hourMs),
          },
          {
            userId: genUserId,
            title: "Exam next month",
            type: "EXAM",
            startAt: new Date(now + 30 * dayMs),
            endAt: new Date(now + 30 * dayMs + hourMs),
          },
        ],
      });

      await prisma.goal.create({
        data: {
          userId: genUserId,
          title: "Finish thesis",
          status: "ACTIVE",
          deadline: new Date(now + 5 * dayMs),
        },
      });
    });

    it("should create reminders for in-window data only", async () => {
      const res = await authRequestJson("post", `${BASE}/notifications/generate`, genToken);

      expect(res.status).toBe(200);
      expect(res.body.data.created).toBe(4); // 2 tasks + 1 exam + 1 goal
      expect(res.body.data.scanned).toBe(4);

      const list = await authRequestJson("get", `${BASE}/notifications`, genToken);
      const types = list.body.data.items.map((n: { type: string }) => n.type);

      expect(types).toContain("ASSIGNMENT_DUE");
      expect(types).toContain("OVERDUE_TASK");
      expect(types).toContain("EXAM_REMINDER");
      expect(types).toContain("GOAL_REMINDER");

      // Out-of-window and non-matching records must not be referenced.
      const relatedTitles = list.body.data.items.map((n: { message: string }) => n.message);
      const allMessages = relatedTitles.join(" ");
      expect(allMessages).toContain("Due in two days");
      expect(allMessages).toContain("Overdue by one day");
      expect(allMessages).toContain("Midterm");
      expect(allMessages).toContain("Finish thesis");
      expect(allMessages).not.toContain("Far future task");
      expect(allMessages).not.toContain("Already done");
      expect(allMessages).not.toContain("Exam next month");
      expect(allMessages).not.toContain("Lecture");
    });

    it("should be idempotent across repeated calls", async () => {
      const second = await authRequestJson("post", `${BASE}/notifications/generate`, genToken);
      expect(second.status).toBe(200);
      expect(second.body.data.created).toBe(0);
      expect(second.body.data.scanned).toBe(4);

      const list = await authRequestJson("get", `${BASE}/notifications`, genToken);
      expect(list.body.data.items).toHaveLength(4);
    });

    it("should link each reminder to its source record", async () => {
      const list = await authRequestJson("get", `${BASE}/notifications`, genToken);
      const exam = list.body.data.items.find(
        (n: { type: string }) => n.type === "EXAM_REMINDER",
      );

      expect(exam.relatedType).toBe("EVENT");
      expect(exam.relatedId).toBeTruthy();
      expect(exam.status).toBe("UNREAD");
      expect(exam.delivery).toBe("IN_APP");

      const event = await prisma.event.findUnique({ where: { id: exam.relatedId } });
      expect(event?.title).toBe("Midterm");
    });

    it("should not generate reminders for another user", async () => {
      const other = await registerAndLogin("notif-generate-other@test.com", "Pass123!");

      const res = await authRequestJson("post", `${BASE}/notifications/generate`, other.token);
      expect(res.status).toBe(200);
      expect(res.body.data.created).toBe(0);
      expect(res.body.data.scanned).toBe(0);
      expect(res.body.data.unreadCount).toBe(0);
    });

    it("should require authentication", async () => {
      const res = await authRequestJson("post", `${BASE}/notifications/generate`, "");
      expect(res.status).toBe(401);
    });
  });
});