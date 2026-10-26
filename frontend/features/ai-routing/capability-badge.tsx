"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AI_CAPABILITY_EVIDENCE_DESCRIPTIONS,
  AI_CAPABILITY_EVIDENCE_LABELS,
  AI_CAPABILITY_KIND_LABELS,
} from "@/lib/labels";
import type { AiCatalogCapability, AiCapabilityEvidence } from "@/types/api-types";

// ─────────────────────────────────────────────────────────────────────────────
// Evidence-aware capability chips
// ─────────────────────────────────────────────────────────────────────────────
//
// A capability chip must never imply more certainty than we have. Trusted claims
// (VERIFIED / PROVIDER_REPORTED) render solid; weaker ones render outlined and
// dimmed, and every chip explains how the claim is known.

const EVIDENCE_TONE: Record<AiCapabilityEvidence, "success" | "default" | "muted" | "warning"> = {
  VERIFIED: "success",
  PROVIDER_REPORTED: "default",
  USER_CONFIGURED: "muted",
  UNKNOWN: "warning",
};

export function CapabilityChip({ capability }: { capability: AiCatalogCapability }) {
  const label = AI_CAPABILITY_KIND_LABELS[capability.kind];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={EVIDENCE_TONE[capability.evidence]}
          className={capability.trusted ? "" : "opacity-70"}
        >
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">
          {label}: {AI_CAPABILITY_EVIDENCE_LABELS[capability.evidence]}
        </p>
        <p className="text-xs text-muted-foreground">
          {capability.note || AI_CAPABILITY_EVIDENCE_DESCRIPTIONS[capability.evidence]}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Only the capabilities worth showing on a compact row. */
const SHOWN_KINDS = new Set(["TEXT", "VISION", "TOOLS", "STRUCTURED_OUTPUT"]);

export function CapabilityRow({ capabilities }: { capabilities: AiCatalogCapability[] }) {
  const shown = capabilities.filter((c) => SHOWN_KINDS.has(c.kind) && c.evidence !== "UNKNOWN");
  if (shown.length === 0) {
    return <span className="text-xs text-muted-foreground">No verified capabilities</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((capability) => (
        <CapabilityChip key={capability.kind} capability={capability} />
      ))}
    </span>
  );
}
