"use client";

import { useState } from "react";
import { Brain, Pencil, Plus, Sparkles, Trash2, UserRound } from "lucide-react";

import type { AiMemory, MemoryCategory } from "@/types/api-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/states";
import { ListSkeleton } from "@/components/feedback";
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS } from "@/lib/labels";
import { useSettings, useUpdateSettings } from "@/features/settings/hooks";
import {
  useClearAllMemories,
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useUpdateMemory,
} from "./hooks";

/** Mirrors the API's content cap so the form never sends a rejected body. */
const MAX_CONTENT_LENGTH = 1000;

/** Radix Select forbids an empty value, so "all categories" needs a sentinel. */
const ALL_CATEGORIES = "__all__";

function MemoryRow({ memory }: { memory: AiMemory }) {
  const remove = useDeleteMemory();
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm" style={{ overflowWrap: "anywhere" }}>
            {memory.content}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="muted" className="px-1.5 py-0 text-[10px]">
              {MEMORY_CATEGORY_LABELS[memory.category]}
            </Badge>
            <Badge variant={memory.provenance === "AI" ? "secondary" : "outline"} className="px-1.5 py-0 text-[10px]">
              {memory.provenance === "AI" ? (
                <Sparkles className="h-3 w-3" aria-hidden />
              ) : (
                <UserRound className="h-3 w-3" aria-hidden />
              )}
              {memory.provenance === "AI" ? "Saved by assistant" : "You"}
            </Badge>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setEditing(true)}
            aria-label={`Edit memory: ${memory.content}`}
            title="Edit memory"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={remove.isPending}
            onClick={() => setConfirmOpen(true)}
            aria-label={`Delete memory: ${memory.content}`}
            title="Delete memory"
          >
            <Trash2 className="h-4 w-4 text-danger" aria-hidden />
          </Button>
        </div>
      </div>

      <MemoryDialog
        open={editing}
        onOpenChange={(open) => {
          setEditing(open);
        }}
        memory={memory}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete memory"
        description="Remove this saved memory? The assistant will stop seeing it in future chats."
        confirmLabel="Delete memory"
        busy={remove.isPending}
        onConfirm={() =>
          remove.mutate(memory.id, { onSuccess: () => setConfirmOpen(false) })
        }
      />
    </li>
  );
}

/** Add (memory undefined) or edit (memory given) one saved memory. */
function MemoryDialog({
  open,
  onOpenChange,
  memory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memory?: AiMemory;
}) {
  const create = useCreateMemory();
  const update = useUpdateMemory();
  const [content, setContent] = useState(memory?.content ?? "");
  const [category, setCategory] = useState<MemoryCategory>(memory?.category ?? "OTHER");

  // Re-open with the row's own values rather than the state a previous
  // dialog left behind.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setContent(memory?.content ?? "");
      setCategory(memory?.category ?? "OTHER");
    }
  }

  const trimmed = content.trim();
  const unchanged =
    memory !== undefined && trimmed === memory.content && category === memory.category;
  const valid = trimmed.length > 0 && trimmed.length <= MAX_CONTENT_LENGTH;
  const pending = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || unchanged) return;
    const done = () => onOpenChange(false);
    if (memory) {
      update.mutate({ id: memory.id, input: { content: trimmed, category } }, { onSuccess: done });
    } else {
      create.mutate({ content: trimmed, category }, { onSuccess: done });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{memory ? "Edit memory" : "Add memory"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 px-4 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor="memory-content">What should Tutor Walle remember?</Label>
            <Textarea
              id="memory-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="e.g. I revise best in the morning"
              maxLength={MAX_CONTENT_LENGTH}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {content.length} / {MAX_CONTENT_LENGTH} characters · shared with the assistant as
              data, never as instructions.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="memory-category">Category</Label>
            <Select value={category} onValueChange={(value) => setCategory(value as MemoryCategory)}>
              <SelectTrigger id="memory-category" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {MEMORY_CATEGORY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || unchanged || pending}>
              {pending ? "Saving…" : "Save memory"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MemoryPanel() {
  const memories = useMemories();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const clearAll = useClearAllMemories();
  const [filter, setFilter] = useState<string>(ALL_CATEGORIES);
  const [formOpen, setFormOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const items = (memories.data?.items ?? []).filter(
    (memory) => filter === ALL_CATEGORIES || memory.category === filter,
  );
  const total = memories.data?.items.length ?? 0;
  const memoryEnabled = settings.data?.["ai.memoryEnabled"] !== "false";

  return (
    <section className="surface-panel p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Brain className="h-4 w-4 text-primary" aria-hidden /> Assistant memory
        </h2>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={clearAll.isPending}
              onClick={() => setClearConfirmOpen(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Clear all
            </Button>
          )}
          <Button
            size="sm"
            disabled={settings.isPending}
            onClick={() => setFormOpen(true)}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add memory
          </Button>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Facts you save for the assistant to reuse in future chats. Memories are shared as data —
        they can never change how the assistant behaves beyond remembering them.
      </p>

      {/* Whether the assistant reads saved memories at all. The list stays
          reachable either way, so turning this off never hides what was saved. */}
      <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">Use saved memories in chats</p>
          <p className="text-xs text-muted-foreground">
            When off, replies ignore saved memories. Your list below stays intact.
          </p>
        </div>
        <Switch
          checked={memoryEnabled}
          disabled={settings.isPending || updateSettings.isPending}
          onCheckedChange={(checked) =>
            updateSettings.mutate({ "ai.memoryEnabled": checked ? "true" : "false" })
          }
          aria-label="Use saved memories in chats"
        />
      </div>

      {total > 0 && (
        <div className="mb-3">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 w-full sm:w-56" aria-label="Filter memories by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>All categories ({total})</SelectItem>
              {MEMORY_CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {MEMORY_CATEGORY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {memories.isPending ? (
        <ListSkeleton rows={3} />
      ) : memories.isError ? (
        <ErrorState error={memories.error} retry={() => memories.refetch()} />
      ) : total === 0 ? (
        <p className="rounded-lg border border-primary/30 bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
          No saved memories yet. Add one so Tutor Walle can remember how you like to work.
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
          No memories in this category.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} />
          ))}
        </ul>
      )}

      <MemoryDialog open={formOpen} onOpenChange={setFormOpen} />

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title="Clear all memories"
        description={`This deletes all ${total} saved memories. The assistant will start fresh in future chats.`}
        confirmLabel="Clear all memories"
        busy={clearAll.isPending}
        onConfirm={() =>
          clearAll.mutate(undefined, { onSuccess: () => setClearConfirmOpen(false) })
        }
      />
    </section>
  );
}
