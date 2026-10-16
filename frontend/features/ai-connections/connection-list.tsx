"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, Pencil, Plug, Plus, Power, Sparkles, Trash2 } from "lucide-react";

import type { AiConnection } from "@/types/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { AI_PROVIDER_LABELS } from "@/lib/labels";
import {
  useActivateConnection,
  useAiConnections,
  useAiProviderSelection,
  useDeleteConnection,
  useSetAiProviderMode,
  useUpdateConnection,
} from "./hooks";
import { AiConnectionFormDialog } from "./connection-form";

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
        Choose StudentOS Default AI or an AI connection you configured yourself.
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
              <span className="block text-sm font-medium">StudentOS Default AI</span>
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
