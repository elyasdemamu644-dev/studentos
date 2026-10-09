"use client";

import { useState } from "react";
import { CheckCircle2, Pencil, Plug, Plus, Power, Trash2 } from "lucide-react";

import type { AiConnection } from "@/types/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { AI_PROVIDER_LABELS } from "@/lib/labels";
import { useActivateConnection, useAiConnections, useDeleteConnection, useUpdateConnection } from "./hooks";
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
            disabled={busy}
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
          onClick={() => remove.mutate(connection.id)}
          aria-label={`Delete ${AI_PROVIDER_LABELS[connection.provider]}`}
        >
          <Trash2 className="h-4 w-4 text-danger" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

export function AiConnectionsPanel() {
  const connections = useAiConnections();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AiConnection | undefined>(undefined);

  const items = connections.data?.items ?? [];

  return (
    <section className="surface-panel p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
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
        The active connection is the one the AI assistant uses for chats and study plans.
      </p>

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
