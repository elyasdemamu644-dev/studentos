"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Course, Task, TaskPriority, TaskType } from "@/features/api-types";
import { PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/labels";
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
import { useCreateTask, useUpdateTask } from "@/features/tasks/hooks";
import { useCourses } from "@/features/courses/hooks";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const taskFormSchema = z.object({
  title: z.string().trim().min(1, "A title is required"),
  description: z.string().trim().max(2000, "Keep it under 2000 characters").optional(),
  courseId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  type: z.enum(["ASSIGNMENT", "HOMEWORK", "PROJECT", "READING", "PRACTICE", "REVISION", "OTHER"]).default("ASSIGNMENT"),
  dueDate: z.string().optional(),
  estimatedMinutes: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

const EMPTY_VALUES: TaskFormValues = {
  title: "",
  description: "",
  courseId: "",
  priority: "MEDIUM",
  type: "ASSIGNMENT",
  dueDate: "",
  estimatedMinutes: "",
};

export function toDateValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function TaskFormDialog({
  open,
  onOpenChange,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task;
}) {
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const courses = useCourses();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    if (task) {
      reset({
        title: task.title,
        description: task.description ?? "",
        courseId: task.courseId ?? "",
        priority: task.priority,
        type: task.type,
        dueDate: toDateValue(task.dueDate),
        estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : "",
      });
    } else {
      reset(EMPTY_VALUES);
    }
  }, [open, task, reset]);

  const onSubmit = async (values: TaskFormValues) => {
    const payload = {
      title: values.title,
      description: values.description || null,
      courseId: values.courseId || null,
      priority: values.priority as TaskPriority,
      type: values.type as TaskType,
      dueDate: values.dueDate ? new Date(`${values.dueDate}T23:59:59`).toISOString() : null,
      estimatedMinutes: values.estimatedMinutes ? Number(values.estimatedMinutes) : null,
    };
    if (task) {
      await updateTask.mutateAsync({ id: task.id, input: payload });
    } else {
      await createTask.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={task ? "Edit task" : "New task"}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="task-title">Title</Label>
          <Input id="task-title" autoFocus aria-invalid={!!errors.title} {...register("title")} />
          {errors.title && <p className="text-sm text-danger">{errors.title.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-description">Description</Label>
          <Textarea id="task-description" rows={3} {...register("description")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="task-priority">Priority</Label>
            <Select value={watch("priority")} onValueChange={(v) => setValue("priority", v as TaskPriority, { shouldValidate: true })}>
              <SelectTrigger id="task-priority">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-type">Type</Label>
            <Select value={watch("type")} onValueChange={(v) => setValue("type", v as TaskType, { shouldValidate: true })}>
              <SelectTrigger id="task-type">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TASK_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="task-course">Course</Label>
            <Select value={watch("courseId")} onValueChange={(v) => setValue("courseId", v, { shouldValidate: true })}>
              <SelectTrigger id="task-course">
                <SelectValue placeholder="No course" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No course</SelectItem>
                {(courses.data ?? []).map((c: Course) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-due">Due date</Label>
            <Input id="task-due" type="date" {...register("dueDate")} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="task-est">Estimated time (minutes)</Label>
          <Input id="task-est" type="number" min={0} placeholder="e.g. 45" {...register("estimatedMinutes")} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton type="submit" loading={isSubmitting}>
            {task ? "Save changes" : "Create task"}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}

export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}