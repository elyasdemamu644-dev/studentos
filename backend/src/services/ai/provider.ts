// ──────────────────────────────────────────────────────────────────────────────
// AI Provider — OpenAI-compatible adapter layer
// ──────────────────────────────────────────────────────────────────────────────
// Supports: OpenAI, Gemini, Anthropic, OpenRouter, Ollama/local, custom OpenAI-
// compatible endpoints.  All providers share a minimal OpenAI-style REST contract
// (POST /chat/completions with streaming support) OR have small adapters for
// provider-specific formats.  Credential handling is in ai-connections service;
// this module only deals with raw keys/endpoints passed to it for resolution and
// connectivity testing.
//

import { ApiError } from "@/config/errors";
import { config } from "@/config";
import { isCredentialFreeProvider } from "@/schemas/ai-connections";
import {
  assertSafeOutboundUrl,
  isStructurallyValidEndpoint,
  SsrfBlockedError,
  type SsrfPolicy,
} from "@/utils/ssrf-guard";
import { outboundFetch, OutboundNetworkError } from "@/utils/safe-fetch";
import type { ProviderToolSchema } from "./tools/types";


// ────────────────────────────────────────────────────────────────
// 1. Types
// ────────────────────────────────────────────────────────────────

export type AiProviderName =
  | "openai"
  | "gemini"
  | "anthropic"
  | "openrouter"
  | "ollama"
  | "custom";

export interface ProviderCredentials {
  apiKey?: string;
  accessToken?: string;
  // custom/openai-compatible fields
  apiKeyField?: string; // which field in the credentials JSON holds the key
}

export interface ProviderEndpoint {
  baseUrl: string;
  // Overrides for path prefixes etc.
  chatCompletionsPath?: string;
}

export interface ResolveAiProviderResult {
  provider: AiProviderName;
  adapter: AiProviderAdapter;
  model: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  model?: string;
  error?: string;
}

// ────────────────────────────────────────────────────────────────
// 2. Provider adapter interface
// ────────────────────────────────────────────────────────────────

export interface AiProviderAdapter {
  readonly name: AiProviderName;
  readonly defaultModel: string;
  /**
   * Whether this adapter's wire format can carry native function/tool calls.
   *
   * OpenAI-compatible endpoints and Ollama can. Gemini and Anthropic use
   * different tool schemas, so the agent runs its legacy grounded single-shot
   * path for them instead of pretending a tool call happened.
   */
  readonly supportsNativeTools: boolean;
  /** Returns a configured fetch-like function that sends a chat completions request. */
  createClient(credentials: ProviderCredentials, endpoint?: string): AiChatClient;
  /** Lightweight connectivity test — does not need a full chat completions call. */
  testConnection(credentials: ProviderCredentials, endpoint?: string): Promise<TestConnectionResult>;
}

export interface AiChatClient {
  /** POST /chat/completions (or provider equivalent). */
  chatCompletions(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

/** A model request to run one of our tools, in OpenAI function-call form. */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  /** `null` for an assistant turn that only carries tool calls. */
  content: string | ChatMessageContentPart[] | null;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  name?: string;
}

function decodeImageDataUrl(url: string): { mimeType: string; data: string } {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match) throw new AiProviderError("The attached image could not be processed");
  return { mimeType: match[1], data: match[2] };
}

export type ToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /** Function-calling schemas. Omitted entirely on the legacy no-tools path. */
  tools?: ProviderToolSchema[];
  toolChoice?: ToolChoice;
  /** Cancels this provider request when the student stops generation. */
  signal?: AbortSignal;
}

/**
 * Convert the internal camelCase `ChatMessage` into the OpenAI wire shape.
 *
 * The agent speaks `toolCalls`/`toolCallId`, but the API only understands
 * `tool_calls`/`tool_call_id`. Passing the message object straight through drops
 * both, and every follow-up round fails with
 * `tool messages must include a non-empty string tool_call_id`.
 */
function toWireMessage(message: ChatMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content };

  if (message.toolCalls && message.toolCalls.length > 0) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: call.type,
      function: { name: call.function.name, arguments: call.function.arguments },
    }));
  }
  // A tool result is meaningless to the provider without the id it answers.
  if (message.role === "tool") {
    wire.tool_call_id = message.toolCallId ?? "";
    if (message.name) wire.name = message.name;
  }
  return wire;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null; tool_calls?: ChatToolCall[] };
    finishReason: string;
  }>;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ────────────────────────────────────────────────────────────────
// 3. Shared helpers
// ────────────────────────────────────────────────────────────────

function getAuthHeader(credentials: ProviderCredentials): string | null {
  if (credentials.apiKey) return `Bearer ${credentials.apiKey}`;
  if (credentials.accessToken) return `Bearer ${credentials.accessToken}`;
  return null;
}

/**
 * Turn a stored credentials string into a ProviderCredentials object.
 *
 * Credentials are persisted as an opaque string (typically JSON), but the
 * adapters read `credentials.apiKey` / `credentials.accessToken` as object
 * properties — so the string must be parsed before it is handed to them.
 * A bare (non-JSON) string is treated as the API key itself.
 */
export function parseProviderCredentials(
  raw: string | null | undefined
): ProviderCredentials {
  if (!raw) return {};

  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as ProviderCredentials;
      }
    } catch {
      // Not valid JSON — fall through and treat the raw value as the key.
    }
  }

  return { apiKey: raw };
}

