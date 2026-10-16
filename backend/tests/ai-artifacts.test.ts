import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { app } from "@/app";
import request from "supertest";
import { registerAndLogin, authRequestJson, prisma } from "./helpers";
import { LocalDiskStorage, setFileStorage } from "@/services/storage";
import { confirmationStore } from "@/services/ai/confirmations";
import { executeTool } from "@/services/ai/tools/registry";
import { verifyExecutedAction } from "@/services/ai/tools/verify";
import { artifactsService } from "@/services/ai/artifacts";
import type { ProposedAction } from "@/services/ai/tools/types";

// ─────────────────────────────────────────────────────────────────────────────
// Generated files (artifacts)
// ─────────────────────────────────────────────────────────────────────────────
//
// The assistant can save a generated document as a real file: a `Resource`
// holds the bytes and an `AiArtifact` links it to the conversation and the
// reply. These tests cover the confirmation gate, the content verification,
// the REST confirm path that links the file to the assistant message, and the
// owner-scoped download.

const BASE = "/api/v1";

let userA: { token: string; id: string };
let userB: { token: string; id: string };
let storageRoot = "";

const CONTENT = "# Chapter 9 — Normalisation\n\n1. 1NF\n2. 2NF\n3. 3NF\n";

function artifactAction(overrides: Partial<{ name: string; content: string }> = {}): ProposedAction {
  return {
    tool: "create_artifact",
    description: "Save study guide",
    arguments: {
      name: overrides.name ?? "Chapter 9 study guide",
      content: overrides.content ?? CONTENT,
    },
  };
}

beforeAll(async () => {
  storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tutor-walle-artifacts-"));
  setFileStorage(new LocalDiskStorage(storageRoot));

  const a = await registerAndLogin(`artifacts-a@test.com`, "Pass123!");
  const b = await registerAndLogin(`artifacts-b@test.com`, "Pass123!");
  userA = { token: a.token, id: a.user.id };
  userB = { token: b.token, id: b.user.id };
});

afterAll(async () => {
  setFileStorage(null);
  await fs.rm(storageRoot, { recursive: true, force: true });
});

beforeEach(() => {
  confirmationStore.reset();
});

async function newConversation(token: string): Promise<string> {
  const created = await authRequestJson("post", `${BASE}/ai/conversations`, token, { title: "Files" });
  return created.body.data.id as string;
}

