"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Tag, Trash2 } from "lucide-react";

import { ErrorState } from "@/components/states";
import { Button, LoadingButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateSubtask, useCreateTaskTag, useDeleteSubtask, useDeleteTaskTag, useSubtasks, useTaskTags, useUpdateSubtask, useUpdateTaskTag } from "@/features/tasks/hooks";
import type { TaskStatus } from "@/types/api-types";

export function TaskExtras({ taskId }: { taskId: string }) {
  const subtasks = useSubtasks(taskId);
  const tags = useTaskTags(taskId);
  const createSubtask = useCreateSubtask(taskId);
  const updateSubtask = useUpdateSubtask(taskId);
  const deleteSubtask = useDeleteSubtask(taskId);
  const createTag = useCreateTaskTag(taskId);
  const updateTag = useUpdateTaskTag(taskId);
  const deleteTag = useDeleteTaskTag(taskId);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("");
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string; kind: "subtask" | "tag" } | null>(null);
  const [tagDrafts, setTagDrafts] = useState<Record<string, { name: string; color: string }>>({});

  const addSubtask = async () => {
    const title = subtaskTitle.trim();
    if (!title) return;
    await createSubtask.mutateAsync({ title });
    setSubtaskTitle("");
  };

  const addTag = async () => {
    const name = tagName.trim();
    if (!name) return;
    await createTag.mutateAsync({ name, ...(tagColor.trim() ? { color: tagColor.trim() } : {}) });
    setTagName("");
    setTagColor("");
  };

  const removeTarget = () => {
    if (!deleteTarget) return;
    const operation = deleteTarget.kind === "subtask"
      ? deleteSubtask.mutateAsync(deleteTarget.id)
      : deleteTag.mutateAsync(deleteTarget.id);
    void operation.catch(() => undefined).finally(() => setDeleteTarget(null));
  };

  const moveSubtask = (current: { id: string; position: number }, adjacent: { id: string; position: number }) => {
    void Promise.allSettled([
      updateSubtask.mutateAsync({ id: current.id, input: { position: adjacent.position } }),
      updateSubtask.mutateAsync({ id: adjacent.id, input: { position: current.position } }),
    ]);
  };

  return (
    <div className="space-y-5 rounded-lg border border-border p-4">
      <section aria-labelledby="task-subtasks-heading">
        <h3 id="task-subtasks-heading" className="text-sm font-semibold">Subtasks</h3>
        {subtasks.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading subtasks…</p>
        ) : subtasks.isError ? (
          <ErrorState error={subtasks.error} retry={() => void subtasks.refetch()} />
        ) : subtasks.data?.length ? (
          <ul className="mt-2 space-y-2">
            {subtasks.data.map((item, index) => {
              const done = item.status === "COMPLETED";
              const draft = subtaskDrafts[item.id] ?? item.title;
              const previous = subtasks.data?.[index - 1];
              const next = subtasks.data?.[index + 1];
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={done ? "secondary" : "outline"}
                    size="icon-sm"
                    aria-label={done ? `Reopen ${item.title}` : `Complete ${item.title}`}
                    disabled={updateSubtask.isPending}
                    onClick={() => updateSubtask.mutate({ id: item.id, input: { status: (done ? "TODO" : "COMPLETED") as TaskStatus } })}
                  >
                    {done && <Check className="h-4 w-4" aria-hidden />}
                  </Button>
                  <Label htmlFor={`subtask-name-${item.id}`} className="sr-only">Subtask title</Label>
                  <Input id={`subtask-name-${item.id}`} value={draft} maxLength={200} className={done ? "min-w-0 flex-1 basis-32 text-muted-foreground line-through" : "min-w-0 flex-1 basis-32"} onChange={(event) => setSubtaskDrafts((current) => ({ ...current, [item.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (draft.trim()) updateSubtask.mutate({ id: item.id, input: { title: draft.trim() } }); } }} />
                  <Button type="button" variant="outline" size="icon-sm" aria-label={`Save ${item.title}`} disabled={!draft.trim() || draft === item.title || updateSubtask.isPending} onClick={() => updateSubtask.mutate({ id: item.id, input: { title: draft.trim() } })}>
                    <Check className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${item.title} up`} disabled={!previous || updateSubtask.isPending} onClick={() => previous && moveSubtask(item, previous)}>
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${item.title} down`} disabled={!next || updateSubtask.isPending} onClick={() => next && moveSubtask(item, next)}>
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${item.title}`} onClick={() => setDeleteTarget({ id: item.id, label: item.title, kind: "subtask" })}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Break this task into smaller steps.</p>
        )}
        <div className="mt-3 flex gap-2">
          <Label htmlFor={`subtask-title-${taskId}`} className="sr-only">New subtask</Label>
          <Input id={`subtask-title-${taskId}`} value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addSubtask().catch(() => undefined); } }} placeholder="Add a subtask" maxLength={200} />
          <LoadingButton type="button" size="icon" aria-label="Add subtask" loading={createSubtask.isPending} disabled={!subtaskTitle.trim()} onClick={() => void addSubtask().catch(() => undefined)}>
            <Plus className="h-4 w-4" aria-hidden />
          </LoadingButton>
        </div>
      </section>

      <section aria-labelledby="task-tags-heading">
        <h3 id="task-tags-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Tag className="h-4 w-4" aria-hidden /> Tags
        </h3>
        {tags.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading tags…</p>
        ) : tags.isError ? (
          <ErrorState error={tags.error} retry={() => void tags.refetch()} />
        ) : tags.data?.length ? (
          <ul className="mt-2 space-y-2">
            {tags.data.map((tag) => {
              const draft = tagDrafts[tag.id] ?? { name: tag.name, color: tag.color ?? "" };
              return (
                <li key={tag.id} className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={`tag-name-${tag.id}`} className="sr-only">Tag name</Label>
                  <Input id={`tag-name-${tag.id}`} value={draft.name} maxLength={50} className="min-w-0 flex-1 basis-32" onChange={(event) => setTagDrafts((current) => ({ ...current, [tag.id]: { ...draft, name: event.target.value } }))} />
                  <Label htmlFor={`tag-color-${tag.id}`} className="sr-only">Tag color</Label>
                  <Input id={`tag-color-${tag.id}`} value={draft.color} maxLength={20} className="w-24" placeholder="Color" onChange={(event) => setTagDrafts((current) => ({ ...current, [tag.id]: { ...draft, color: event.target.value } }))} />
                  <Button type="button" variant="outline" size="icon-sm" aria-label={`Save ${tag.name}`} disabled={!draft.name.trim() || (draft.name === tag.name && draft.color === (tag.color ?? "")) || updateTag.isPending} onClick={() => updateTag.mutate({ id: tag.id, input: { name: draft.name.trim(), color: draft.color.trim() || null } })}>
                    <Check className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete tag ${tag.name}`} onClick={() => setDeleteTarget({ id: tag.id, label: tag.name, kind: "tag" })}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No tags on this task yet.</p>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
          <Label htmlFor={`new-tag-${taskId}`} className="sr-only">New tag name</Label>
          <Input id={`new-tag-${taskId}`} value={tagName} onChange={(event) => setTagName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addTag().catch(() => undefined); } }} placeholder="New tag" maxLength={50} />
          <Label htmlFor={`new-tag-color-${taskId}`} className="sr-only">New tag color</Label>
          <Input id={`new-tag-color-${taskId}`} value={tagColor} onChange={(event) => setTagColor(event.target.value)} placeholder="Color (optional)" maxLength={20} />
          <LoadingButton type="button" size="sm" loading={createTag.isPending} disabled={!tagName.trim()} onClick={() => void addTag().catch(() => undefined)}>
            Add tag
          </LoadingButton>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete ${deleteTarget?.kind ?? "item"}?`}
        description={`“${deleteTarget?.label ?? ""}” will be removed from this task.`}
        onConfirm={removeTarget}
        busy={deleteSubtask.isPending || deleteTag.isPending}
      />
    </div>
  );
}
