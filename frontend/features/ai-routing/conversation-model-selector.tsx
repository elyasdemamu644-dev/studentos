"use client";

import { Cpu, Check } from "lucide-react";

import { Select, SelectTrigger, SelectValue, SelectItem, SelectContent } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { AiProviderName } from "@/types/api-types";
import {
  useConversationPreference,
  useRoutingCatalog,
  useSetConversationPreference,
} from "./hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Per-conversation model selector
// ─────────────────────────────────────────────────────────────────────────────
//
// Lets the student pin a specific model for one conversation. The choice is
// saved server-side as a conversation-scoped preference and takes precedence
// over the global default — but it is still filtered by the routing policy
// server-side, so a pinned model that policy forbids is reported unavailable
// rather than used.

const FOLLOW_DEFAULT = "__default__";

export function ConversationModelSelector({
  conversationId,
  disabled,
}: {
  conversationId: string | null;
  disabled?: boolean;
}) {
  const catalog = useRoutingCatalog();
  const preference = useConversationPreference(conversationId);
  const setPreference = useSetConversationPreference(conversationId);

  // Nothing to offer (no conversation, catalog not loaded or malformed, or an
  // error): render nothing rather than a broken control.
  if (!conversationId || catalog.isPending || catalog.isError || !Array.isArray(catalog.data)) {
    return null;
  }

  const allModels = catalog.data.flatMap((group) =>
    group.models.map((model) => ({ ...model, provider: group.provider as AiProviderName })),
  );

  const current = preference.data ?? null;
  const value = current ? `${current.provider}:${current.model}` : FOLLOW_DEFAULT;

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === FOLLOW_DEFAULT) {
          setPreference.mutate({ provider: null, model: null });
          return;
        }
        const [provider, ...rest] = next.split(":");
        const model = rest.join(":");
        setPreference.mutate({ provider, model });
      }}
      disabled={disabled || setPreference.isPending}
    >
      <SelectTrigger
        className="h-9 w-auto shrink-0 gap-1.5 rounded-xl border-border bg-transparent px-2.5 text-muted-foreground hover:text-foreground sm:px-3"
        aria-label="Model for this conversation"
        title="Model for this conversation"
      >
        <Cpu className="h-4 w-4 shrink-0" aria-hidden />
        <SelectValue>
          {current ? current.model : "Default model"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" side="top" className="w-72">
        <SelectItem value={FOLLOW_DEFAULT}>
          <span className="flex items-center gap-2">
            {!current && <Check className="h-3.5 w-3.5" aria-hidden />}
            <span>
              <span className="block font-medium">Follow my default</span>
              <span className="block text-xs text-muted-foreground">
                Use your routing policy for this conversation
              </span>
            </span>
          </span>
        </SelectItem>
        {allModels.map((model) => {
          const key = `${model.provider}:${model.id}`;
          const selected = value === key;
          return (
            <SelectItem key={key} value={key}>
              <span className="flex items-center gap-2">
                {selected && <Check className="h-3.5 w-3.5" aria-hidden />}
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    {model.label}
                    {model.free && <Badge variant="success">Free</Badge>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {model.provider}
                  </span>
                </span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