function getBaseUrl(endpoint?: string): string {
  if (endpoint) return endpoint.replace(/\/+$/, "");
  return "https://api.openai.com";
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

class ProviderHttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

/**
 * `fetch` with a hard deadline.
 *
 * A provider that stalls — a flaky upstream, a local Ollama that never answers —
 * must not pin a request open forever. The timer aborts the underlying request
 * (the `AbortController` is supported by Node's global fetch and by every
 * OpenAI-compatible/Gemini/Anthropic endpoint we target), and the abort is
 * translated into a controlled {@link AiProviderTimeoutError} so callers get a
 * retryable 504 instead of an opaque abort. The timer is always cleared.
 */
/**
 * Test seam for the SSRF policy. Production code always uses
 * `config.aiAllowPrivateEndpoints`; tests inject a resolver so the strict
 * (production-like) path can be exercised without live DNS.
 */
let ssrfPolicyOverride: SsrfPolicy | undefined;

export function setSsrfPolicyForTests(policy: SsrfPolicy | undefined): void {
  ssrfPolicyOverride = policy;
}

function activeSsrfPolicy(): SsrfPolicy {
  return ssrfPolicyOverride ?? {
    allowPrivate: config.aiAllowPrivateEndpoints,
    ...(config.isProduction ? { allowedHosts: config.egressAllowedHosts } : {}),
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = config.aiRequestTimeoutMs
): Promise<Response> {
  // Fail fast: enforce the SSRF policy once per request, before the retry loop,
  // so a blocked endpoint is never retried. The transport below (see
  // `utils/safe-fetch.ts`) independently re-resolves the host and pins the
  // connection to the validated address, so even a rebinding resolver cannot
  // redirect the socket to a private destination. A 3xx response is treated as a
  // failure rather than followed, removing the redirect-based bypass.
  await assertSafeOutboundUrl(url, activeSsrfPolicy());

  const maxNetworkRetries = 2;
  const externalSignal = init.signal;
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) throw new AiProviderCancelledError();
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let retryNetworkFailure = false;
    try {
      // The transport pins the connection to the addresses the SSRF policy
      // validated, so a rebinding resolver cannot swap a public answer for a
      // private one between validation and connect.
      const res = await outboundFetch(
        url,
        { ...init, redirect: "manual", signal: controller.signal },
        { policy: activeSsrfPolicy(), maxBytes: config.aiMaxResponseBytes },
      );
      if (res.status >= 300 && res.status < 400) {
        throw new SsrfBlockedError(
          "The AI provider endpoint returned a redirect, which is not allowed",
        );
      }
      const contentLength = Number(res.headers?.get?.("content-length") ?? "");
      if (Number.isFinite(contentLength) && contentLength > config.aiMaxResponseBytes) {
        throw new AiProviderError("The AI provider response was too large to process");
      }
      return res;
    } catch (err) {
      if (externalSignal?.aborted) throw new AiProviderCancelledError();
      if (timedOut) throw new AiProviderTimeoutError(timeoutMs);
      const retryable = err instanceof TypeError || err instanceof OutboundNetworkError;
      if (!retryable || attempt >= maxNetworkRetries) throw err;
      retryNetworkFailure = true;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    }
    if (retryNetworkFailure) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

function parseModelFromError(body: unknown): string {
  if (typeof body === "object" && body) {
    const b = body as Record<string, unknown>;
    if (typeof b.error === "object" && b.error) {
      const e = b.error as Record<string, unknown>;
      if (typeof e.message === "string") return e.message;
      if (typeof e.message === "object" && e.message) {
        const msg = e.message as { message?: string };
        if (msg.message) return msg.message;
      }
    }
    if (typeof b.message === "string") return b.message;
  }
  return "Unknown provider error";
}

// ────────────────────────────────────────────────────────────────
// 4. OpenAI adapter (base for OpenAI, OpenRouter, custom, Ollama)
// ────────────────────────────────────────────────────────────────

const DEFAULT_OPENAI_MODEL = "gpt-4o";
const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";

export class OpenAiAdapter implements AiProviderAdapter {
  readonly name: AiProviderName;
  readonly defaultModel: string;
  /** OpenAI-compatible function calling — used for OpenAI, OpenRouter, custom. */
  readonly supportsNativeTools = true;
  private baseUrl: string;
  private chatPath: string;

  constructor(
    name: AiProviderName,
    defaultModel: string,
    baseUrl: string,
    chatPath: string = "/chat/completions"
  ) {
    this.name = name;
    this.defaultModel = defaultModel;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.chatPath = chatPath;
  }

  createClient(credentials: ProviderCredentials, endpoint?: string): AiChatClient {
    const base = endpoint ? endpoint.replace(/\/+$/, "") + this.chatPath : this.baseUrl + this.chatPath;
    const auth = getAuthHeader(credentials);

    return {
      chatCompletions: async (request) => {
        const body = {
          model: request.model,
          messages: request.messages.map(toWireMessage),
          temperature: request.temperature ?? 1,
          max_tokens: request.maxTokens,
          stream: request.stream ?? false,
          // Sent only when the caller has tools. Some OpenAI-compatible servers
          // reject an empty `tools` array, so the key is omitted entirely.
          ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
          ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
        };

        const res = await fetchWithTimeout(base, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: auth } : {}),
          },
          body: JSON.stringify(body),
          ...(request.signal ? { signal: request.signal } : {}),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new ProviderHttpError(res.status, text);
        }

        const json = (await res.json()) as ChatCompletionResponse & {
          error?: { message?: string } | string;
        };
        // OpenRouter answers **HTTP 200** with an in-body `error` and no
        // `choices` when a route fails upstream — e.g. a `:free` model whose
        // provider is overloaded. Returning that body unchanged made the
        // caller crash on `response.choices[0]` and showed the student
        // "Cannot read properties of undefined" instead of the real reason.
        if (json.error) {
          const message =
            typeof json.error === "string" ? json.error : json.error.message;
          const detail = message || "Provider returned an error";
          const lower = detail.toLowerCase();
          const status =
            /rate.?limit|too many requests/.test(lower) ? 429 :
            /quota|insufficient credit|payment required/.test(lower) ? 402 :
            /model.*(not found|unsupported|unavailable)|no endpoints found|does not support|unsupported.*(tool|image|parameter)|not support.*(tool|image|input)/.test(lower) ? 404 :
            502;
          throw new ProviderHttpError(status, detail);
        }
        if (!Array.isArray(json.choices)) {
          throw new Error("Provider response contained no choices");
        }
        return json;
      },
    };
  }

  testConnection = async (
    credentials: ProviderCredentials,
    endpoint?: string
  ): Promise<TestConnectionResult> => {
    const base = endpoint ? endpoint.replace(/\/+$/, "") + this.chatPath : this.baseUrl + this.chatPath;
    const auth = getAuthHeader(credentials);

    try {
      // Minimal chat completions call with a tiny model to test auth + connectivity
      const res = await fetchWithTimeout(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({
          model: this.defaultModel,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        let msg = text.slice(0, 500);
        // Try to extract model info from error
        try {
          const j = JSON.parse(text);
          if (j.error?.message) msg = j.error.message.slice(0, 500);
        } catch {
          /* use raw text */
        }
        return { success: false, message: `Connection failed: ${msg}` };
      }

      const json = (await res.json()) as { model?: string; id?: string; error?: { message?: string } };
      if (json.error) {
        return { success: false, message: json.error.message || "Provider returned an error" };
      }
      return { success: true, message: "Connection successful", model: json.model || this.defaultModel };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Connection error: ${msg}` };
    }
  };
}

// ────────────────────────────────────────────────────────────────
// 5. Gemini adapter
// ────────────────────────────────────────────────────────────────

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiAdapter implements AiProviderAdapter {
  readonly name: AiProviderName = "gemini";
  readonly defaultModel: string = DEFAULT_GEMINI_MODEL;
  // Gemini has a native function-calling API, but it uses a different schema
  // (functionDeclarations/functionCall). Rather than emulate OpenAI's shape, the
  // agent falls back to the grounded single-shot path for this provider.
  readonly supportsNativeTools = false;

  createClient(credentials: ProviderCredentials, endpoint?: string): AiChatClient {
    const apiKey = credentials.apiKey || credentials.accessToken;
    if (!apiKey) throw new Error("Gemini requires an API key");
    const base = endpoint
      ? endpoint.replace(/\/+$/, "")
      : `${GEMINI_BASE}/models`;

    return {
      chatCompletions: async (request) => {
        // Gemini uses a different API shape; map OpenAI-style to Gemini.
        // A `system` message is not a valid Gemini `contents` role, so pull it
        // out into the API's `systemInstruction` field (like Anthropic's adapter).
        const systemContent = request.messages.find((m) => m.role === "system")?.content;
        const systemPrompt = typeof systemContent === "string" ? systemContent : undefined;
        const contents = request.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : m.role,
            parts: typeof m.content === "string"
              ? [{ text: m.content }]
              : (m.content ?? []).map((part) => {
                  if (part.type === "text") return { text: part.text };
                  const image = decodeImageDataUrl(part.image_url.url);
                  return { inline_data: { mime_type: image.mimeType, data: image.data } };
                }),
          }));

        const url = `${base}/${request.model}/generateContent?key=${apiKey}`;
        const res = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
            contents,
            generationConfig: { temperature: request.temperature ?? 1, maxOutputTokens: request.maxTokens },
          }),
          ...(request.signal ? { signal: request.signal } : {}),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const json = (await res.json()) as { candidates?: Array<{ content?: { role?: string; parts?: Array<{ text?: string }> } }>; error?: { message?: string } };
        if (json.error) throw new Error(json.error.message || "Gemini API error");

        const candidate = json.candidates?.[0];
        const text =
          candidate?.content?.parts?.[0]?.text ??
          candidate?.content?.parts?.map((p) => p.text).join("") ??
          "";

        return {
          id: `gemini-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finishReason: text ? "stop" : "length" }],
        } as ChatCompletionResponse;
      },
    };
  };

  testConnection = async (
    credentials: ProviderCredentials,
    endpoint?: string
  ): Promise<TestConnectionResult> => {
    const apiKey = credentials.apiKey || credentials.accessToken;
    if (!apiKey) return { success: false, message: "Missing API key" };

    const model = this.defaultModel;
    const url = endpoint
      ? endpoint.replace(/\/+$/, "") + `/models/${model}/generateContent?key=${apiKey}`
      : `${GEMINI_BASE}/models/${model}/generateContent?key=${apiKey}`;

    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Hi" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return { success: false, message: `Connection failed: ${text.slice(0, 500)}` };
      }

      const json = (await res.json()) as { candidates?: unknown[]; error?: { message?: string } };
      if (json.error) return { success: false, message: json.error.message || "Gemini error" };
      if (!json.candidates || json.candidates.length === 0) return { success: false, message: "No response from Gemini" };

      return { success: true, message: "Connection successful", model };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Connection error: ${msg}` };
    }
  };
}

// ────────────────────────────────────────────────────────────────
// 6. Anthropic adapter
// ────────────────────────────────────────────────────────────────

const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";

export class AnthropicAdapter implements AiProviderAdapter {
  readonly name: AiProviderName = "anthropic";
  readonly defaultModel: string = DEFAULT_ANTHROPIC_MODEL;
  // Anthropic's tool API uses `tools`/`tool_use` blocks rather than OpenAI's
  // function-calling envelope, so this adapter reports no native tool support
  // and the agent uses the grounded single-shot path instead.
  readonly supportsNativeTools = false;

  createClient(credentials: ProviderCredentials, endpoint?: string): AiChatClient {
    const apiKey = credentials.apiKey;
    if (!apiKey) throw new Error("Anthropic requires an API key");
    const base = endpoint
      ? endpoint.replace(/\/+$/, "")
      : ANTHROPIC_BASE;

    return {
      chatCompletions: async (request) => {
        // Anthropic uses messages with role "user"/"assistant" but requires
        // system message as a separate field, not in the messages array.
        const systemMsg = request.messages.find((m) => m.role === "system");
        const messages = request.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role,
            content: typeof m.content === "string"
              ? m.content ?? ""
              : (m.content ?? []).map((part) => {
                  if (part.type === "text") return { type: "text", text: part.text };
                  const image = decodeImageDataUrl(part.image_url.url);
                  return {
                    type: "image",
                    source: { type: "base64", media_type: image.mimeType, data: image.data },
                  };
                }),
          }));

        const url = `${base}/messages`;
        const res = await fetchWithTimeout(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: request.model,
            max_tokens: request.maxTokens ?? 1024,
            temperature: request.temperature ?? 1,
            system: systemMsg?.content,
            messages,
          }),
          ...(request.signal ? { signal: request.signal } : {}),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const json = (await res.json()) as {
          id?: string;
          type?: string;
          content?: Array<{ type?: string; text?: string }>;
          error?: { message?: string };
        };

        if (json.error) throw new Error(json.error.message || "Anthropic error");

        const text = json.content?.map((c) => c.text).join("") ?? "";

        return {
          id: json.id ?? `anthropic-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finishReason: text ? "stop" : "length" }],
        } as ChatCompletionResponse;
      },
    };
  };

  testConnection = async (
    credentials: ProviderCredentials,
    endpoint?: string
  ): Promise<TestConnectionResult> => {
    const apiKey = credentials.apiKey;
    if (!apiKey) return { success: false, message: "Missing API key" };

    const base = endpoint ? endpoint.replace(/\/+$/, "") : ANTHROPIC_BASE;
    const url = `${base}/messages`;

    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.defaultModel,
          max_tokens: 1,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return { success: false, message: `Connection failed: ${text.slice(0, 500)}` };
      }

      const json = (await res.json()) as { id?: string; error?: { message?: string } };
      if (json.error) return { success: false, message: json.error.message || "Anthropic error" };

      return { success: true, message: "Connection successful", model: this.defaultModel };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Connection error: ${msg}` };
    }
  };
}

// ────────────────────────────────────────────────────────────────
// 7. Ollama adapter (local)
// ────────────────────────────────────────────────────────────────

/**
 * Normalise Ollama's `tool_calls` into the OpenAI shape the agent expects.
 *
 * Two differences matter: Ollama omits `id` on some versions, and it returns
 * `function.arguments` as a parsed *object* rather than a JSON string. The
 * agent and the registry both work on the string form, so re-serialise here.
 * Anything unrecognised is dropped rather than guessed at.
 */
function parseOllamaToolCalls(raw: unknown): ChatToolCall[] {
  if (!Array.isArray(raw)) return [];

  const calls: ChatToolCall[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const fn = (entry as { function?: unknown }).function;
    if (!fn || typeof fn !== "object") return;
    const { name, arguments: args } = fn as { name?: unknown; arguments?: unknown };
    if (typeof name !== "string" || name === "") return;

    let serialized: string;
    if (typeof args === "string") {
      serialized = args;
    } else if (args && typeof args === "object") {
      try {
        serialized = JSON.stringify(args);
      } catch {
        // Unserialisable arguments cannot be validated; "{}" makes the failure
        // surface as an argument error on our side instead of crashing here.
        serialized = "{}";
      }
    } else {
      serialized = "{}";
    }

    const id = typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id : `call_${index}`;
    calls.push({ id, type: "function", function: { name, arguments: serialized } });
  });

  return calls;
}

const DEFAULT_OLLAMA_MODEL = "llama3.2";
const OLLAMA_BASE = "http://localhost:11434";

export class OllamaAdapter implements AiProviderAdapter {
  readonly name: AiProviderName = "ollama";
  readonly defaultModel: string = DEFAULT_OLLAMA_MODEL;
  // Ollama's /api/chat accepts OpenAI-style `tools` and returns `tool_calls`.
  readonly supportsNativeTools = true;

  createClient(credentials: ProviderCredentials, endpoint?: string): AiChatClient {
    const base = (endpoint || OLLAMA_BASE).replace(/\/+$/, "");

    return {
      chatCompletions: async (request) => {
        const url = `${base}/api/chat`;
        const res = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages.map((message) => ({
              role: message.role,
              content: typeof message.content === "string"
                ? message.content
                : (message.content ?? [])
                    .filter((part): part is Extract<ChatMessageContentPart, { type: "text" }> =>
                      part.type === "text",
                    )
                    .map((part) => part.text)
                    .join("\n"),
              ...((typeof message.content !== "string" && message.content)
                ? {
                    images: message.content
                      .filter((part): part is Extract<ChatMessageContentPart, { type: "image_url" }> =>
                        part.type === "image_url",
                      )
                      .map((part) => decodeImageDataUrl(part.image_url.url).data),
                  }
                : {}),
            })),
            stream: false,
            ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
            options: {
              temperature: request.temperature ?? 1,
              num_predict: request.maxTokens,
            },
          }),
          ...(request.signal ? { signal: request.signal } : {}),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const json = (await res.json()) as {
          message?: { role?: string; content?: string; tool_calls?: unknown };
          error?: string;
        };
        if (json.error) throw new Error(json.error);

        const toolCalls = parseOllamaToolCalls(json.message?.tool_calls);
        const content = json.message?.content ?? "";

        return {
          id: `ollama-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [
            {
              index: 0,
              message: {
                role: json.message?.role ?? "assistant",
                content: content || null,
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
              },
              finishReason: toolCalls.length > 0 ? "tool_calls" : content ? "stop" : "length",
            },
          ],
        } as ChatCompletionResponse;
      },
    };
  };

  testConnection = async (
    credentials: ProviderCredentials,
    endpoint?: string
  ): Promise<TestConnectionResult> => {
    const base = (endpoint || OLLAMA_BASE).replace(/\/+$/, "");

    try {
      const res = await fetchWithTimeout(`${base}/api/tags`, { method: "GET" });
      if (!res.ok) {
        // Fallback: try /api/version
        const ver = await fetchWithTimeout(`${base}/api/version`, { method: "GET" });
        if (!ver.ok) {
          return { success: false, message: "Ollama not reachable at " + base };
        }
        return { success: true, message: "Ollama reachable", model: this.defaultModel };
      }

      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      return {
        success: true,
        message: "Ollama reachable",
        model: json.models?.[0]?.name || this.defaultModel,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Connection error: ${msg}` };
    }
  };
}

// ────────────────────────────────────────────────────────────────
// 8. Provider registry
// ────────────────────────────────────────────────────────────────
const PROVIDER_ADAPTERS: Record<AiProviderName, AiProviderAdapter> = {
  openai: new OpenAiAdapter("openai", DEFAULT_OPENAI_MODEL, DEFAULT_OPENAI_BASE),
  openrouter: new OpenAiAdapter(
    "openrouter",
    "openrouter/free",
    "https://openrouter.ai/api/v1",
    "/chat/completions"
  ),
  custom: new OpenAiAdapter("custom", DEFAULT_OPENAI_MODEL, "https://api.openai.com/v1"),
  gemini: new GeminiAdapter(),
  anthropic: new AnthropicAdapter(),
  ollama: new OllamaAdapter(),
};

// ────────────────────────────────────────────────────────────────
// 9. Public API
// ────────────────────────────────────────────────────────────────

/**
 * Resolve a provider by name and return the matching adapter.
 */
export function resolveAiProvider(provider: AiProviderName): AiProviderAdapter {
  const adapter = PROVIDER_ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unknown AI provider: ${provider}`);
  }
  return adapter;
}

