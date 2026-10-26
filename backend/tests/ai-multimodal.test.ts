// ─────────────────────────────────────────────────────────────────────
// Multimodal turns: an image-only model must not fail the whole question
// (the turn retries without images and answers honestly), and a follow-up
// question must still see material attached to an earlier message.
// ─────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/services/ai-connections", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/services/ai-connections")>();
  return { ...mod, getActiveUserConnection: vi.fn() };
});

import { registerAndLogin, authRequestJson } from "./helpers";
import { getActiveUserConnection } from "@/services/ai-connections";
import { resourcesService } from "@/services/resources";
import { aiService } from "@/services/ai/service";
import { confirmationStore } from "@/services/ai/confirmations";
import { createMessageSchema } from "@/schemas/ai";

const BASE = "/api/v1";

let user: { token: string; id: string };
let seedCounter = 0;

function textTurn(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    }),
    text: async () => "",
  } as unknown as Response;
}

function visionErrorResponse(): Response {
  return {
    ok: false,
    status: 400,
    json: async () => ({}),
    text: async () => JSON.stringify({ error: { message: "This model does not support image_url content parts" } }),
  } as unknown as Response;
}

async function seedStudent() {
  seedCounter += 1;
  const auth = await registerAndLogin(`multimodal-${seedCounter}@test.com`, "Pass123!");
  return { token: auth.token, id: auth.user.id };
}

function useFakeConnection() {
  vi.mocked(getActiveUserConnection).mockImplementation(async () => ({
    provider: "openai" as const,
    decryptedCredentials: { apiKey: "sk-test" },
    endpoint: "https://p.test",
    model: "test-model",
  }));
}

async function newConversation() {
  const res = await authRequestJson("post", `${BASE}/ai/conversations`, user.token, { title: "Multimodal" });
  return res.body.data.id as string;
}

function imageResource(id: string) {
  const timestamp = new Date(0).toISOString();
  return {
    id,
    courseId: null,
    title: "chart.png",
    description: null,
    url: null,
    storageType: "UPLOAD",
    fileKey: `resources/user/${id}/chart.png`,
    fileName: "chart.png",
    fileSize: 4,
    mimeType: "image/png",
    resourceType: "OTHER",
    createdAt: timestamp,
    updatedAt: timestamp,
    course: null,
  };
}

function docResource(id: string) {
  const timestamp = new Date(0).toISOString();
  return {
    id,
    courseId: null,
    title: "syllabus.txt",
    description: null,
    url: null,
    storageType: "UPLOAD",
    fileKey: `resources/user/${id}/syllabus.txt`,
    fileName: "syllabus.txt",
    fileSize: 4,
    mimeType: "text/plain",
    resourceType: "OTHER",
    createdAt: timestamp,
    updatedAt: timestamp,
    course: null,
  };
}

beforeEach(async () => {
  confirmationStore.reset();
  const seeded = await seedStudent();
  user = { token: seeded.token, id: seeded.id };
  useFakeConnection();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("multimodal turns", () => {
  it("retries without images when the model cannot analyze them, and answers honestly", async () => {
    vi.spyOn(resourcesService, "getById").mockResolvedValue(imageResource("img-1") as never);
    vi.spyOn(resourcesService, "getDownload").mockResolvedValue({
      buffer: Buffer.from("image"),
      mimeType: "image/png",
      fileName: "chart.png",
    });

    const bodies: string[] = [];
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      bodies.push(String(init?.body ?? ""));
      if (call === 1) return visionErrorResponse();
      return textTurn("I couldn't read the image, but I can still help with your question.");
    });
    vi.stubGlobal("fetch", fetchMock);

    const conversationId = await newConversation();
    const input = createMessageSchema.parse({ content: "What is in this chart?", attachmentIds: ["img-1"] });
    const result = await aiService.addMessage(user.id, conversationId, input);

    expect(call).toBe(2);
    expect(result.reply?.content).toContain("couldn't read the image");
    // The first attempt carried the image; the retry did not.
    expect(bodies[0]).toContain("image_url");
    expect(bodies[1]).not.toContain("image_url");
    expect(bodies[1]).toContain("cannot analyze images");
  });

  it("carries earlier attachment material into a follow-up question", async () => {
    vi.spyOn(resourcesService, "getById").mockResolvedValue(docResource("doc-1") as never);
    vi.spyOn(resourcesService, "getContent").mockResolvedValue({
      pages: [{ pageNumber: 1, text: "Syllabus: the DB301 exam is on 14 November." }],
      fullText: "Syllabus: the DB301 exam is on 14 November.",
      pageCount: 1,
      charCount: 43,
      format: "txt",
    });

    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return textTurn("Noted.");
    });
    vi.stubGlobal("fetch", fetchMock);

    const conversationId = await newConversation();

    const first = createMessageSchema.parse({ content: "Here is my syllabus.", attachmentIds: ["doc-1"] });
    await aiService.addMessage(user.id, conversationId, first);

    // A small gap keeps the two messages strictly ordered by creation time.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = createMessageSchema.parse({ content: "When is the exam again?" });
    await aiService.addMessage(user.id, conversationId, second);

    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain("PREVIOUS MATERIAL");
    expect(bodies[1]).toContain("the DB301 exam is on 14 November");
  });
});
