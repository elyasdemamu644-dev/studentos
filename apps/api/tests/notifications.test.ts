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
});