// ────────────────────────────────────────────────────────────────
// 9b. AiProvider wrapper class
// ────────────────────────────────────────────────────────────────

// The system instruction that grounds the model in the user's own Tutor Walle
// data. `AiProvider.chat` prepends this (with the serialized context) as the
// first `system` message whenever a context snapshot is available.
const TUTOR_WALLE_SYSTEM_INSTRUCTION =
  "You are the Tutor Walle academic assistant, an AI helper inside a student's " +
  "personal academic operating system. Below is the student's current Tutor Walle " +
  "data as JSON (courses, uncompleted tasks, upcoming events/exams, recent study " +
  "sessions, active goals, recent notes, and recent grades). Use that data as the " +
  "single source of truth for anything about the student's academics, progress, " +
  "workload, grades, goals, studying, or schedule. Ground every answer in this " +
  "data and cite specific courses, tasks, counts and numbers where relevant. You " +
  "CANNOT access external websites, a live database, or Tutor Walle on your own — " +
  "only the data in this prompt exists for you. If the student asks about something " +
  "not present in the data, say it is not in the available data instead of inventing " +
  "or guessing it. Never fabricate courses, tasks, grades, or progress numbers.";

/**
 * Wraps an AiProviderAdapter with credentials and optional endpoint,
 * providing a uniform chat interface for the AI service layer.
 */
