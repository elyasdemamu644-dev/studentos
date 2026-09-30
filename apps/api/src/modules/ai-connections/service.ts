import { encryptForUser, decryptForUser } from "@/lib/encryption";
import { prisma } from "@/lib/prisma";
import {
  type AiConnectionResponse,
  type TestConnectionResult,
  CreateAiConnectionSchema,
  UpdateAiConnectionSchema,
  TestConnectionInputSchema,
  AiConnectionResponseSchema,
} from "./schema";
import type { CreateAiConnectionInput, UpdateAiConnectionInput, TestConnectionInput, AiProviderName } from "./schema";
import type { ProviderCredentials } from "@/modules/ai/provider";
import assert from "node:assert";

function toResponse(record: {
  id: string;
  provider: string;
  model: string | null;
  endpoint: string | null;
  enabled: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): AiConnectionResponse {
  return {
    id: record.id,
    provider: record.provider as AiConnectionResponse["provider"],
    model: record.model,
    endpoint: record.endpoint,
    enabled: record.enabled,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Strip credential-like material out of a provider error message before it is
 * handed back to the client. Providers echo the offending key in their error
 * text, so this must run on every path that can carry provider output —
 * not just on thrown exceptions.
 */
function sanitizeMessage(message: string): string {
  return message
    .replace(/(api[\s_-]?key|key|secret|token|password)\s*[=:]?\s*\S+/gi, "$1:[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
}

export { sanitizeMessage };

/**
 * Normalise a provider result into the public TestConnectionResult shape.
 * Provider adapters report the failure detail in `message`; callers read
 * `error`, so the detail is mirrored into both.
 */
function toTestResult(
  result: { success: boolean; message?: string; model?: string | null }
): TestConnectionResult {
  const message = sanitizeMessage(result.message ?? "");
  return {
    success: result.success,
    message,
    model: result.model ?? null,
    error: result.success ? null : message,
  };
}

// ── Create ─────────────────────────────────────────────────────────────────────

export async function createConnection(
  userId: string,
  input: CreateAiConnectionInput
): Promise<AiConnectionResponse> {
  const data = CreateAiConnectionSchema.parse(input);
  // `credentialsEncrypted` is a non-nullable column. Credential-free providers
  // (ollama) legitimately have no key, so they store an encrypted empty string
  // rather than a sentinel; `parseProviderCredentials("")` yields `{}`.
  const encryptedCredentials = encryptForUser(userId, data.credentials ?? "");

  const record = await prisma.aiConnection.create({
    data: {
      userId,
      provider: data.provider,
      model: data.model,
      endpoint: data.endpoint,
      credentialsEncrypted: encryptedCredentials,
      enabled: true,
      isActive: false,
    },
  });

  return toResponse(record);
}

// ── List ───────────────────────────────────────────────────────────────────────

export async function listConnections(
  userId: string,
  limit = 50,
  cursor?: string
): Promise<{ items: AiConnectionResponse[]; hasMore: boolean; nextCursor: string | null }> {
  const take = limit + 1;
  const records = await prisma.aiConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    cursor: cursor ? { id: cursor }  : undefined,
    skip: cursor ? 1 : 0,
  });

  const hasMore = records.length > limit;
  const items = records.slice(0, limit).map(toResponse);

  return { items, hasMore, nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null };
}

// ── Get single ────────────────────────────────────────────────────────────────

export async function getConnection(
  id: string,
  userId: string
): Promise<AiConnectionResponse> {
  const record = await prisma.aiConnection.findFirst({
    where: { id, userId },
  });

  if (!record) {
    const { NotFoundError } = await import("@/config/errors");
    throw new NotFoundError("AI connection not found");
  }

  return toResponse(record);
}

// ── Update ─────────────────────────────────────────────────────────────────────

export async function updateConnection(
  id: string,
  userId: string,
  input: UpdateAiConnectionInput
): Promise<AiConnectionResponse> {
  const data = UpdateAiConnectionSchema.parse(input);

  const existing = await prisma.aiConnection.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    const { NotFoundError } = await import("@/config/errors");
    throw new NotFoundError("AI connection not found");
  }

  // `credentials` is an API-level field, not a column — it must be mapped onto
  // `credentialsEncrypted` and never spread into the Prisma payload directly.
  const { credentials, ...fields } = data;
  const credentialsEncrypted =
    credentials !== undefined
      ? encryptForUser(userId, credentials)
      : existing.credentialsEncrypted;

  // If activating, deactivate all other connections for this user first
  if (data.isActive === true) {
    await prisma.$transaction([
      prisma.aiConnection.updateMany({
        where: { userId, id: { not: id } },
        data: { isActive: false },
      }),
      prisma.aiConnection.update({
        where: { id, userId },
        data: { ...fields, credentialsEncrypted },
      }),
    ]);
  } else {
    const record = await prisma.aiConnection.update({
      where: { id, userId },
      data: { ...fields, credentialsEncrypted },
    });
    return toResponse(record);
  }

  const record = await prisma.aiConnection.findFirst({
    where: { id, userId },
  });
  return toResponse(record!);
}

// ── Delete ─────────────────────────────────────────────────────────────────────

export async function deleteConnection(
  id: string,
  userId: string
): Promise<void> {
  const existing = await prisma.aiConnection.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    const { NotFoundError } = await import("@/config/errors");
    throw new NotFoundError("AI connection not found");
  }

  await prisma.aiConnection.delete({
    where: { id, userId },
  });
}

