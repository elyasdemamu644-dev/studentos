import { describe, expect, it } from "vitest";
import { connectionFormSchema } from "@/features/ai-connections/connection-form";
import {
  AI_PROVIDER_LABELS,
  CREDENTIAL_FREE_PROVIDERS,
  ENDPOINT_REQUIRED_PROVIDERS,
  isCredentialFreeProvider,
  isEndpointRequiredProvider,
} from "@/lib/labels";
import type { AiProviderName } from "@/types/api-types";

const ALL_PROVIDERS: AiProviderName[] = [
  "openai",
  "gemini",
  "anthropic",
  "openrouter",
  "ollama",
  "custom",
];

const validOpenAi = {
  provider: "openai" as const,
  model: "gpt-4o-mini",
  endpoint: "",
  credentials: "sk-test-key",
};

describe("ai connection provider labels", () => {
  it("labels every provider the API accepts", () => {
    for (const provider of ALL_PROVIDERS) {
      expect(AI_PROVIDER_LABELS[provider]).toBeTruthy();
    }
  });

  it("treats ollama as the only credential-free provider", () => {
    expect(CREDENTIAL_FREE_PROVIDERS).toEqual(["ollama"]);
    expect(isCredentialFreeProvider("ollama")).toBe(true);
    for (const provider of ALL_PROVIDERS) {
      if (provider === "ollama") continue;
      expect(isCredentialFreeProvider(provider)).toBe(false);
    }
  });

  it("requires an endpoint for ollama and custom only", () => {
    expect([...ENDPOINT_REQUIRED_PROVIDERS].sort()).toEqual(["custom", "ollama"]);
    expect(isEndpointRequiredProvider("ollama")).toBe(true);
    expect(isEndpointRequiredProvider("custom")).toBe(true);
    expect(isEndpointRequiredProvider("openai")).toBe(false);
  });
});

describe("ai connection form schema", () => {
  it("accepts a well-formed keyed provider", () => {
    expect(connectionFormSchema.safeParse(validOpenAi).success).toBe(true);
  });

  it("requires a key for every provider that uses one", () => {
    for (const provider of ALL_PROVIDERS) {
      if (isCredentialFreeProvider(provider)) continue;
      const result = connectionFormSchema.safeParse({
        ...validOpenAi,
        provider,
        endpoint: isEndpointRequiredProvider(provider) ? "http://localhost:11434" : "",
        credentials: "   ",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path)).toContainEqual(["credentials"]);
      }
    }
  });

  it("accepts ollama with an endpoint and no key", () => {
    const result = connectionFormSchema.safeParse({
      provider: "ollama",
      model: "llama3",
      endpoint: "http://localhost:11434",
      credentials: "",
    });
    expect(result.success).toBe(true);
  });

  it("still requires an endpoint for ollama", () => {
    const result = connectionFormSchema.safeParse({
      provider: "ollama",
      model: "",
      endpoint: "  ",
      credentials: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path)).toContainEqual(["endpoint"]);
    }
  });

  it("still requires an endpoint for a custom endpoint", () => {
    const result = connectionFormSchema.safeParse({
      provider: "custom",
      model: "",
      endpoint: "",
      credentials: "some-key",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path)).toContainEqual(["endpoint"]);
    }
  });

  it("treats a blank model and endpoint as absent", () => {
    const result = connectionFormSchema.safeParse({
      provider: "openai",
      model: "   ",
      endpoint: "",
      credentials: "sk-test-key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("");
    }
  });
});
