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
  /** Returns a configured fetch-like function that sends a chat completions request. */
  createClient(credentials: ProviderCredentials, endpoint?: string): AiChatClient;
  /** Lightweight connectivity test — does not need a full chat completions call. */
  testConnection(credentials: ProviderCredentials, endpoint?: string): Promise<TestConnectionResult>;
}

export interface AiChatClient {
  /** POST /chat/completions (or provider equivalent). */
  chatCompletions(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{ index: number; message: { role: string; content: string }; finishReason: string }>;
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
          messages: request.messages,
          temperature: request.temperature ?? 1,
          max_tokens: request.maxTokens,
          stream: request.stream ?? false,
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

  createClient(credentials: ProviderCredentials, endpoint?: string): AiChatClient {
    const apiKey = credentials.apiKey || credentials.accessToken;
    if (!apiKey) throw new Error("Gemini requires an API key");
    const base = endpoint
      ? endpoint.replace(/\/+$/, "")
      : `${GEMINI_BASE}/models`;

    return {
      chatCompletions: async (request) => {
        // Gemini uses a different API shape; map OpenAI-style to Gemini
        const contents = request.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : m.role,
          parts: [{ text: m.content }],
        }));

        const url = `${base}/${request.model}/generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents, generationConfig: { temperature: request.temperature ?? 1, maxOutputTokens: request.maxTokens } }),
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
          .map((m) => ({ role: m.role, content: m.content }));

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

const DEFAULT_OLLAMA_MODEL = "llama3.2";
const OLLAMA_BASE = "http://localhost:11434";

export class OllamaAdapter implements AiProviderAdapter {
  readonly name: AiProviderName = "ollama";
  readonly defaultModel: string = DEFAULT_OLLAMA_MODEL;

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

        const json = (await res.json()) as { message?: { role?: string; content?: string }; error?: string };
        if (json.error) throw new Error(json.error);

        return {
          id: `ollama-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: request.model,
          choices: [
            {
              index: 0,
              message: { role: json.message?.role ?? "assistant", content: json.message?.content ?? "" },
              finishReason: json.message?.content ? "stop" : "length",
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
    "https://openrouter.ai/api",
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

/**
 * Wraps an AiProviderAdapter with credentials and optional endpoint,
 * providing a uniform chat interface for the AI service layer.
 */
export class AiProvider {
  constructor(
    private adapter: AiProviderAdapter,
    private credentials: ProviderCredentials,
    private endpoint?: string
  ) {}

  isConfigured(): boolean {
    return !!(this.credentials.apiKey || this.credentials.accessToken);
  }

  async chat(
    request: { messages: Array<{ role: string; content: string }>; context?: string }
  ): Promise<{ content: string }> {
    const client = this.adapter.createClient(this.credentials, this.endpoint);
    const chatRequest: ChatCompletionRequest = {
      model: this.adapter.defaultModel,
      messages: request.messages as ChatCompletionRequest["messages"],
    };
    const response = await client.chatCompletions(chatRequest);
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from AI provider");
    return { content };
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

/**
 * Resolve the active AI provider for a user.
 * When userId is provided, looks up the active connection from the database.
 * Otherwise returns an unconfigured placeholder.
 */
export async function getAIProvider(
  userId?: string
): Promise<AiProvider> {
  if (userId) {
    const { getActiveUserConnection } = await import("@/modules/ai-connections/service");
    const conn = await getActiveUserConnection(userId);
    if (!conn) {
      throw new AiProviderNotConfiguredError();
    }
    const adapter = resolveAiProvider(conn.provider as AiProviderName);
    return new AiProvider(adapter, conn.decryptedCredentials, conn.endpoint ?? undefined);
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