export class AiProvider {
  constructor(
    private adapter: AiProviderAdapter,
    private credentials: ProviderCredentials,
    private endpoint?: string,
    private configuredModel?: string | null
  ) {}

  isConfigured(): boolean {
    // Credential-free providers (ollama) are configured by endpoint alone and
    // legitimately have no apiKey/accessToken.
    return (
      !!(this.credentials.apiKey?.trim() || this.credentials.accessToken?.trim()) ||
      isCredentialFreeProvider(this.adapter.name)
    );
  }

  /** Which provider is serving this request — surfaced in AI responses. */
  get providerName(): AiProviderName {
    return this.adapter.name;
  }

  get model(): string {
    return this.configuredModel ?? this.adapter.defaultModel;
  }

  /**
   * Whether this provider can run the tool-calling agent. When false the
   * service falls back to the legacy grounded single-shot reply, so Gemini and
   * Anthropic connections keep working without tool support.
   */
  supportsTools(): boolean {
    return this.adapter.supportsNativeTools;
  }

  async chat(
    request: { messages: Array<{ role: string; content: string | ChatMessageContentPart[] }>; context?: string; signal?: AbortSignal }
  ): Promise<{ content: string }> {
    try {
      const client = this.adapter.createClient(this.credentials, this.endpoint);

      // Ground the model in the user's real Tutor Walle data: when a context
      // snapshot was assembled by the service, send it as the first `system`
      // message together with a grounding instruction. Without this the model
      // only ever sees the raw conversation text and cannot know the student's
      // courses, tasks, grades, etc. (Previously the context was built and
      // stored as `contextSnapshot` in the database but never sent to the model.)
      const messages: ChatMessage[] = [];
      if (request.context) {
        messages.push({
          role: "system",
          content: `${TUTOR_WALLE_SYSTEM_INSTRUCTION}\n\nTutor Walle data (JSON):\n${request.context}`,
        });
      }
      messages.push(...(request.messages as Array<{
        role: "user" | "assistant";
        content: string | ChatMessageContentPart[];
      }>));

      const chatRequest: ChatCompletionRequest = {
        model: this.model,
        messages,
        ...(request.signal ? { signal: request.signal } : {}),
      };
      const response = await client.chatCompletions(chatRequest);
      const content = response.choices?.[0]?.message?.content;
      if (!content) throw new AiProviderError("Empty response from AI provider");
      return { content };
    } catch (err) {
      // Provider errors become a controlled 502 (AiProviderError) instead of a
      // 500. Providers echo the offending key in their error text, so the
      // message is redacted before it can reach the client or logs.
      if (err instanceof AiProviderTimeoutError) throw err;
      if (err instanceof AiProviderCancelledError) throw err;
      if (err instanceof AiProviderError) throw err;
      // A blocked endpoint is a deliberate policy decision, not an upstream
      // failure. Surface it with its own code so operators can distinguish it.
      if (err instanceof SsrfBlockedError) {
        throw new AiProviderError(err.message, 502, "AI_PROVIDER_ENDPOINT_BLOCKED");
      }
      if (err instanceof ProviderHttpError) {
        const { sanitizeMessage } = await import("@/services/ai-connections");
        throw mapUpstreamProviderError(err.statusCode, sanitizeMessage(err.message));
      }
      const message = err instanceof Error ? err.message : String(err);
      const { sanitizeMessage } = await import("@/services/ai-connections");
      throw new AiProviderError(sanitizeMessage(message));
    }
  }

