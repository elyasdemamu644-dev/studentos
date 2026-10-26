"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, Pencil, Plug, Plus, Power, Sparkles, Trash2 } from "lucide-react";

import type { AiConnection, AiMode, ExecutionAutonomyMode } from "@/types/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { AI_MODE_DESCRIPTIONS, AI_MODE_LABELS, AI_MODES, AI_PROVIDER_LABELS, EXECUTION_AUTONOMY_MODE_DESCRIPTIONS, EXECUTION_AUTONOMY_MODE_LABELS, EXECUTION_AUTONOMY_MODES } from "@/lib/labels";
import {
  useActivateConnection,
  useAiConnections,
  useAiProviderSelection,
  useDefaultAiModels,
  useDeleteConnection,
  useSetAiMode,
  useSetAiProviderMode,
  useSetDefaultModel,
  useSetExecutionAutonomyMode,
  useUpdateConnection,
} from "./hooks";
import { AiConnectionFormDialog } from "./connection-form";

/** Radix Select forbids an empty value, so "server default" needs a sentinel. */
const SERVER_DEFAULT_MODEL = "__server_default__";

function ConnectionRow({
  connection,
  onEdit,
}: {
  connection: AiConnection;
  onEdit: (connection: AiConnection) => void;
}) {
  const activate = useActivateConnection();
  const remove = useDeleteConnection();
  const update = useUpdateConnection();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const busy = activate.isPending || remove.isPending || update.isPending;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {AI_PROVIDER_LABELS[connection.provider]}
          {connection.isActive && (
            <Badge variant="success" className="gap-1 px-1.5 py-0 text-[10px]">
              <CheckCircle2 className="h-3 w-3" aria-hidden /> Active
            </Badge>
          )}
          {!connection.enabled && <Badge variant="muted" className="px-1.5 py-0 text-[10px]">Disabled</Badge>}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {connection.model ?? "Default model"}
          {connection.endpoint ? ` · ${connection.endpoint}` : ""}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <Switch
          checked={connection.enabled}
          disabled={busy}
          onCheckedChange={(checked) => update.mutate({ id: connection.id, input: { enabled: checked } })}
          aria-label={`Enable ${AI_PROVIDER_LABELS[connection.provider]}`}
        />
        {!connection.isActive && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !connection.enabled}
            onClick={() => activate.mutate(connection.id)}
          >
            <Power className="mr-1.5 h-4 w-4" aria-hidden /> Activate
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          onClick={() => onEdit(connection)}
          aria-label={`Edit ${AI_PROVIDER_LABELS[connection.provider]}`}
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
          aria-label={`Delete ${AI_PROVIDER_LABELS[connection.provider]}`}
        >
          <Trash2 className="h-4 w-4 text-danger" aria-hidden />
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete connection"
        description={`This removes the ${AI_PROVIDER_LABELS[connection.provider]} connection and its stored credentials. This cannot be undone.`}
        confirmLabel="Delete connection"
        busy={remove.isPending}
        onConfirm={() =>
          remove.mutate(connection.id, { onSuccess: () => setConfirmOpen(false) })
        }
      />
    </li>
  );
}

