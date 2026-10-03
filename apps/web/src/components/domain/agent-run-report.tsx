"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Layers,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AI_PROVIDER_LABELS } from "@/lib/labels";
import type { AiAgentRun } from "@/types/api-types";

/**
 * What the last turn actually cost and how it ended.
 *
 * Every value here is a field of `AiAgentRun` as returned by
 * `POST /ai/conversations/:id/messages`. Nothing is inferred and nothing is
 * simulated: if the API did not report a run, this renders nothing at all
 * rather than a plausible-looking summary.
 *
 * It exists because the assistant otherwise gives no signal about *why* an
 * answer looks the way it does. `finish` in particular is the honest way to
 * surface a turn that hit the tool budget or came from a provider with no tool
 * calling at all.
 */
const FINISH_COPY: Record<
  AiAgentRun["finish"],
  { label: string; detail: string; tone: "success" | "warning" | "danger" }
> = {
  answered: {
    label: "Answered",
    detail: "The model replied using your StudentOS data.",
    tone: "success",
  },
  confirmation_pending: {
    label: "Waiting for you",
    detail: "The assistant prepared a change. Nothing is applied until you confirm it.",
    tone: "warning",
  },
  tool_limit: {
    label: "Hit the tool limit",
    detail:
      "This turn used as many tool calls as one message is allowed. It may have stopped before finishing.",
    tone: "warning",
  },
  no_tool_support: {
    label: "No tool calling on this provider",
    detail:
      "The configured provider cannot call StudentOS tools, so this answer came from the model alone and could not read or change your data.",
    tone: "danger",
  },
};

const TONE = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
} as const;

export function AgentRunReport({ run }: { run: AiAgentRun }) {
  const [open, setOpen] = useState(false);
  const finish = FINISH_COPY[run.finish] ?? FINISH_COPY.answered;
  const Icon = run.finish === "answered" ? CheckCircle2 : run.finish === "no_tool_support" ? Ban : AlertTriangle;

  return (
    <div className="rounded-xl border border-border bg-muted/30 text-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", TONE[finish.tone])} aria-hidden />
        <span className={cn("font-medium", TONE[finish.tone])}>{finish.label}</span>
        <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:inline">
          {run.model}
        </span>
        <ChevronDown
          className={cn("ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
      </button>

      {open && (
        <div className="animate-fade-in space-y-2.5 border-t border-border/70 px-3 pb-3 pt-2.5">
          <p className="text-muted-foreground">{finish.detail}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
            <Fact icon={Cpu} term="Provider" detail={AI_PROVIDER_LABELS[run.provider] ?? run.provider} />
            <Fact icon={Layers} term="Model" detail={run.model} />
            <Fact icon={Wrench} term="Tools called" detail={run.usedTools ? "Yes" : "None"} />
            <Fact icon={Layers} term="Rounds" detail={String(run.rounds)} />
          </dl>
          {!run.toolSupport && (
            <p className="rounded-md bg-danger/10 px-2.5 py-2 text-danger">
              This provider does not support tool calling, so the assistant cannot read your StudentOS
              data or propose changes.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({
  icon: Icon,
  term,
  detail,
}: {
  icon: typeof Cpu;
  term: string;
  detail: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        {term}
      </dt>
      <dd className="mt-0.5 truncate font-medium text-foreground" title={detail}>
        {detail}
      </dd>
    </div>
  );
}