  /**
   * One tool-capable turn.
   *
   * Returns either prose (`content`) or tool calls — never a fabricated mix.
   * Callers must check `toolCalls.length` first: a turn that carries tool calls
   * is the model asking for data, not answering the student.
   *
   * Errors follow the same controlled 502 / redaction path as `chat`, so a
   * failing tool-calling provider degrades to a normal error rather than a 500.
   */
  async chatWithTools(request: {
    messages: ChatMessage[];
    tools?: ProviderToolSchema[];
    toolChoice?: ToolChoice;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<{ content: string | null; toolCalls: ChatToolCall[]; finishReason: string | null }> {
    if (!this.adapter.supportsNativeTools) {
      throw new Error(`Provider ${this.adapter.name} does not support native tool calls`);
    }

    try {
      const client = this.adapter.createClient(this.credentials, this.endpoint);
      const response = await client.chatCompletions({
        model: this.model,
        messages: request.messages,
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
        ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      });

      const choice = response.choices?.[0];
      if (!choice) throw new AiProviderError("AI provider returned no choices");
      const toolCalls = choice.message?.tool_calls ?? [];

      return {
        content: choice?.message?.content ?? null,
        toolCalls,
        finishReason: choice?.finishReason ?? null,
      };
    } catch (err) {
      if (err instanceof AiProviderTimeoutError) throw err;
      if (err instanceof AiProviderCancelledError) throw err;
      if (err instanceof AiProviderError) throw err;
      if (err instanceof SsrfBlockedError) {
        throw new AiProviderError(err.message, 502, "AI_PROVIDER_ENDPOINT_BLOCKED");
      }
      if (err instanceof ProviderHttpError) {
        const { sanitizeMessage } = await import("@/services/ai-connections");
        throw mapUpstreamProviderError(err.statusCode, sanitizeMessage(err.message));
      }
      const message = err instanceof Error ? err.message : String(err);
      const { sanitizeMessage } = await import("@/services/ai-connections");
      throw new AiProviderError(sanitizeMessage(message));
    }
  }
}

// ────────────────────────────────────────────────────────────────
// 9c. Error types
// ────────────────────────────────────────────────────────────────

// Thrown when the user has no usable AI connection. It extends `ApiError` rather
// than plain `Error` so `globalErrorHandler` maps it to 503 with the documented
// `AI_PROVIDER_NOT_CONFIGURED` code instead of leaking a 500. This is a
// controlled, expected condition — the rest of the API stays fully functional.
export class AiProviderNotConfiguredError extends ApiError {
  constructor(message = "No AI provider configured") {
    super(503, "AI_PROVIDER_NOT_CONFIGURED", message);
    this.name = "AiProviderNotConfiguredError";
    Object.setPrototypeOf(this, AiProviderNotConfiguredError.prototype);
  }
}

// Provider was reachable but returned a non-2xx or an unusable payload. Also a
// controlled failure (502, not 500) for the same reason as above.
export class AiProviderError extends ApiError {
  constructor(
    message = "AI provider request failed",
    statusCode = 502,
    code = "AI_PROVIDER_ERROR",
  ) {
    super(statusCode, code, message);
    this.name = "AiProviderError";
    Object.setPrototypeOf(this, AiProviderError.prototype);
  }
}

function mapUpstreamProviderError(status: number, detail: string): AiProviderError {
  if (status === 429) {
    return new AiProviderError("The AI provider is rate-limiting requests. Please wait and try again.", 429, "AI_PROVIDER_RATE_LIMITED");
  }
  if (status === 402) {
    return new AiProviderError("The AI provider account has exhausted its available quota or credits.", 402, "AI_PROVIDER_QUOTA_EXHAUSTED");
  }
  if (status === 401 || status === 403) {
    return new AiProviderError("The configured AI provider credentials were rejected. Please contact the administrator or check your connection in Settings.", 502, "AI_PROVIDER_AUTH_FAILED");
  }
  if (status === 404) {
    return new AiProviderError("The selected AI model is unavailable or does not support this request.", 422, "AI_MODEL_UNAVAILABLE");
  }
  if (status >= 500) {
    return new AiProviderError("The AI provider is temporarily unavailable. Please try again later.", 503, "AI_PROVIDER_UNAVAILABLE");
  }
  return new AiProviderError(detail);
}

// The provider did not answer within the configured budget. A controlled 504
// (mirroring `EmailTimeoutError`) so the failure is distinguishable from a
// generic 502 `AI_PROVIDER_ERROR` and clients can treat it as retryable. No
// credentials or provider internals are included in the message.
export class AiProviderTimeoutError extends ApiError {
  constructor(timeoutMs: number = config.aiRequestTimeoutMs) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    super(
      504,
      "AI_PROVIDER_TIMEOUT",
      `The AI provider did not respond within ${seconds}s. Please try again.`
    );
    this.name = "AiProviderTimeoutError";
    Object.setPrototypeOf(this, AiProviderTimeoutError.prototype);
  }
}

/** The student cancelled generation by stopping or closing the request. */
export class AiProviderCancelledError extends Error {
  constructor() {
    super("AI generation was cancelled");
    this.name = "AiProviderCancelledError";
  }
}

// The provider answered text, but it was never the JSON object the structured
// endpoint's schema describes — even after one corrective retry. A controlled
// 502 so clients can tell "provider is down" apart from "the model would not
// follow the schema". The raw model text is never echoed back.
export class AiStructuredOutputError extends ApiError {
  constructor(message = "The AI did not return output matching the requested schema") {
    super(502, "AI_STRUCTURED_OUTPUT_INVALID", message);
    this.name = "AiStructuredOutputError";
    Object.setPrototypeOf(this, AiStructuredOutputError.prototype);
  }
}

// The user has an active AI connection, but its stored credentials could not be
// decrypted — typically because `ENCRYPTION_KEY` changed after they were saved.
// We deliberately do NOT fall back to the environment-default provider here: the
// user explicitly chose a connection, so silently answering with a different one
// would be misleading. A controlled 409 with an actionable message instead of an
// opaque 500. The message never includes credentials or crypto internals.
export class AiConnectionUnreadableError extends ApiError {
  constructor(
    message = "Your saved AI connection could not be read. Please re-enter its credentials in Settings to reconnect.",
  ) {
    super(409, "AI_CONNECTION_UNREADABLE", message);
    this.name = "AiConnectionUnreadableError";
    Object.setPrototypeOf(this, AiConnectionUnreadableError.prototype);
  }
}

// ────────────────────────────────────────────────────────────────
// 9d. Environment-default provider (default/fallback)
// ────────────────────────────────────────────────────────────────
// Resolution order at runtime: 1) the user's active, enabled personal AI
// connection, 2) the environment-default provider described by the AI_* env
// vars (AI_PROVIDER / AI_MODEL / AI_BASE_URL / provider-specific keys). This
// lets Tutor Walle ship with a working out-of-the-box provider (dev default:
// OpenRouter) while giving every user the option to override it per-account.

/** The slice of `config` the default-provider builder reads. Kept standalone so
 * callers (and tests) can pass any object shaped like it. */
export interface DefaultAiProviderConfig {
  aiEnabled: boolean;
  aiProvider: string;
  aiModel?: string | null;
  aiBaseUrl?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openRouterApiKey?: string;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  customAiApiKey?: string;
  customAiEndpoint?: string;
  ollamaBaseUrl?: string;
}

function defaultCredentialsFor(
  provider: AiProviderName,
  source: DefaultAiProviderConfig
): ProviderCredentials {
  switch (provider) {
    case "openai":
      return { apiKey: source.openAiApiKey };
    case "openrouter":
      return { apiKey: source.openRouterApiKey };
    case "gemini":
      return { apiKey: source.geminiApiKey };
    case "anthropic":
      return { apiKey: source.anthropicApiKey };
    case "custom":
      return { apiKey: source.customAiApiKey };
    default:
      return {};
  }
}

function defaultEndpointFor(
  provider: AiProviderName,
  source: DefaultAiProviderConfig
): string | undefined {
  switch (provider) {
    case "openai":
      return source.openAiBaseUrl;
    case "openrouter":
      return source.aiBaseUrl;
    case "custom":
      return source.customAiEndpoint;
    case "ollama":
      return source.ollamaBaseUrl;
    default:
      return undefined;
  }
}

function isValidHttpEndpoint(endpoint: string): boolean {
  return isStructurallyValidEndpoint(endpoint);
}

/**
 * Build the environment-default `AiProvider` from an AI config snapshot.
 *
 * Defaults to the app's `config`. Returns `null` (rather than throwing) when
 * the default is not usable in this deployment: AI disabled via
 * `AI_ENABLED=false`, or the configured provider's key is missing. Callers
 * decide how to react — `getAIProvider` turns it into the documented 503
 * `AI_PROVIDER_NOT_CONFIGURED`.
 */
export function buildDefaultAiProvider(
  source: DefaultAiProviderConfig = config
): AiProvider | null {
  if (!source.aiEnabled) return null;
  const provider = source.aiProvider as AiProviderName;
  // AI is optional at deployment scope. A typo in these optional variables
  // should make Default AI unavailable, not prevent unrelated API features
  // (or personal AI connections) from starting.
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_ADAPTERS, provider)) return null;
  const endpoint = defaultEndpointFor(provider, source);
  // Local/custom deployments must explicitly name a usable HTTP endpoint;
  // don't mark an accidentally keyless or mistyped setup as ready.
  if ((provider === "ollama" || provider === "custom") && (!endpoint || !isValidHttpEndpoint(endpoint))) {
    return null;
  }
  if (endpoint && !isValidHttpEndpoint(endpoint)) return null;
  const instance = new AiProvider(
    resolveAiProvider(provider),
    defaultCredentialsFor(provider, source),
    endpoint,
    source.aiModel || undefined
  );
  return instance.isConfigured() ? instance : null;
}

