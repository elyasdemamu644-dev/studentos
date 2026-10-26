"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatApiError } from "@/components/states";
import type { MissionToolCatalogEntry } from "@/types/api-types";
import { useConversations, useCreateMission, useMissionTools } from "@/features/ai/hooks";
import {
  coerceArguments,
  defaultForField,
  enumLabel,
  getFieldDescriptors,
  isNullable,
  type ToolFormState,
} from "@/features/ai/mission-tools";

interface MissionBuilderProps {
  conversationId?: string | null;
  trigger?: React.ReactNode;
  onCreated?: (missionId: string) => void;
}

function groupTools(tools: MissionToolCatalogEntry[]) {
  const groups: Array<{ kind: string; items: MissionToolCatalogEntry[] }> = [
    { kind: "READ", items: [] },
    { kind: "ANALYZE", items: [] },
    { kind: "WRITE", items: [] },
  ];
  for (const t of tools) {
    const g = groups.find((gr) => gr.kind === t.kind);
    if (g) g.items.push(t);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function MissionBuilder({ conversationId, trigger, onCreated }: MissionBuilderProps) {
  const [open, setOpen] = useState(false);
  const toolsQuery = useMissionTools();
  const conversationsQuery = useConversations({});
  const createMission = useCreateMission();

  const [objective, setObjective] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<string>("");
  const [steps, setSteps] = useState<ToolFormState[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && conversationId) {
      setSelectedConversationId(conversationId);
    }
  }, [open, conversationId]);

  const catalog = toolsQuery.data?.tools;
  const tools = useMemo(() => catalog ?? [], [catalog]);
  const grouped = useMemo(() => groupTools(tools), [tools]);
  const conversations = conversationsQuery.data?.items ?? [];

  function addStep() {
    setSteps((prev) => [
      ...prev,
      {
        toolName: tools[0]?.name ?? "",
        description: "",
        dependsOn: [],
        arguments: {},
      },
    ]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function updateStep(index: number, patch: Partial<ToolFormState>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function setArg(stepIndex: number, key: string, value: unknown) {
    setSteps((prev) =>
      prev.map((s, i) => (i === stepIndex ? { ...s, arguments: { ...s.arguments, [key]: value } } : s)),
    );
  }

  function reset() {
    setObjective("");
    setSteps([]);
    setError(null);
    setSelectedConversationId(conversationId ?? "");
  }

  function handleCreate() {
    setError(null);
    if (!objective.trim()) {
      setError("Add an objective for this mission.");
      return;
    }
    if (steps.length === 0) {
      setError("Add at least one step.");
      return;
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.toolName) {
        setError(`Pick a tool for step ${i + 1}.`);
        return;
      }
      if (!step.description.trim()) {
        setError(`Add a description for step ${i + 1}.`);
        return;
      }
      const tool = tools.find((t) => t.name === step.toolName);
      if (tool?.requiresApproval && !selectedConversationId) {
        setError("This step changes your data and needs your approval, but the mission has no conversation to ask in.");
        return;
      }
      const descriptors = getFieldDescriptors(tool);
      for (const field of descriptors) {
        if (field.required && field.kind !== "boolean") {
          const v = step.arguments[field.name];
          if (v === undefined || v === null || v === "") {
            setError(`Fill in "${field.name}" for step ${i + 1}.`);
            return;
          }
        }
      }
    }

    const payloadSteps = steps.map((step, idx) => {
      const tool = tools.find((t) => t.name === step.toolName);
      const descriptors = getFieldDescriptors(tool);
      const args = coerceArguments(descriptors, step.arguments);
      return {
        toolName: step.toolName,
        description: step.description.trim(),
        arguments: args,
        dependsOn: step.dependsOn.filter((d) => {
          const n = Number(d);
          return Number.isInteger(n) && n >= 0 && n < idx;
        }),
      };
    });

    createMission.mutate(
      {
        objective: objective.trim(),
        conversationId: selectedConversationId || undefined,
        steps: payloadSteps,
      },
      {
        onSuccess: (mission) => {
          setOpen(false);
          reset();
          onCreated?.(mission.id);
        },
        onError: (err) => {
          setError(formatApiError(err));
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            New mission
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a mission</DialogTitle>
          <DialogDescription>Build a step-by-step plan. Steps that change data will wait for your approval in the selected conversation.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mission-objective">Objective</Label>
            <Textarea id="mission-objective" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should this mission accomplish?" />
          </div>

          <div className="space-y-2">
            <Label>Conversation (for approvals)</Label>
            <Select value={selectedConversationId} onValueChange={setSelectedConversationId}>
              <SelectTrigger>
                <SelectValue placeholder="No conversation (steps needing approval will be blocked)" />
              </SelectTrigger>
              <SelectContent>
                {conversations.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title || "Untitled conversation"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Steps</Label>
              <Button type="button" size="sm" variant="outline" onClick={addStep} disabled={tools.length === 0}>
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                Add step
              </Button>
            </div>

            {steps.length === 0 && <p className="text-sm text-muted-foreground">No steps yet.</p>}

            {steps.map((step, idx) => {
              const tool = tools.find((t) => t.name === step.toolName);
              const descriptors = getFieldDescriptors(tool);
              return (
                <div key={idx} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Step {idx + 1}</p>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeStep(idx)}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Tool</Label>
                      <Select
                        value={step.toolName}
                        onValueChange={(v) => {
                          updateStep(idx, { toolName: v, arguments: {} });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pick a tool" />
                        </SelectTrigger>
                        <SelectContent>
                          {grouped.map((group) => (
                            <SelectGroup key={group.kind}>
                              <SelectLabel>{group.kind}</SelectLabel>
                              {group.items.map((t) => (
                                <SelectItem key={t.name} value={t.name}>
                                  {t.activityLabel}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      {tool && <p className="text-xs text-muted-foreground">{tool.description}</p>}
                    </div>
                    <div className="space-y-1">
                      <Label>Description</Label>
                      <Input value={step.description} onChange={(e) => updateStep(idx, { description: e.target.value })} placeholder="What this step does" />
                    </div>
                  </div>

                  {descriptors.length > 0 && (
                    <div className="space-y-2">
                      <Label>Arguments</Label>
                      {descriptors.map((field) => {
                        const nullable = isNullable(field.schema);
                        const value = step.arguments[field.name];
                        const isNull = value === null;
                        return (
                          <div key={field.name} className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">
                                {field.name}
                                {field.required ? " *" : ""}
                              </Label>
                              {nullable && (
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs">Set to null</Label>
                                  <Switch
                                    checked={isNull}
                                    onCheckedChange={(checked) => {
                                      if (checked) setArg(idx, field.name, null);
                                      else setArg(idx, field.name, defaultForField(field));
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                            {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
                            {isNull ? (
                              <Input value="" disabled placeholder="null" />
                            ) : field.kind === "boolean" ? (
                              <div className="flex items-center gap-2">
                                <Switch checked={Boolean(value)} onCheckedChange={(v) => setArg(idx, field.name, v)} />
                                <span className="text-sm">{Boolean(value) ? "true" : "false"}</span>
                              </div>
                            ) : field.kind === "enum" ? (
                              <Select value={String(value ?? "")} onValueChange={(v) => setArg(idx, field.name, v)}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {(field.enumValues ?? []).map((ev, i) => (
                                    <SelectItem key={i} value={String(ev)}>
                                      {enumLabel(ev)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : field.kind === "stringArray" ? (
                              <Input value={typeof value === "string" ? value : Array.isArray(value) ? (value as string[]).join(", ") : ""} onChange={(e) => setArg(idx, field.name, e.target.value)} placeholder="Comma separated" />
                            ) : field.kind === "jsonArray" || field.kind === "json" ? (
                              <Textarea value={typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2)} onChange={(e) => setArg(idx, field.name, e.target.value)} placeholder="JSON" />
                            ) : field.kind === "number" || field.kind === "integer" ? (
                              <Input type="number" value={value === undefined || value === null ? "" : String(value)} onChange={(e) => setArg(idx, field.name, e.target.value)} />
                            ) : (
                              <Input value={typeof value === "string" ? value : ""} onChange={(e) => setArg(idx, field.name, e.target.value)} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {idx > 0 && (
                    <div className="space-y-1">
                      <Label>Depends on (earlier steps)</Label>
                      <Select
                        value={step.dependsOn[0] ?? ""}
                        onValueChange={(v) => updateStep(idx, { dependsOn: v ? [v] : [] })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {Array.from({ length: idx }).map((_, d) => (
                            <SelectItem key={d} value={String(d)}>
                              Step {d + 1}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={createMission.isPending || tools.length === 0}>
            {createMission.isPending ? "Creating..." : "Create mission"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
