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
import { isCredentialFreeProvider } from "@/modules/ai-connections/schema";
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

/** A model request to run one of our tools, in OpenAI function-call form. */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  /** `null` for an assistant turn that only carries tool calls. */
  content: string | null;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  name?: string;
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

        const res = await fetch(base, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Authorization: auth } : {}),
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const json = (await res.json()) as ChatCompletionResponse;
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
      const res = await fetch(base, {
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
        const systemPrompt = request.messages.find((m) => m.role === "system")?.content;
        const contents = request.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : m.role,
            parts: [{ text: m.content ?? "" }],
          }));

        const url = `${base}/${request.model}/generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
            contents,
            generationConfig: { temperature: request.temperature ?? 1, maxOutputTokens: request.maxTokens },
          }),
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
      const res = await fetch(url, {
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
          .map((m) => ({ role: m.role, content: m.content ?? "" }));

        const url = `${base}/messages`;
        const res = await fetch(url, {
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
      const res = await fetch(url, {
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
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            stream: false,
            ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
            options: {
              temperature: request.temperature ?? 1,
              num_predict: request.maxTokens,
            },
          }),
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
      const res = await fetch(`${base}/api/tags`, { method: "GET" });
      if (!res.ok) {
        // Fallback: try /api/version
        const ver = await fetch(`${base}/api/version`, { method: "GET" });
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
    "openai/gpt-4o",
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

// The system instruction that grounds the model in the user's own StudentOS
// data. `AiProvider.chat` prepends this (with the serialized context) as the
// first `system` message whenever a context snapshot is available.
const STUDENTOS_SYSTEM_INSTRUCTION =
  "You are the StudentOS academic assistant, an AI helper inside a student's " +
  "personal academic operating system. Below is the student's current StudentOS " +
  "data as JSON (courses, uncompleted tasks, upcoming events/exams, recent study " +
  "sessions, active goals, recent notes, and recent grades). Use that data as the " +
  "single source of truth for anything about the student's academics, progress, " +
  "workload, grades, goals, studying, or schedule. Ground every answer in this " +
  "data and cite specific courses, tasks, counts and numbers where relevant. You " +
  "CANNOT access external websites, a live database, or StudentOS on your own — " +
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
      !!(this.credentials.apiKey || this.credentials.accessToken) ||
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
    request: { messages: Array<{ role: string; content: string }>; context?: string }
  ): Promise<{ content: string }> {
    try {
      const client = this.adapter.createClient(this.credentials, this.endpoint);

      // Ground the model in the user's real StudentOS data: when a context
      // snapshot was assembled by the service, send it as the first `system`
      // message together with a grounding instruction. Without this the model
      // only ever sees the raw conversation text and cannot know the student's
      // courses, tasks, grades, etc. (Previously the context was built and
      // stored as `contextSnapshot` in the database but never sent to the model.)
      const messages: ChatMessage[] = [];
      if (request.context) {
        messages.push({
          role: "system",
          content: `${STUDENTOS_SYSTEM_INSTRUCTION}\n\nStudentOS data (JSON):\n${request.context}`,
        });
      }
      messages.push(...(request.messages as Array<{ role: "user" | "assistant"; content: string }>));

      const chatRequest: ChatCompletionRequest = {
        model: this.model,
        messages,
      };
      const response = await client.chatCompletions(chatRequest);
      const content = response.choices[0]?.message?.content;
      if (!content) throw new AiProviderError("Empty response from AI provider");
      return { content };
    } catch (err) {
      // Provider errors become a controlled 502 (AiProviderError) instead of a
      // 500. Providers echo the offending key in their error text, so the
      // message is redacted before it can reach the client or logs.
      if (err instanceof AiProviderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const { sanitizeMessage } = await import("@/modules/ai-connections/service");
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
      });

      const choice = response.choices[0];
      const toolCalls = choice?.message?.tool_calls ?? [];

      return {
        content: choice?.message?.content ?? null,
        toolCalls,
        finishReason: choice?.finishReason ?? null,
      };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const { sanitizeMessage } = await import("@/modules/ai-connections/service");
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
  constructor(message = "AI provider request failed") {
    super(502, "AI_PROVIDER_ERROR", message);
    this.name = "AiProviderError";
    Object.setPrototypeOf(this, AiProviderError.prototype);
  }
}

// ────────────────────────────────────────────────────────────────
// 9d. Environment-default provider (default/fallback)
// ────────────────────────────────────────────────────────────────
// Resolution order at runtime: 1) the user's active, enabled personal AI
// connection, 2) the environment-default provider described by the AI_* env
// vars (AI_PROVIDER / AI_MODEL / AI_BASE_URL / provider-specific keys). This
// lets StudentOS ship with a working out-of-the-box provider (dev default:
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
  const instance = new AiProvider(
    resolveAiProvider(provider),
    defaultCredentialsFor(provider, source),
    defaultEndpointFor(provider, source),
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
    const { getActiveUserConnection } = await import("@/modules/ai-connections/service");
    const conn = await getActiveUserConnection(userId);
    if (conn) {
      const adapter = resolveAiProvider(conn.provider as AiProviderName);
      return new AiProvider(adapter, conn.decryptedCredentials, conn.endpoint ?? undefined, conn.model ?? undefined);
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
