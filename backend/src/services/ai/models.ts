import type { AiProviderName } from "@/schemas/ai";
import { resolveModel } from "./provider";

// ─────────────────────────────────────────────────────────────────────────────
// Model catalog
// ─────────────────────────────────────────────────────────────────────────────
//
// A curated, static list of selectable models for the Default AI. It is served
// to the client so the model picker offers real ids instead of free text; the
// list is deliberately *not* fetched live from each provider — that would need
// the provider's credentials on the server and would let a slow upstream stall
// settings. The stored preference is still a plain string, so an operator or a
// future provider can use an id that is not listed here.

export interface AiModelOption {
  id: string;
  label: string;
}

export interface AiModelGroup {
  provider: AiProviderName;
  /** The provider's own default, offered as "use the model's default". */
  defaultModel: string;
  models: AiModelOption[];
}

const CATALOG: Record<AiProviderName, AiModelOption[]> = {
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "o3-mini", label: "o3-mini" },
  ],
  openrouter: [
    { id: "openrouter/free", label: "OpenRouter free router" },
    { id: "openai/gpt-4o", label: "OpenAI GPT-4o" },
    { id: "anthropic/claude-3.5-sonnet", label: "Anthropic Claude 3.5 Sonnet" },
    { id: "google/gemini-2.0-flash-001", label: "Google Gemini 2.0 Flash" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Meta Llama 3.3 70B" },
  ],
  anthropic: [
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
  ollama: [
    { id: "llama3.2", label: "Llama 3.2" },
    { id: "llama3.1", label: "Llama 3.1" },
    { id: "qwen2.5", label: "Qwen 2.5" },
    { id: "mistral", label: "Mistral" },
  ],
  custom: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
  ],
};

/** The selectable models for one provider, plus that provider's own default. */
export function listAiModels(provider: AiProviderName): AiModelGroup {
  return {
    provider,
    defaultModel: resolveModel(provider),
    models: CATALOG[provider] ?? [],
  };
}