/**
 * Resolve the active AI provider for a user.
 * When userId is provided, looks up the active connection from the database.
 * Without one, falls back to the environment-default provider; a user with no
 * connection and no usable default gets an unconfigured placeholder.
 */
export async function getAIProvider(
  userId?: string
): Promise<AiProvider> {
  if (userId) {
    const { settingsService } = await import("@/services/settings");
    const settings = await settingsService.get(userId);
    const requestedMode = settings["ai.providerMode"];

    if (requestedMode === "default") {
      const defaultProvider = buildDefaultAiProvider();
      if (defaultProvider) return defaultProvider;
      throw new AiProviderNotConfiguredError(
        "Tutor Walle Default AI is not configured. Please contact the administrator.",
      );
    }

    const { getActiveUserConnection } = await import("@/services/ai-connections");
    const conn = await getActiveUserConnection(userId);
    if (conn) {
      const adapter = resolveAiProvider(conn.provider as AiProviderName);
      return new AiProvider(adapter, conn.decryptedCredentials, conn.endpoint ?? undefined, conn.model ?? undefined);
    }
    if (requestedMode === "personal") {
      throw new AiProviderNotConfiguredError(
        "No active personal AI connection. Activate a connection in Settings or select Tutor Walle Default AI.",
      );
    }
    // No active personal connection — use the environment-default provider.
    const fallback = buildDefaultAiProvider();
    if (fallback) return fallback;
    throw new AiProviderNotConfiguredError();
  }
  // No userId — unconfigured placeholder
  return new AiProvider(resolveAiProvider("openai"), {});
}

/**
 * Test a connection to a provider with given credentials and optional endpoint override.
 *
 * @param provider    Provider name
 * @param credentials Credentials (typically from decrypted AiConnection record)
 * @param endpoint    Optional custom endpoint URL (for ollama/custom providers)
 */
export async function testConnection(
  provider: AiProviderName,
  credentials: ProviderCredentials,
  endpoint?: string
): Promise<TestConnectionResult> {
  const adapter = resolveAiProvider(provider as AiProviderName);
  return adapter.testConnection(credentials, endpoint);
}

/**
 * Pick a model: use the user-provided model or fall back to the provider default.
 */
export function resolveModel(provider: AiProviderName, userModel?: string | null): string {
  if (userModel && userModel.trim().length > 0) return userModel.trim();
  return resolveAiProvider(provider).defaultModel;
}
