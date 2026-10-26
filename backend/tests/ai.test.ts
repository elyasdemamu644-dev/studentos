import { describe, it, expect, vi } from "vitest";
import { app } from "@/app";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";
import { resourcesService } from "@/services/resources";
import { DocumentExtractionError } from "@/services/document-extraction";

const BASE = "/api/v1";

describe("AI Module (no provider configured)", () => {
  let token: string;
  let userId: string;
  let courseId: string;

  beforeAll(async () => {
    const auth = await registerAndLogin("ai@test.com", "Pass123!");
    token = auth.token;
    userId = auth.user.id;

    const yearRes = await authRequestJson("post", `${BASE}/academics/years`, token, {
      name: "2034-2035",
      startDate: "2034-09-01T00:00:00.000Z",
      endDate: "2035-06-30T00:00:00.000Z",
    });
    const semRes = await authRequestJson("post", `${BASE}/academics/semesters`, token, {
      name: "Fall 2034",
      academicYearId: yearRes.body.data.id,
      startDate: "2034-09-01T00:00:00.000Z",
      endDate: "2034-12-15T00:00:00.000Z",
    });
    const courseRes = await authRequestJson("post", `${BASE}/courses`, token, {
      code: "AI101",
      name: "Intro to AI",
      credits: 3,
      semesterId: semRes.body.data.id,
    });
    courseId = courseRes.body.data.id;
  });

  describe("Conversations", () => {
    it("should create a conversation with default type", async () => {
      const res = await authRequestJson("post", `${BASE}/ai/conversations`, token, {
        title: "Big-O prep",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe("Big-O prep");
      expect(res.body.data.type).toBe("CHAT");
    });

    it("should create a conversation with custom type", async () => {
      const res = await authRequestJson("post", `${BASE}/ai/conversations`, token, {
        type: "TUTOR",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe("TUTOR");
    });

    it("should list and fetch conversations", async () => {
      const list = await authRequestJson("get", `${BASE}/ai/conversations`, token);
      expect(list.status).toBe(200);
      expect(list.body.data.items.length).toBeGreaterThanOrEqual(2);

      const one = await authRequestJson("get", `${BASE}/ai/conversations/${list.body.data.items[0].id}`, token);
      expect(one.status).toBe(200);
      expect(one.body.data.id).toBe(list.body.data.items[0].id);
    });

    it("should carry the newest message as a preview on each listed conversation", async () => {
      const created = await authRequestJson("post", `${BASE}/ai/conversations`, token, {
        title: "Preview me",
      });
      const id = created.body.data.id;

      // A brand new conversation has nothing to preview.
      const before = await authRequestJson("get", `${BASE}/ai/conversations/${id}`, token);
      expect(before.body.data.preview).toBeNull();

      await authRequestJson("post", `${BASE}/ai/conversations/${id}/messages`, token, {
        content: "First thing I asked",
        generateReply: false,
      });
      await authRequestJson("post", `${BASE}/ai/conversations/${id}/messages`, token, {
        content: "Second thing I asked",
        generateReply: false,
      });

      const listed = await authRequestJson("get", `${BASE}/ai/conversations`, token);
      const row = listed.body.data.items.find((item: { id: string }) => item.id === id);
      expect(row.preview).toEqual(
        expect.objectContaining({ content: "Second thing I asked", role: "USER" }),
      );
    });

    it("should rename a conversation", async () => {
      const created = await authRequestJson("post", `${BASE}/ai/conversations`, token, {
        title: "Chat",
      });

      const res = await authRequestJson(
        "patch",
        `${BASE}/ai/conversations/${created.body.data.id}`,
        token,
        { title: "Database exam preparation" },
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe("Database exam preparation");

      // Persisted, not just echoed back.
      const fetched = await authRequestJson(
        "get",
        `${BASE}/ai/conversations/${created.body.data.id}`,
        token,
      );
      expect(fetched.body.data.title).toBe("Database exam preparation");
    });

    it("should reject an empty or blank rename", async () => {
      const created = await authRequestJson("post", `${BASE}/ai/conversations`, token, {});

      const blank = await authRequestJson(
        "patch",
        `${BASE}/ai/conversations/${created.body.data.id}`,
        token,
        { title: "   " },
      );
      expect(blank.status).toBe(400);
      expect(blank.body.error.code).toBe("VALIDATION_ERROR");

      const missing = await authRequestJson(
        "patch",
        `${BASE}/ai/conversations/${created.body.data.id}`,
        token,
        {},
      );
      // Nothing to change is a no-op, not a failure.
      expect(missing.status).toBe(200);
    });

    it("should not let one user rename another's conversation", async () => {
      const other = await registerAndLogin("ai-rename-other@test.com", "Pass123!");
      const mine = await authRequestJson("post", `${BASE}/ai/conversations`, token, {});

      const res = await authRequestJson(
        "patch",
        `${BASE}/ai/conversations/${mine.body.data.id}`,
        other.token,
        { title: "Hijacked" },
      );
      expect(res.status).toBe(404);

      const unchanged = await authRequestJson(
        "get",
        `${BASE}/ai/conversations/${mine.body.data.id}`,
        token,
      );
      expect(unchanged.body.data.title).toBe(mine.body.data.title);
    });

    it("should delete a conversation and its messages", async () => {
      const created = await authRequestJson("post", `${BASE}/ai/conversations`, token, {
        title: "Doomed",
      });

      const res = await authRequestJson("delete", `${BASE}/ai/conversations/${created.body.data.id}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  describe("Messages", () => {
    let conversationId: string;

    beforeAll(async () => {
      const created = await authRequestJson("post", `${BASE}/ai/conversations`, token, {});
      conversationId = created.body.data.id;
    });

    it("should store a message without generating a reply", async () => {
      const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, token, {
        content: "Remind me to review chapter 4",
        generateReply: false,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.message.role).toBe("USER");
      expect(res.body.data.reply).toBeNull();
    });

    it("should return 503 AI_PROVIDER_NOT_CONFIGURED when generation is requested", async () => {
      const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, token, {
        content: "Explain recursion",
      });

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe("AI_PROVIDER_NOT_CONFIGURED");
    });

    it("should persist the submitted message even when generation is unavailable", async () => {
      await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, token, {
        content: "Explain sorting",
      });

      const stored = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/messages`, token);
      const contents = stored.body.data.map((m: { content: string }) => m.content);
      // The typed failure above must not erase what the student typed: the
      // question is stored before the provider is resolved, so the client can
      // reconcile its transcript and keep it on screen.
      expect(contents).toContain("Explain recursion");
      expect(contents).toContain("Explain sorting");
    });

    it("should reuse the stored message when the same unanswered question is retried", async () => {
      const before = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/messages`, token);
      const beforeCount = before.body.data.length;

      const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, token, {
        content: "Explain sorting",
      });
      expect(res.status).toBe(503);

      const after = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/messages`, token);
      // A retry is the same stored row, not a second copy of the question.
      expect(after.body.data.length).toBe(beforeCount);
      const copies = after.body.data.filter((m: { content: string }) => m.content === "Explain sorting");
      expect(copies).toHaveLength(1);
    });

    it("should list stored messages in order", async () => {
      const res = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/messages`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.map((m: { content: string }) => m.content)).toEqual([
        "Remind me to review chapter 4",
        "Explain recursion",
        "Explain sorting",
      ]);
    });

    it("should persist the question when an attached document cannot be extracted", async () => {
      const resource = await prisma.resource.create({
        data: {
          userId: userId,
          title: "corrupt.pdf",
          storageType: "UPLOAD",
          fileKey: "resources/corrupt.pdf",
          fileName: "corrupt.pdf",
          fileSize: 10,
          mimeType: "application/pdf",
          resourceType: "PDF",
        },
      });
      // A file that passed upload validation can still be unreadable. The
      // extractor throwing must degrade to an inline note, never discard the
      // student's turn.
      const getContent = vi
        .spyOn(resourcesService, "getContent")
        .mockRejectedValue(new DocumentExtractionError("Failed to extract text from PDF"));
      try {
        const res = await authRequestJson("post", `${BASE}/ai/conversations/${conversationId}/messages`, token, {
          content: "Summarise this",
          attachmentIds: [resource.id],
        });
        // Generation still fails (no provider), but not because of the file.
        expect(res.status).toBe(503);

        const stored = await authRequestJson("get", `${BASE}/ai/conversations/${conversationId}/messages`, token);
        const contents = stored.body.data.map((m: { content: string }) => m.content);
        expect(contents).toContain("Summarise this");
      } finally {
        getContent.mockRestore();
      }
    });
  });

  describe("Study plans", () => {
    it("should create a study plan with entries", async () => {
      const res = await authRequestJson("post", `${BASE}/ai/study-plans`, token, {
        title: "DB Exam Prep",
        courseId,
        examDate: "2034-12-01T00:00:00.000Z",
        entries: [
          { dayNumber: 1, title: "Chapter 1-2", durationMinutes: 60 },
          { dayNumber: 2, title: "Practice problems", durationMinutes: 90 },
        ],
      });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe("DB Exam Prep");
      expect(res.body.data.entries).toHaveLength(2);
      expect(res.body.data.entries[0].dayNumber).toBe(1);
    });

    it("should reject a study plan linked to another user's course", async () => {
      const res = await authRequestJson("post", `${BASE}/ai/study-plans`, token, {
        title: "Ghost plan",
        courseId: "cuid_ghostcourse",
      });

      expect(res.status).toBe(404);
    });

    it("should get, list, and update a study plan", async () => {
      const created = await authRequestJson("post", `${BASE}/ai/study-plans`, token, {
        title: "Math Prep",
      });

      const got = await authRequestJson("get", `${BASE}/ai/study-plans/${created.body.data.id}`, token);
      expect(got.status).toBe(200);
      expect(got.body.data.title).toBe("Math Prep");

      const list = await authRequestJson("get", `${BASE}/ai/study-plans`, token);
      expect(list.status).toBe(200);
      expect(list.body.data.items.length).toBeGreaterThan(0);

      const updated = await authRequestJson("patch", `${BASE}/ai/study-plans/${created.body.data.id}`, token, {
        title: "Math Prep v2",
      });
      expect(updated.status).toBe(200);
      expect(updated.body.data.title).toBe("Math Prep v2");
    });

    it("should update a study plan entry status", async () => {
      const created = await authRequestJson("post", `${BASE}/ai/study-plans`, token, {
        title: "Physics Prep",
        entries: [{ dayNumber: 1, title: "Kinematics", durationMinutes: 45 }],
      });
      const entryId = created.body.data.entries[0].id;

      const res = await authRequestJson(
        "patch",
        `${BASE}/ai/study-plans/${created.body.data.id}/entries/${entryId}`,
        token,
        { status: "COMPLETED" },
      );

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
    });

    it("should delete a study plan", async () => {
      const created = await authRequestJson("post", `${BASE}/ai/study-plans`, token, {
        title: "Doomed plan",
      });

      const res = await authRequestJson("delete", `${BASE}/ai/study-plans/${created.body.data.id}`, token);
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });
  });

  describe("Cross-user isolation", () => {
    it("should not expose another user's conversation", async () => {
      const other = await registerAndLogin("ai-other@test.com", "Pass123!");

      const mine = await authRequestJson("post", `${BASE}/ai/conversations`, token, {});

      const res = await authRequestJson("get", `${BASE}/ai/conversations/${mine.body.data.id}`, other.token);
      expect(res.status).toBe(404);
    });
  });
});