import { ApiError } from "@/config/errors";
import { config } from "@/config";

// ─────────────────────────────────────────────
// AI Provider abstraction
// ─────────────────────────────────────────────
//
// The AI service talks only to this interface. A provider is selected once
// at startup and injected — swapping OpenAI for another provider (Anthropic,
// a local model, …) only requires a new implementation of `AIProvider`.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Pre-built StudentOS context summary (optional). */
  context?: string;
}

export interface ChatResult {
  content: string;
}

export interface AIProvider {
  readonly name: string;
  /** True when the provider has everything it needs to make real calls. */
  isConfigured(): boolean;
  /** Run a chat completion. Throws when the provider is not configured. */
  chat(request: ChatRequest): Promise<ChatResult>;
}

// Controlled error returned when no AI provider is configured. The client
// can show a clear message instead of pretending AI works.
export class AiProviderNotConfiguredError extends ApiError {
  constructor() {
    super(503, "AI_PROVIDER_NOT_CONFIGURED", "No AI provider is configured. Set OPENAI_API_KEY to enable AI responses.");
    this.name = "AiProviderNotConfiguredError";
    Object.setPrototypeOf(this, AiProviderNotConfiguredError.prototype);
  }
}

export class AiProviderRequestError extends ApiError {
  constructor(message: string) {
    super(502, "AI_PROVIDER_ERROR", message);
    this.name = "AiProviderRequestError";
    Object.setPrototypeOf(this, AiProviderRequestError.prototype);
  }
}

// ─────────────────────────────────────────────
// OpenAI implementation (no SDK — plain fetch to a compatible endpoint)
// ─────────────────────────────────────────────

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = config.openAiApiKey;
    this.model = config.aiModel;
    this.baseUrl = config.openAiBaseUrl ?? "https://api.openai.com";
  }

  isConfigured(): boolean {
    return config.aiEnabled && Boolean(this.apiKey);
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    if (!this.isConfigured()) {
      throw new AiProviderNotConfiguredError();
    }

    const messages: ChatMessage[] = request.context
      ? [{ role: "system", content: request.context }, ...request.messages]
      : request.messages;

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new AiProviderRequestError(
        `AI provider request failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiProviderRequestError("AI provider returned an empty response");
    }

    return { content };
  }
}

// ─────────────────────────────────────────────
// Provider registry
// ─────────────────────────────────────────────

/**
 * Returns the selected provider instance. Add new providers here: map a
 * `AI_PROVIDER` value to a new class implementing `AIProvider`.
 */
export function createAIProvider(): AIProvider {
  switch (config.aiProvider) {
    case "openai":
    default:
      return new OpenAIProvider();
  }
}

// Global singleton so the provider (and its config snapshot) lives for the
// process lifetime.
let provider: AIProvider | undefined;

export function getAIProvider(): AIProvider {
  if (!provider) provider = createAIProvider();
  return provider;
}