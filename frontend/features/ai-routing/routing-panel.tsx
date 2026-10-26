"use client";

import { useEffect, useState } from "react";
import { Route, ShieldCheck, Wallet, Activity, Info } from "lucide-react";

import { Panel } from "@/components/panel";
import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectTrigger, SelectValue, SelectItem } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Separator } from "@/components/ui/separator";
import {
  AI_HEALTH_STATUS_LABELS,
  AI_ROUTING_PRESET_DESCRIPTIONS,
  AI_ROUTING_PRESET_LABELS,
  AI_ROUTING_PRESETS,
  AI_ROUTING_STRATEGY_DESCRIPTIONS,
  AI_ROUTING_STRATEGY_LABELS,
} from "@/lib/labels";
import type {
  AiCatalogModel,
  AiProviderName,
  AiRoutingPolicyUpdate,
  AiRoutingStrategy,
} from "@/types/api-types";
import {
  useRoutingPolicy,
  useRoutingCatalog,
  useUpdateRoutingPolicy,
  useUsageSummary,
  useProviderHealth,
} from "./hooks";
import { CapabilityRow } from "./capability-badge";

// ─────────────────────────────────────────────────────────────────────────────
// Routing & privacy settings
// ─────────────────────────────────────────────────────────────────────────────
//
// One panel to govern which models the assistant may use, how it chooses, what
// it may spend, and whether requests leave the device at all. Every control here
// maps to a server-enforced policy field — the UI is not the safeguard.

/** Format integer cents as a readable currency string. */
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ModelOptions({ models }: { models: AiCatalogModel[] }) {
  return (
    <>
      {models.map((model) => (
        <SelectItem key={`${model.provider}:${model.id}`} value={model.id}>
          <span className="flex items-center gap-2">
            {model.label}
            {model.free && <Badge variant="success">Free</Badge>}
          </span>
        </SelectItem>
      ))}
    </>
  );
}

