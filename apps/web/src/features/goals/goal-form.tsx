"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Goal, GoalStatus } from "@/features/api-types";
import { Button, LoadingButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateGoal, useUpdateGoal } from "@/features/goals/hooks";
import { DialogShell } from "@/features/tasks/task-form";

const goalFormSchema = z.object({
  title: z.string().trim().min(1, "A goal title is required"),
  description: z.string().trim().max(2000, "Keep it under 2000 characters").optional(),
  deadline: z.string().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).default("ACTIVE"),
  progress: z.string().optional(),
});

type GoalFormValues = z.infer<typeof goalFormSchema>;

const EMPTY_VALUES: GoalFormValues = {
  title: "",
  description: "",
  deadline: "",
  status: "ACTIVE",
  progress: "0",
};

function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function GoalFormDialog({
  open,
  onOpenChange,
  goal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: Goal;
}) {
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    if (goal) {
      reset({
        title: goal.title,
        description: goal.description ?? "",
        deadline: isoToDateInput(goal.deadline),
        status: goal.status,
        progress: String(goal.progress ?? 0),
      });
    } else {
      reset(EMPTY_VALUES);
    }
  }, [open, goal, reset]);

  const onSubmit = async (values: GoalFormValues) => {
    const base = {
      title: values.title,
      description: values.description || null,
      deadline: values.deadline ? new Date(`${values.deadline}T23:59:59`).toISOString() : null,
    };
    if (goal) {
      const progress = Number(values.progress);
      await updateGoal.mutateAsync({
        id: goal.id,
        input: {
          ...base,
          status: values.status as GoalStatus,
          progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : goal.progress,
        },
      });
    } else {
      await createGoal.mutateAsync({ ...base, status: values.status as GoalStatus });
    }
    onOpenChange(false);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? "Edit goal" : "New goal"}
      description="Break big ambitions into tracked, finishable steps."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="goal-title">Title</Label>
          <Input id="goal-title" autoFocus aria-invalid={!!errors.title} placeholder="e.g. Finish my thesis draft" {...register("title")} />
          {errors.title && <p className="text-sm text-danger">{errors.title.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-description">Description</Label>
          <Textarea id="goal-description" rows={3} {...register("description")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="goal-deadline">Deadline</Label>
            <Input id="goal-deadline" type="date" {...register("deadline")} />
          </div>
          {goal && (
            <div className="space-y-2">
              <Label htmlFor="goal-progress">Progress (%)</Label>
              <Input id="goal-progress" type="number" min={0} max={100} {...register("progress")} />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="goal-status">Status</Label>
          <Select value={watch("status")} onValueChange={(v) => setValue("status", v as GoalStatus, { shouldValidate: true })}>
            <SelectTrigger id="goal-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton type="submit" loading={isSubmitting}>
            {goal ? "Save changes" : "Create goal"}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}