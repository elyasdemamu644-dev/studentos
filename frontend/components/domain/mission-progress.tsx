"use client";

import { useMemo } from "react";
import { AlertCircle, CheckCircle, ChevronRight, Clock, Loader2, XCircle, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip, type Tone } from "@/components/panel";
import { type AiMission, type AiMissionStep, MissionStepStatus, MissionStatus } from "@/types/api-types";

export type { AiMission, AiMissionStep, MissionStepStatus, MissionStatus };
import { useApproveMission, useExecuteMission, useRetryMission } from "@/features/ai/hooks";

const STEP_STATUS_LABELS: Record<MissionStepStatus, string> = {
  PENDING: "Pending",
  QUEUED: "Queued",
  RUNNING: "Running",
  WAITING: "Waiting",
  COMPLETED: "Completed",
  FAILED_RECOVERABLE: "Failed (recoverable)",
  FAILED_TERMINAL: "Failed",
  SKIPPED: "Skipped",
  CANCELLED: "Cancelled",
};

const STEP_STATUS_ICONS: Record<MissionStepStatus, React.ComponentType<{ className?: string }>> = {
  PENDING: Clock,
  QUEUED: Clock,
  RUNNING: Loader2,
  WAITING: Clock,
  COMPLETED: CheckCircle,
  FAILED_RECOVERABLE: AlertCircle,
  FAILED_TERMINAL: XCircle,
  SKIPPED: ChevronRight,
  CANCELLED: XCircle,
};

const STEP_STATUS_CHIPS: Record<MissionStepStatus, Tone> = {
  PENDING: "neutral",
  QUEUED: "neutral",
  RUNNING: "primary",
  WAITING: "warning",
  COMPLETED: "success",
  FAILED_RECOVERABLE: "warning",
  FAILED_TERMINAL: "danger",
  SKIPPED: "neutral",
  CANCELLED: "danger",
};

const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  WAITING: "Waiting",
  PARTIAL: "Partial",
  FAILED_RECOVERABLE: "Failed (recoverable)",
  FAILED_TERMINAL: "Failed",
  CANCEL_REQUESTED: "Cancelling…",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

interface MissionProgressProps {
  mission: AiMission;
  onExecute?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onApprove?: () => void;
  compact?: boolean;
}