describe("create_artifact: the confirmation gate", () => {
  it("refuses to save a file until the student confirms", async () => {
    const conversationId = await newConversation(userA.token);

    const result = await executeTool(
      { name: "create_artifact", arguments: { name: "Draft guide", content: CONTENT } },
      { userId: userA.id, conversationId, approvedActions: null },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("confirmation_required");
    expect(result.proposedActions).toHaveLength(1);
    expect(result.proposedActions?.[0].tool).toBe("create_artifact");

    // Nothing was written: no file, no artifact row.
    expect(await prisma.resource.count({ where: { userId: userA.id } })).toBe(0);
    expect(await prisma.aiArtifact.count({ where: { userId: userA.id } })).toBe(0);
  });

  it("saves a real file and records it once approved", async () => {
    const conversationId = await newConversation(userA.token);
    const action = artifactAction();

    const result = await executeTool(
      { name: "create_artifact", arguments: action.arguments },
      { userId: userA.id, conversationId, approvedActions: [action] },
    );

    expect(result.ok).toBe(true);
    const data = result.data as { id: string; name: string; size: number };
    expect(data.id).toBeTruthy();
    expect(data.size).toBe(Buffer.byteLength(CONTENT));

    const artifact = await artifactsService.get(userA.id, data.id);
    expect(artifact.name).toBe("Chapter 9 study guide");
    expect(artifact.conversationId).toBe(conversationId);
    expect(artifact.messageId).toBeNull();

    // The bytes really landed in storage and read back byte-for-byte.
    const { text } = await artifactsService.readText(userA.id, data.id);
    expect(text).toBe(CONTENT);
  });
});

describe("create_artifact: verification", () => {
  it("verifies the stored content against what was approved", async () => {
    const conversationId = await newConversation(userA.token);
    const action = artifactAction();

    const result = await executeTool(
      { name: "create_artifact", arguments: action.arguments },
      { userId: userA.id, conversationId, approvedActions: [action] },
    );

    const verification = await verifyExecutedAction(
      userA.id,
      "create_artifact",
      action.arguments,
      result.data,
    );
    expect(verification.verified).toBe(true);
  });

  it("does not verify when the stored content differs from the approved content", async () => {
    const conversationId = await newConversation(userA.token);
    const action = artifactAction();

    const result = await executeTool(
      { name: "create_artifact", arguments: action.arguments },
      { userId: userA.id, conversationId, approvedActions: [action] },
    );

    const verification = await verifyExecutedAction(
      userA.id,
      "create_artifact",
      { name: action.arguments.name, content: "something else entirely" },
      result.data,
    );
    expect(verification.verified).toBe(false);
    expect(verification.message).toContain("content");
  });

  it("never verifies an artifact belonging to another student", async () => {
    const conversationId = await newConversation(userA.token);
    const action = artifactAction();
    const result = await executeTool(
      { name: "create_artifact", arguments: action.arguments },
      { userId: userA.id, conversationId, approvedActions: [action] },
    );

    const verification = await verifyExecutedAction(
      userB.id,
      "create_artifact",
      action.arguments,
      result.data,
    );
    expect(verification.verified).toBe(false);
  });
});

describe("create_artifact: REST confirm links the file to the reply", () => {
  it("returns the artifact on the confirm reply, the message list and the download", async () => {
    const conversationId = await newConversation(userA.token);
    confirmationStore.create({
      userId: userA.id,
      conversationId,
      title: "Save the guide",
      actions: [artifactAction()],
    });

    const pending = await authRequestJson(
      "get",
      `${BASE}/ai/conversations/${conversationId}/pending-action`,
      userA.token,
    );
    const actionId = pending.body.data.pendingAction.id as string;

    const confirmed = await authRequestJson(
      "post",
      `${BASE}/ai/conversations/${conversationId}/pending-action/${actionId}/confirm`,
      userA.token,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe("EXECUTED");
    expect(confirmed.body.data.artifacts).toHaveLength(1);

    const artifact = confirmed.body.data.artifacts[0] as { id: string; messageId: string; name: string };
    expect(artifact.name).toBe("Chapter 9 study guide");
    expect(artifact.messageId).toBe(confirmed.body.data.reply.id);

    // The reply itself carries the artifact, so the chat can render the chip.
    expect(confirmed.body.data.reply.artifacts).toHaveLength(1);

    // A reload shows it attached to the same message.
    const messages = await authRequestJson(
      "get",
      `${BASE}/ai/conversations/${conversationId}/messages`,
      userA.token,
    );
    const reply = (messages.body.data as Array<{ id: string; artifacts: unknown[] }>).find(
      (m) => m.id === confirmed.body.data.reply.id,
    );
    expect(reply?.artifacts).toHaveLength(1);

    // The conversation "Files" list returns it.
    const listed = await authRequestJson(
      "get",
      `${BASE}/ai/conversations/${conversationId}/artifacts`,
      userA.token,
    );
    expect(listed.body.data.artifacts).toHaveLength(1);

    // And the bytes download back as the generated text.
    const download = await request(app)
      .get(`${BASE}/ai/artifacts/${artifact.id}/download`)
      .set("Authorization", `Bearer ${userA.token}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(Buffer.from(download.body).toString("utf8")).toBe(CONTENT);
    expect(download.headers["content-disposition"]).toContain("attachment");
  });

  it("hides another student's artifact from the download and the list", async () => {
    const conversationId = await newConversation(userA.token);
    const artifact = await artifactsService.createFromText(userA.id, conversationId, {
      name: "Private guide",
      content: CONTENT,
    });

    const download = await request(app)
      .get(`${BASE}/ai/artifacts/${artifact.id}/download`)
      .set("Authorization", `Bearer ${userB.token}`);
    expect(download.status).toBe(404);

    const list = await authRequestJson(
      "get",
      `${BASE}/ai/conversations/${conversationId}/artifacts`,
      userB.token,
    );
    expect(list.status).toBe(404);
  });
});
