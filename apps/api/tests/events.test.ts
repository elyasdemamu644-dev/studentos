import { describe, it, expect } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";

const BASE = "/api/v1";

describe("Events Module", () => {
  let token: string;
  let userId: string;
  let courseId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("events@test.com", "Pass123!");
    token = auth.token;
    userId = auth.user.id;

    const yearRes = await authRequestJson("post", `${BASE}/academics/years`, token, {
      name: "2037-2038",
      startDate: "2037-09-01T00:00:00.000Z",
      endDate: "2038-06-30T00:00:00.000Z",
    });
    const semRes = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
      name: "Fall 2037",
      academicYearId: yearRes.body.data.id,
      startDate: "2037-09-01T00:00:00.000Z",
      endDate: "2037-12-15T00:00:00.000Z",
    });
    const courseRes = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "EVT101",
      name: "Event Driven Systems",
      credits: 3,
      semesterId: semRes.body.data.id,
    });
    courseId = courseRes.body.data.id;
  });

  describe("POST /events", () => {
    it("should create an event", async () => {
      const res = await authRequestJson("post", `${BASE}/events`, token, {
        title: "Final exam",
        type: "EXAM",
        startAt: "2037-12-10T09:00:00.000Z",
        endAt: "2037-12-10T11:00:00.000Z",
        location: "Hall B",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe("Final exam");
      expect(res.body.data.type).toBe("EXAM");
      expect(res.body.data.startAt).toBe("2037-12-10T09:00:00.000Z");

      const persisted = await prisma.event.findUnique({
        where: { id: res.body.data.id },
      });
      expect(persisted).toMatchObject({
        userId,
        courseId: null,
        title: "Final exam",
        description: null,
        type: "EXAM",
        startAt: new Date("2037-12-10T09:00:00.000Z"),
        endAt: new Date("2037-12-10T11:00:00.000Z"),
        location: "Hall B",
      });
    });

    it("should link an event to a course", async () => {
      const res = await authRequestJson("post", `${BASE}/events`, token, {
        title: "Lecture",
        type: "CLASS",
        startAt: "2037-09-05T10:00:00.000Z",
        courseId,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.courseId).toBe(courseId);
    });

    it("should reject endAt before startAt", async () => {
      const res = await authRequestJson("post", `${BASE}/events`, token, {
        title: "Backwards",
        startAt: "2037-12-10T11:00:00.000Z",
        endAt: "2037-12-10T09:00:00.000Z",
      });

      expect(res.status).toBe(400);
    });

    it("should reject a nonexistent course", async () => {
      const res = await authRequestJson("post", `${BASE}/events`, token, {
        title: "Ghost",
        startAt: "2037-09-05T10:00:00.000Z",
        courseId: "cuid_ghost123",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /events", () => {
    it("should list events with date range + type filters", async () => {
      const res = await authRequestJson(
        "get",
        `${BASE}/events?startFrom=2037-12-01&startTo=2037-12-31&type=EXAM`,
        token,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].title).toBe("Final exam");
    });

    it("should filter by courseId", async () => {
      const res = await authRequestJson("get", `${BASE}/events?courseId=${courseId}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].courseId).toBe(courseId);
    });

    it("returns events that overlap the requested range", async () => {
      const created = await authRequestJson("post", `${BASE}/events`, token, {
        title: "Multi-day workshop",
        startAt: "2038-01-01T09:00:00.000Z",
        endAt: "2038-01-03T17:00:00.000Z",
      });

      const res = await authRequestJson(
        "get",
        `${BASE}/events?startFrom=2038-01-02T00:00:00.000Z&startTo=2038-01-02T23:59:59.999Z`,
        token,
      );

      expect(res.status).toBe(200);
      expect(res.body.data.items.map((event: { id: string }) => event.id)).toContain(created.body.data.id);

      await authRequestJson("delete", `${BASE}/events/${created.body.data.id}`, token);
    });

    it("rejects invalid and reversed date ranges", async () => {
      const reversed = await authRequestJson(
        "get",
        `${BASE}/events?startFrom=2038-02-02T00:00:00.000Z&startTo=2038-02-01T00:00:00.000Z`,
        token,
      );
      expect(reversed.status).toBe(400);

      const invalid = await authRequestJson(
        "get",
        `${BASE}/events?startFrom=not-a-date&startTo=2038-02-01T00:00:00.000Z`,
        token,
      );
      expect(invalid.status).toBe(400);
    });
  });

  describe("PATCH /events/:id", () => {
    it("should reschedule an event", async () => {
      const created = await authRequestJson("post", `${BASE}/events`, token, {
        title: "Lab",
        startAt: "2037-10-01T14:00:00.000Z",
      });

      const res = await authRequestJson("patch", `${BASE}/events/${created.body.data.id}`, token, {
        startAt: "2037-10-02T15:00:00.000Z",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.startAt).toBe("2037-10-02T15:00:00.000Z");
    });
  });

  describe("DELETE /events/:id", () => {
    it("should delete an event", async () => {
      const created = await authRequestJson("post", `${BASE}/events`, token, {
        title: "Doomed",
        startAt: "2037-11-01T09:00:00.000Z",
      });

      const res = await authRequestJson("delete", `${BASE}/events/${created.body.data.id}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  describe("Cross-user isolation", () => {
    it("should not expose another user's event", async () => {
      const other = await registerAndLogin("events-other@test.com", "Pass123!");

      const mine = await authRequestJson("post", `${BASE}/events`, token, {
        title: "Private",
        startAt: "2037-11-10T09:00:00.000Z",
      });

      const res = await authRequestJson("get", `${BASE}/events/${mine.body.data.id}`, other.token);
      expect(res.status).toBe(404);
    });
  });
});