export function RoutingPanel() {
  const policy = useRoutingPolicy();
  const catalog = useRoutingCatalog();
  const updatePolicy = useUpdateRoutingPolicy();
  const usage = useUsageSummary(30);
  const health = useProviderHealth(20);

  // Local draft so a slider/toggle feels instant; persisted on save.
  const [draft, setDraft] = useState<AiRoutingPolicyUpdate>({});
  const [spendDollars, setSpendDollars] = useState("");

  useEffect(() => {
    if (!policy.data) return;
    setDraft({
      strategy: policy.data.strategy,
      fixedConnectionId: policy.data.fixedConnectionId,
      fixedModel: policy.data.fixedModel,
      freeOnly: policy.data.freeOnly,
      spendCeilingCents: policy.data.spendCeilingCents,
      spendWindowDays: policy.data.spendWindowDays,
      allowAutoFallback: policy.data.allowAutoFallback,
      externalProcessingDisabled: policy.data.externalProcessingDisabled,
      preset: policy.data.preset,
      fallbackOrder: policy.data.fallbackOrder,
    });
    setSpendDollars(
      policy.data.spendCeilingCents !== null ? (policy.data.spendCeilingCents / 100).toFixed(2) : "",
    );
  }, [policy.data]);

  if (policy.isPending || catalog.isPending) return <ListSkeleton rows={4} />;
  if (policy.isError || catalog.isError) {
    return (
      <ErrorState
        error={policy.error ?? catalog.error}
        retry={() => {
          void policy.refetch();
          void catalog.refetch();
        }}
      />
    );
  }
  if (!policy.data || !Array.isArray(catalog.data)) {
    return <ListSkeleton rows={4} />;
  }

  // Flatten the catalog into a single selectable model list. Model ids repeat
  // across providers, so the value carries the provider too.
  const allModels = catalog.data.flatMap((group) =>
    group.models.map((model) => ({ ...model, provider: group.provider as AiProviderName })),
  );
  const selectedModel = allModels.find((m) => m.id === draft.fixedModel);

  const save = () => {
    const ceiling =
      spendDollars.trim() === ""
        ? null
        : Math.max(0, Math.round(Number(spendDollars) * 100)) || 0;
    updatePolicy.mutate({ ...draft, spendCeilingCents: ceiling });
  };

  const currentSpend = usage.data?.totalCostCents ?? 0;
  const ceiling = policy.data.spendCeilingCents;
  const overCeiling = ceiling !== null && currentSpend >= ceiling;

  return (
    <Panel title="AI routing & privacy" icon={Route} tone="primary" collapsible={false}>
      <div className="space-y-6">
        {/* Strategy ---------------------------------------------------------- */}
        <div>
          <p className="mb-1 text-sm font-medium">How should Tutor Walle choose a model?</p>
          <p className="mb-3 text-xs text-muted-foreground">
            {AI_ROUTING_STRATEGY_DESCRIPTIONS[draft.strategy ?? policy.data.strategy]}
          </p>
          <SegmentedControl<AiRoutingStrategy>
            label="Model selection strategy"
            value={draft.strategy ?? policy.data.strategy}
            onChange={(value) => setDraft((d) => ({ ...d, strategy: value }))}
            options={[
              { value: "AUTO", label: AI_ROUTING_STRATEGY_LABELS.AUTO },
              { value: "FIXED", label: AI_ROUTING_STRATEGY_LABELS.FIXED },
            ]}
          />
        </div>

        {/* Fixed model ------------------------------------------------------- */}
        {(draft.strategy ?? policy.data.strategy) === "FIXED" && (
          <div className="rounded-lg border border-primary/25 bg-muted/40 p-3">
            <Label htmlFor="fixed-model">Pinned model</Label>
            <Select
              value={draft.fixedModel ?? undefined}
              onValueChange={(value) => {
                const model = allModels.find((m) => m.id === value);
                if (!model) return;
                setDraft((d) => ({
                  ...d,
                  fixedModel: model.id,
                  fixedConnectionId: null,
                }));
              }}
            >
              <SelectTrigger id="fixed-model" className="mt-1">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                <ModelOptions models={allModels} />
              </SelectContent>
            </Select>
            {selectedModel && (
              <div className="mt-2">
                <CapabilityRow capabilities={selectedModel.capabilities} />
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              If this model is unavailable, Tutor Walle tells you and asks you to choose —
              it never silently uses a different model.
            </p>
          </div>
        )}

        {/* Auto preset ------------------------------------------------------- */}
        {(draft.strategy ?? policy.data.strategy) === "AUTO" && (
          <div>
            <Label htmlFor="preset">Preference</Label>
            <Select
              value={draft.preset ?? "__none__"}
              onValueChange={(value) =>
                setDraft((d) => ({ ...d, preset: value === "__none__" ? null : (value as never) }))
              }
            >
              <SelectTrigger id="preset" className="mt-1">
                <SelectValue placeholder="No preset" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No preset</SelectItem>
                {AI_ROUTING_PRESETS.map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {AI_ROUTING_PRESET_LABELS[preset]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.preset && (
              <p className="mt-1 text-xs text-muted-foreground">
                {AI_ROUTING_PRESET_DESCRIPTIONS[draft.preset]}
              </p>
            )}
          </div>
        )}

        {/* Allow auto fallback ---------------------------------------------- */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Allow automatic selection</p>
            <p className="text-xs text-muted-foreground">
              When off, a request with no allowed model is reported as unavailable rather
              than answered by a model you did not pick.
            </p>
          </div>
          <Switch
            checked={draft.allowAutoFallback ?? policy.data.allowAutoFallback}
            onCheckedChange={(checked) => setDraft((d) => ({ ...d, allowAutoFallback: checked }))}
            aria-label="Allow automatic selection"
          />
        </div>

        <Separator />

        {/* Privacy ---------------------------------------------------------- */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-success" aria-hidden />
            <div>
              <p className="text-sm font-medium">Disable external processing</p>
              <p className="text-xs text-muted-foreground">
                Only a model running on your own device or network may answer. Enforced
                against the actual request destination — no external fallback, retry or
                attachment path while this is on.
              </p>
            </div>
          </div>
          <Switch
            checked={draft.externalProcessingDisabled ?? policy.data.externalProcessingDisabled}
            onCheckedChange={(checked) =>
              setDraft((d) => ({ ...d, externalProcessingDisabled: checked }))
            }
            aria-label="Disable external processing"
          />
        </div>

        {/* Free-only + spend ------------------------------------------------- */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Free models only</p>
            <p className="text-xs text-muted-foreground">
              Restrict automatic selection to models that cost nothing.
            </p>
          </div>
          <Switch
            checked={draft.freeOnly ?? policy.data.freeOnly}
            onCheckedChange={(checked) => setDraft((d) => ({ ...d, freeOnly: checked }))}
            aria-label="Free models only"
          />
        </div>

        <div>
          <Label htmlFor="spend-ceiling">Spend ceiling per window (USD)</Label>
          <div className="mt-1 flex items-center gap-2">
            <Input
              id="spend-ceiling"
              inputMode="decimal"
              placeholder="No ceiling"
              value={spendDollars}
              onChange={(e) => setSpendDollars(e.target.value)}
              className="max-w-[10rem]"
            />
            <Select
              value={String(draft.spendWindowDays ?? policy.data.spendWindowDays)}
              onValueChange={(value) =>
                setDraft((d) => ({ ...d, spendWindowDays: Number(value) }))
              }
            >
              <SelectTrigger className="max-w-[10rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">per 7 days</SelectItem>
                <SelectItem value="30">per 30 days</SelectItem>
                <SelectItem value="90">per 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Once reached, only free models remain eligible. Tutor Walle never switches to a
            paid model you did not authorise.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={updatePolicy.isPending}>
            {updatePolicy.isPending ? "Saving…" : "Save routing settings"}
          </Button>
        </div>

        <Separator />

        {/* Usage ------------------------------------------------------------ */}
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="h-4 w-4" aria-hidden /> Usage (last {usage.data?.windowDays ?? 30} days)
          </p>
          {usage.isPending ? (
            <ListSkeleton rows={2} />
          ) : usage.isError ? (
            <ErrorState error={usage.error} retry={() => usage.refetch()} />
          ) : (
            <>
              <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border border-primary/25 bg-muted/40 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Requests</p>
                  <p className="font-semibold">{usage.data.totalRequests}</p>
                </div>
                <div className="rounded-lg border border-primary/25 bg-muted/40 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Tokens</p>
                  <p className="font-semibold">{usage.data.totalTokens.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-primary/25 bg-muted/40 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Cost</p>
                  <p className="font-semibold">{formatCents(usage.data.totalCostCents)}</p>
                </div>
              </div>
              {ceiling !== null && (
                <p
                  className={`mt-2 text-xs ${overCeiling ? "text-danger" : "text-muted-foreground"}`}
                >
                  {formatCents(currentSpend)} of {formatCents(ceiling)} ceiling used
                  {overCeiling ? " — free models only until the window resets." : "."}
                </p>
              )}
              {usage.data.hasUnknownPricing && (
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Info className="h-3 w-3" aria-hidden /> Some models have unknown pricing, so
                  they are excluded from the cost total.
                </p>
              )}
            </>
          )}
        </div>

        {/* Health ----------------------------------------------------------- */}
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4" aria-hidden /> Provider health
          </p>
          {health.isPending ? (
            <ListSkeleton rows={2} />
          ) : health.isError ? (
            <ErrorState error={health.error} retry={() => health.refetch()} />
          ) : health.data.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No health checks recorded yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {health.data.map((entry) => (
                <li
                  key={entry.connectionId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="truncate">{entry.provider}</span>
                  <Badge
                    variant={
                      entry.status === "HEALTHY"
                        ? "success"
                        : entry.status === "UNHEALTHY"
                          ? "danger"
                          : entry.status === "DEGRADED"
                            ? "warning"
                            : "muted"
                    }
                  >
                    {AI_HEALTH_STATUS_LABELS[entry.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