export function MissionProgress({
  mission,
  onExecute,
  onRetry,
  onCancel,
  onApprove,
  compact = false,
}: MissionProgressProps) {
  const executeMission = useExecuteMission();
  const retryMission = useRetryMission();
  const approveMission = useApproveMission();

  const handleExecute = async () => {
    if (onExecute) {
      onExecute();
      return;
    }
    try {
      await executeMission.mutateAsync(mission.id);
    } catch (error) {
      console.error("Failed to execute mission:", error);
    }
  };

  const handleRetry = async () => {
    if (onRetry) {
      onRetry();
      return;
    }
    try {
      await retryMission.mutateAsync(mission.id);
    } catch (error) {
      console.error("Failed to retry mission:", error);
    }
  };

  const handleApprove = async () => {
    if (onApprove) {
      onApprove();
      return;
    }
    try {
      await approveMission.mutateAsync(mission.id);
    } catch (error) {
      console.error("Failed to approve mission change:", error);
    }
  };

  // Sorted on a copy: `steps` belongs to the query cache, and sorting it in
  // place would mutate the cached mission.
  const steps = useMemo(() => [...mission.steps].sort((a, b) => a.stepOrder - b.stepOrder), [mission.steps]);

  const statusCounts = useMemo(() => {
    const counts: Record<MissionStepStatus, number> = {
      PENDING: 0,
      QUEUED: 0,
      RUNNING: 0,
      WAITING: 0,
      COMPLETED: 0,
      FAILED_RECOVERABLE: 0,
      FAILED_TERMINAL: 0,
      SKIPPED: 0,
      CANCELLED: 0,
    };
    for (const step of steps) {
      counts[step.status]++;
    }
    return counts;
  }, [steps]);

  const isTerminal = ["COMPLETED", "CANCELLED", "FAILED_TERMINAL"].includes(mission.status);
  const isRunning = mission.status === "RUNNING";
  const isWaiting = mission.status === "WAITING";
  // PARTIAL is a failed mission: some steps are done and some are not, and
  // the failed ones can be run again.
  const isFailed = ["FAILED_RECOVERABLE", "FAILED_TERMINAL", "PARTIAL"].includes(mission.status);
  const canRetry = isFailed;
  // A mission can be started when it has not run yet. A WAITING mission is
  // not waiting to run — it is waiting for the student to approve a change,
  // which has its own button.
  const canExecute = mission.status === "QUEUED";
  const canApprove = isWaiting && mission.pendingAction?.status === "PENDING";
  const showCancel = (isRunning || isWaiting) && !isTerminal;
  const pendingAction = mission.pendingAction;

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Mission</span>
          <Chip tone={isFailed ? "danger" : isWaiting ? "warning" : isRunning ? "primary" : isTerminal ? "success" : "neutral"}>
            {MISSION_STATUS_LABELS[mission.status]}
          </Chip>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {statusCounts.COMPLETED} of {steps.length} steps completed
          {statusCounts.FAILED_TERMINAL > 0 && <span className="text-danger">, {statusCounts.FAILED_TERMINAL} failed</span>}
          {statusCounts.FAILED_RECOVERABLE > 0 && <span className="text-warning">, {statusCounts.FAILED_RECOVERABLE} recoverable</span>}
          {statusCounts.RUNNING > 0 && <span className="text-primary">, {statusCounts.RUNNING} running</span>}
        </div>
        {canApprove && pendingAction && (
          <p className="text-xs text-warning">Waiting for your approval: {pendingAction.title}</p>
        )}
        {(!isTerminal || canRetry) && (
          <div className="flex gap-2 pt-1">
            {canExecute && (
              <Button size="sm" onClick={handleExecute} disabled={executeMission.isPending}>
                <Zap className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Execute
              </Button>
            )}
            {canApprove && (
              <Button size="sm" onClick={handleApprove} disabled={approveMission.isPending}>
                <CheckCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Approve change
              </Button>
            )}
            {canRetry && (
              <Button size="sm" variant="outline" onClick={handleRetry} disabled={retryMission.isPending}>
                Retry
              </Button>
            )}
            {showCancel && onCancel && (
              <Button size="sm" variant="ghost" onClick={onCancel} className="text-danger hover:bg-danger/10">
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 border border-border/50 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold truncate max-w-[300px]">{mission.objective}</h4>
          <p className="text-sm text-muted-foreground">{steps.length} steps · {mission.updatedAt}</p>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone={isFailed ? "danger" : isWaiting ? "warning" : isRunning ? "primary" : isTerminal ? "success" : "neutral"}>
            {MISSION_STATUS_LABELS[mission.status]}
          </Chip>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        <Chip tone="success" className="h-5 px-2 text-[10px]">
          {statusCounts.COMPLETED} done
        </Chip>
        {statusCounts.FAILED_TERMINAL > 0 && (
          <Chip tone="danger" className="h-5 px-2 text-[10px]">
            {statusCounts.FAILED_TERMINAL} failed
          </Chip>
        )}
        {statusCounts.FAILED_RECOVERABLE > 0 && (
          <Chip tone="warning" className="h-5 px-2 text-[10px]">
            {statusCounts.FAILED_RECOVERABLE} recoverable
          </Chip>
        )}
        {statusCounts.RUNNING > 0 && (
          <Chip tone="primary" className="h-5 px-2 text-[10px]">
            {statusCounts.RUNNING} running
          </Chip>
        )}
        {statusCounts.WAITING > 0 && (
          <Chip tone="neutral" className="h-5 px-2 text-[10px]">
            {statusCounts.WAITING} waiting
          </Chip>
        )}
        {statusCounts.PENDING > 0 && (
          <Chip tone="neutral" className="h-5 px-2 text-[10px]">
            {statusCounts.PENDING} pending
          </Chip>
        )}
      </div>

      <div className="space-y-2">
        {steps.map((step) => (
          <MissionStepRow key={step.id} step={step} allSteps={steps} />
        ))}
      </div>

      {canApprove && pendingAction && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
          <p className="text-sm font-medium">This mission needs your approval</p>
          <p className="text-xs text-muted-foreground">{pendingAction.title}</p>
          <ul className="space-y-1">
            {pendingAction.actions.map((action) => (
              <li key={`${action.tool}-${action.description}`} className="text-xs">
                <span className="font-mono text-muted-foreground">{action.tool}</span>
                {action.description ? <span className="text-muted-foreground"> — {action.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
        {canExecute && (
          <Button onClick={handleExecute} disabled={executeMission.isPending}>
            <Zap className="mr-1.5 h-4 w-4" aria-hidden />
            Execute Mission
          </Button>
        )}
        {canApprove && (
          <Button onClick={handleApprove} disabled={approveMission.isPending}>
            <CheckCircle className="mr-1.5 h-4 w-4" aria-hidden />
            Approve Change
          </Button>
        )}
        {canRetry && (
          <Button variant="outline" onClick={handleRetry} disabled={retryMission.isPending}>
            Retry Failed Steps
          </Button>
        )}
        {showCancel && onCancel && (
          <Button variant="ghost" onClick={onCancel} className="text-danger hover:bg-danger/10">
            Cancel Mission
          </Button>
        )}
      </div>
    </div>
  );
}

interface MissionStepRowProps {
  step: AiMissionStep;
  allSteps: AiMissionStep[];
}

function MissionStepRow({ step, allSteps }: MissionStepRowProps) {
  const Icon = STEP_STATUS_ICONS[step.status];
  const depsMet = step.dependsOn.length === 0 ||
    step.dependsOn.every((depId) => allSteps.find((s) => s.id === depId)?.status === "COMPLETED");

  const isBlocked = ["PENDING", "FAILED_RECOVERABLE"].includes(step.status) && !depsMet;

  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
        step.status === "RUNNING" ? "bg-primary/5" : ""
      } ${isBlocked ? "opacity-50" : ""}`}
    >
      <Icon className={`h-4 w-4 flex-shrink-0 ${STEP_STATUS_CHIPS[step.status] === "success" ? "text-success" : STEP_STATUS_CHIPS[step.status] === "danger" ? "text-danger" : STEP_STATUS_CHIPS[step.status] === "warning" ? "text-warning" : STEP_STATUS_CHIPS[step.status] === "primary" ? "text-primary" : "text-muted-foreground"}`} aria-hidden />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{step.description}</span>
          <Chip tone={STEP_STATUS_CHIPS[step.status]} className="h-5 px-2 text-[10px]">
            {STEP_STATUS_LABELS[step.status]}
          </Chip>
          {step.attempts > 1 && (
            <Chip tone="neutral" className="h-5 px-2 text-[10px]">
              Attempt {step.attempts}/{step.maxAttempts}
            </Chip>
          )}
          {isBlocked && (
            <Chip tone="neutral" className="h-5 px-2 text-[10px]">
              Waiting on deps
            </Chip>
          )}
          {step.status === "WAITING" && step.pendingActionId && (
            <Chip tone="warning" className="h-5 px-2 text-[10px]">
              Needs your approval
            </Chip>
          )}
        </div>

        <p className="text-xs text-muted-foreground truncate font-mono">
          {step.toolName}
          {step.error && <span className="text-danger ml-2">— {step.error}</span>}
        </p>
      </div>

      {step.status === "RUNNING" && (
        <Loader2 className="h-4 w-4 text-primary animate-spin" aria-hidden />
      )}
      {step.status === "COMPLETED" && (
        <CheckCircle className="h-4 w-4 text-success flex-shrink-0" aria-hidden />
      )}
      {step.status === "FAILED_TERMINAL" && (
        <XCircle className="h-4 w-4 text-danger flex-shrink-0" aria-hidden />
      )}
      {step.status === "FAILED_RECOVERABLE" && (
        <AlertCircle className="h-4 w-4 text-warning flex-shrink-0" aria-hidden />
      )}
    </div>
  );
}

export function MissionList({ missions, onSelect }: { missions: AiMission[]; onSelect?: (mission: AiMission) => void }) {
  return (
    <div className="space-y-2">
      {missions.map((mission) => (
        <div
          key={mission.id}
          className="border border-border/50 rounded-lg p-3 hover:bg-muted/30 cursor-pointer transition-colors"
          onClick={() => onSelect?.(mission)}
        >
          <MissionProgress mission={mission} compact />
        </div>
      ))}
    </div>
  );
}