export function AiConnectionsPanel() {
  const connections = useAiConnections();
  const providerSelection = useAiProviderSelection();
  const setProviderMode = useSetAiProviderMode();
  const setAiMode = useSetAiMode();
  const setExecutionAutonomyMode = useSetExecutionAutonomyMode();
  const models = useDefaultAiModels();
  const setDefaultModel = useSetDefaultModel();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AiConnection | undefined>(undefined);

  const items = connections.data?.items ?? [];

  return (
    <section className="surface-panel p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Plug className="h-4 w-4 text-primary" aria-hidden /> AI connections
        </h2>
        <Button
          size="sm"
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add connection
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Choose Tutor Walle Default AI or an AI connection you configured yourself.
      </p>

      {providerSelection.isPending ? (
        <ListSkeleton rows={1} />
      ) : providerSelection.isError ? (
        <ErrorState error={providerSelection.error} retry={() => providerSelection.refetch()} />
      ) : (
        <fieldset className="mb-5 space-y-2">
          <legend className="mb-2 text-sm font-medium">Provider used by the assistant</legend>
          <button
            type="button"
            aria-pressed={providerSelection.data.mode === "default"}
            disabled={!providerSelection.data.defaultAvailable || setProviderMode.isPending}
            onClick={() => setProviderMode.mutate("default")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:border-primary aria-pressed:bg-primary/5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Tutor Walle Default AI</span>
              <span className="block truncate text-xs text-muted-foreground">
                {providerSelection.data.defaultAvailable
                  ? `${providerSelection.data.defaultProvider} · ${providerSelection.data.defaultModel}`
                  : "Not configured on this server"}
              </span>
            </span>
            {providerSelection.data.mode === "default" && (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-label="Selected" />
            )}
          </button>
          <button
            type="button"
            aria-pressed={providerSelection.data.mode === "personal"}
            disabled={!providerSelection.data.personalConnectionAvailable || setProviderMode.isPending}
            onClick={() => setProviderMode.mutate("personal")}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:border-primary aria-pressed:bg-primary/5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <KeyRound className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">My AI connection</span>
              <span className="block text-xs text-muted-foreground">
                {providerSelection.data.personalConnectionAvailable
                  ? "Use your active, encrypted provider credentials"
                  : "Add and activate a connection below"}
              </span>
            </span>
            {providerSelection.data.mode === "personal" && (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-label="Selected" />
            )}
          </button>
        </fieldset>
      )}

      {/* AI mode. How the assistant runs each reply, whatever provider answers.
          Kept separate from the provider/model choice: it never changes who
          answers, and no mode relaxes the write-confirmation rules. */}
      {!providerSelection.isPending && !providerSelection.isError && (
        <div className="mb-5 space-y-1.5">
          <label htmlFor="ai-mode" className="text-sm font-medium">
            AI mode
          </label>
          <Select
            value={providerSelection.data.aiMode}
            onValueChange={(value) => setAiMode.mutate(value as AiMode)}
            disabled={setAiMode.isPending}
          >
            <SelectTrigger id="ai-mode" aria-label="AI mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {AI_MODE_LABELS[mode]} — {AI_MODE_DESCRIPTIONS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            How the assistant runs your replies. It does not change which model
            answers, and it never changes what needs your confirmation.
          </p>
        </div>
      )}

      {/* Execution autonomy. Whether safe WRITE tools run without confirmation.
          Kept separate from AI mode (which controls reasoning depth) and model
          selection (which controls who answers). */}
      {!providerSelection.isPending && !providerSelection.isError && (
        <div className="mb-5 space-y-1.5">
          <label htmlFor="execution-autonomy-mode" className="text-sm font-medium">
            Execution autonomy
          </label>
          <Select
            value={providerSelection.data.executionAutonomyMode}
            onValueChange={(value) => setExecutionAutonomyMode.mutate(value as ExecutionAutonomyMode)}
            disabled={setExecutionAutonomyMode.isPending}
          >
            <SelectTrigger id="execution-autonomy-mode" aria-label="Execution autonomy" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXECUTION_AUTONOMY_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {EXECUTION_AUTONOMY_MODE_LABELS[mode]} — {EXECUTION_AUTONOMY_MODE_DESCRIPTIONS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Whether safe changes run automatically. In autonomous mode, a curated
            set of safe WRITE tools (like creating tasks, notes, or study sessions)
            runs without asking for confirmation each time. You can still review
            and cancel any pending action.
          </p>
        </div>
      )}

      {/* Default AI model. Shown only when Tutor Walle Default AI is the
          selected provider: a personal connection carries its own model, so the
          preference would have no effect there. */}
      {!providerSelection.isPending && !providerSelection.isError &&
        providerSelection.data.mode === "default" && (
          <div className="mb-5 space-y-1.5">
            <label htmlFor="default-ai-model" className="text-sm font-medium">
              Default AI model
            </label>
            <Select
              value={
                models.isPending
                  ? undefined
                  : providerSelection.data.model ?? SERVER_DEFAULT_MODEL
              }
              onValueChange={(value) =>
                setDefaultModel.mutate(value === SERVER_DEFAULT_MODEL ? null : value)
              }
              disabled={models.isPending || setDefaultModel.isPending}
            >
              <SelectTrigger id="default-ai-model" aria-label="Default AI model" className="w-full">
                <SelectValue placeholder="Server default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SERVER_DEFAULT_MODEL}>
                  Server default ({providerSelection.data.defaultModel})
                </SelectItem>
                {models.data?.group.models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
                {providerSelection.data.model &&
                  !models.data?.group.models.some((model) => model.id === providerSelection.data.model) && (
                    <SelectItem value={providerSelection.data.model}>
                      {providerSelection.data.model} (custom)
                    </SelectItem>
                  )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Applies to Tutor Walle Default AI. Your own connections keep their own model.
            </p>
          </div>
        )}

      {connections.isPending ? (
        <ListSkeleton rows={2} />
      ) : connections.isError ? (
        <ErrorState error={connections.error} retry={() => connections.refetch()} />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-primary/30 bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
          No AI connections yet. Add one to power the assistant.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              onEdit={(c) => {
                setEditing(c);
                setFormOpen(true);
              }}
            />
          ))}
        </ul>
      )}

      <AiConnectionFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(undefined);
        }}
        connection={editing}
      />
    </section>
  );
}
