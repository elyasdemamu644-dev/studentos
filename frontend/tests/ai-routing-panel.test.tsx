import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Real API shapes captured from GET /ai/routing and /ai/routing/catalog.
const POLICY = {
  id: "p1",
  userId: "u1",
  strategy: "AUTO" as const,
  fixedConnectionId: null,
  fixedModel: null,
  freeOnly: false,
  spendCeilingCents: null,
  spendWindowDays: 30,
  allowAutoFallback: true,
  externalProcessingDisabled: false,
  preset: null,
  fallbackOrder: [] as string[],
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

const CATALOG = [
  {
    provider: "openai" as const,
    models: [
      {
        provider: "openai" as const,
        id: "gpt-4o",
        label: "GPT-4o",
        capabilities: [
          { kind: "TEXT" as const, evidence: "PROVIDER_REPORTED" as const, trusted: true },
          { kind: "VISION" as const, evidence: "PROVIDER_REPORTED" as const, trusted: true },
        ],
        contextTokens: 128000,
        inputCostPerMTokCents: 250,
        outputCostPerMTokCents: 1000,
        free: false,
      },
    ],
  },
];

const h = vi.hoisted(() => {
  const mutate = vi.fn();
  return {
    mutate,
    policy: {
      data: undefined as unknown,
      isPending: false,
      isError: false,
      error: null as unknown,
      refetch: vi.fn(),
    },
    catalog: {
      data: undefined as unknown,
      isPending: false,
      isError: false,
      error: null as unknown,
      refetch: vi.fn(),
    },
    usage: { data: undefined as unknown, isPending: false, isError: false, error: null, refetch: vi.fn() },
    health: { data: [] as unknown, isPending: false, isError: false, error: null, refetch: vi.fn() },
  };
});

vi.mock("@/features/ai-routing/hooks", () => ({
  useRoutingPolicy: () => h.policy,
  useRoutingCatalog: () => h.catalog,
  useUpdateRoutingPolicy: () => ({ mutate: h.mutate, isPending: false }),
  useUsageSummary: () => h.usage,
  useProviderHealth: () => h.health,
}));

import { RoutingPanel } from "@/features/ai-routing/routing-panel";

describe("AI routing panel", () => {
  it("renders the effective policy from the API without crashing", () => {
    h.policy.data = POLICY;
    h.catalog.data = CATALOG;
    h.usage.data = {
      windowDays: 30,
      totalRequests: 0,
      totalTokens: 0,
      totalCostCents: 0,
      hasUnknownPricing: false,
      byProvider: [],
    };
    render(<RoutingPanel />);
    expect(screen.getByText("AI routing & privacy")).toBeInTheDocument();
    expect(screen.getByText(/How should Tutor Walle choose a model/)).toBeInTheDocument();
  });
});