// ── Test ───────────────────────────────────────────────────────────────────────

export async function testConnection(
  userId: string,
  input: TestConnectionInput,
  connectionId?: string
): Promise<TestConnectionResult> {
  let credentials: string | undefined;
  let provider: AiProviderName;
  let model: string | null;
  let endpoint: string | null;

  try {
    if (connectionId) {
      const record = await prisma.aiConnection.findFirst({
        where: { id: connectionId, userId },
      });
      if (!record) {
        const { NotFoundError } = await import("@/config/errors");
        throw new NotFoundError("AI connection not found");
      }
      credentials = decryptForUser(userId, record.credentialsEncrypted);
      provider = record.provider as AiProviderName;
      model = record.model;
      endpoint = record.endpoint;
    } else {
      const data = TestConnectionInputSchema.parse(input);
      credentials = data.credentials;
      provider = data.provider;
      model = data.model ?? null;
      endpoint = data.endpoint ?? null;
    }

    // Resolve provider adapter and test. The adapter expects a parsed
    // credentials object, not the raw stored string.
    const { testConnection: testProvider, parseProviderCredentials } =
      await import("@/modules/ai/provider");
    const result = await testProvider(
      provider,
      parseProviderCredentials(credentials),
      endpoint ?? undefined
    );
    return toTestResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed";
    return {
      success: false,
      message: "Connection test failed",
      model: null,
      error: sanitizeMessage(message),
    };
  } finally {
    // Clear credentials from memory
    credentials = undefined;
  }
}

// ── Active ─────────────────────────────────────────────────────────────────────

export async function getActiveConnection(
  userId: string
): Promise<AiConnectionResponse | null> {
  const record = await prisma.aiConnection.findFirst({
    where: { userId, isActive: true, enabled: true },
  });

  return record ? toResponse(record) : null;
}

// ── Set active ────────────────────────────────────────────────────────────────

export async function setActiveConnection(
  id: string,
  userId: string
): Promise<AiConnectionResponse> {
  const existing = await prisma.aiConnection.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    const { NotFoundError } = await import("@/config/errors");
    throw new NotFoundError("AI connection not found");
  }

  await prisma.$transaction([
    prisma.aiConnection.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    }),
    prisma.aiConnection.update({
      where: { id, userId },
      data: { isActive: true },
    }),
  ]);

  const record = await prisma.aiConnection.findFirst({
    where: { id, userId },
  });
  return toResponse(record!);
}

// ── Resolve ────────────────────────────────────────────────────────────────────

/**
 * Resolve the user's active connection for the AI runtime.
 *
 * This is the only path in the service that hands back *decrypted* credential
 * material, and it is deliberately not exposed over HTTP: `getActiveConnection`
 * and the route responses go through `toResponse`, which never includes
 * credentials. Callers must treat the returned credentials as secret.
 *
 * Returns `null` when the user has no active, enabled connection.
 */
export async function getActiveUserConnection(
  userId: string
): Promise<{
  provider: AiProviderName;
  decryptedCredentials: ProviderCredentials;
  endpoint: string | null;
  model: string | null;
} | null> {
  const record = await prisma.aiConnection.findFirst({
    where: { userId, isActive: true, enabled: true },
  });

  if (!record) {
    return null;
  }

  // Dynamic import mirrors the pattern used by `testConnection` and keeps the
  // ai <-> ai-connections modules free of a static import cycle.
  const { parseProviderCredentials } = await import("@/modules/ai/provider");

  return {
    provider: record.provider as AiProviderName,
    decryptedCredentials: parseProviderCredentials(
      decryptForUser(userId, record.credentialsEncrypted)
    ),
    endpoint: record.endpoint,
    model: record.model,
  };
}

/** Redact credential material from a parsed ProviderCredentials object into a safe
 * string suitable for logging/return.  Never exposes raw keys/secrets. */
function maskProviderCredentials(creds: ProviderCredentials): string {
  if (!creds || typeof creds !== "object") return "[REDACTED]";
  // Credentials are arbitrary user-supplied JSON cast to `ProviderCredentials`,
  // so extra secret-ish keys (password/portal/orgId) can be present even though
  // the interface does not declare them. Mask them without widening the contract.
  const extra = creds as ProviderCredentials & Record<string, unknown>;
  const parts: string[] = [];
  if (creds.apiKey) parts.push("apiKey:[REDACTED]");
  if (creds.accessToken) parts.push("accessToken:[REDACTED]");
  if (extra.password) parts.push("password:[REDACTED]");
  if (creds.apiKeyField) parts.push(`apiKeyField:${creds.apiKeyField}`);
  if (extra.portal) parts.push(`portal:${extra.portal}`);
  if (extra.orgId) parts.push(`orgId:${extra.orgId}`);
  return parts.length > 0 ? parts.join(" ") : "[REDACTED]";
}

export async function resolveUserConnection(userId: string): Promise<{
  provider: string;
  model: string | null;
  endpoint: string | null;
  credentials: string;
} | null> {
  const record = await prisma.aiConnection.findFirst({
    where: { userId, isActive: true, enabled: true },
  });

  if (!record) {
    return null;
  }

  const decrypted = decryptForUser(userId, record.credentialsEncrypted);
  const { parseProviderCredentials } = await import("@/modules/ai/provider");
  const masked = maskProviderCredentials(parseProviderCredentials(decrypted));
  return {
    provider: record.provider,
    model: record.model,
    endpoint: record.endpoint,
    credentials: masked,
  };
}