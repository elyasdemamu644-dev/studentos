"use client";

import { useEffect } from "react";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CalEvent, EventType } from "@/features/api-types";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
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
import { useCreateEvent, useUpdateEvent } from "@/features/events/hooks";
import { useCourses } from "@/features/courses/hooks";
import { DialogShell } from "@/features/tasks/task-form";

const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, "A title is required"),
    type: z.enum(["CLASS", "EXAM", "ASSIGNMENT", "PROJECT", "STUDY", "MEETING", "PERSONAL", "OTHER"]).default("CLASS"),
    startDate: z.string().min(1, "Pick a date"),
    startTime: z.string().optional(),
    endDate: z.string().optional(),
    endTime: z.string().optional(),
    location: z.string().trim().optional(),
    courseId: z.string().optional(),
    description: z.string().trim().max(2000, "Keep it under 2000 characters").optional(),
  })
  .superRefine((values, ctx) => {
    if ((values.endDate && !values.endTime) || (!values.endDate && values.endTime)) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: "Both end date and time are required together" });
    }
    if (values.endDate && values.endTime) {
      const start = new Date(`${values.startDate}T${values.startTime || "09:00"}:00`);
      const end = new Date(`${values.endDate}T${values.endTime}:00`);
      if (end <= start) {
        ctx.addIssue({ code: "custom", path: ["endTime"], message: "End must be after start" });
      }
    }
  });

type EventFormValues = z.infer<typeof eventFormSchema>;

const EMPTY_VALUES: EventFormValues = {
  title: "",
  type: "CLASS",
  startDate: "",
  startTime: "09:00",
  endDate: "",
  endTime: "",
  location: "",
  courseId: "",
  description: "",
};

export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "yyyy-MM-dd");
}

function isoToTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function EventFormDialog({
  open,
  onOpenChange,
  event,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: CalEvent;
  defaultDate?: string;
}) {
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const courses = useCourses();
  const mutationError = event ? updateEvent.error : createEvent.error;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    if (event) {
      reset({
        title: event.title,
        type: event.type,
        startDate: isoToDateInput(event.startAt),
        startTime: isoToTimeInput(event.startAt),
        endDate: isoToDateInput(event.endAt),
        endTime: isoToTimeInput(event.endAt),
        location: event.location ?? "",
        courseId: event.courseId ?? "",
        description: event.description ?? "",
      });
    } else {
      reset({ ...EMPTY_VALUES, startDate: defaultDate ?? format(new Date(), "yyyy-MM-dd") });
    }
  }, [open, event, defaultDate, reset]);

  const onSubmit = async (values: EventFormValues) => {
    const payload = {
      title: values.title,
      type: values.type as EventType,
      startAt: new Date(`${values.startDate}T${values.startTime || "09:00"}:00`).toISOString(),
      endAt:
        values.endDate && values.endTime
          ? new Date(`${values.endDate}T${values.endTime}:00`).toISOString()
          : null,
      location: values.location || null,
      courseId: values.courseId || null,
      description: values.description || null,
    };
    if (event) {
      await updateEvent.mutateAsync({ id: event.id, input: payload });
    } else {
      await createEvent.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={event ? "Edit event" : "New event"}
      description="Classes, exams, appointments — anything on your schedule."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="event-title">Title</Label>
          <Input id="event-title" autoFocus aria-invalid={!!errors.title} placeholder="e.g. Organic Chemistry lecture" {...register("title")} />
          {errors.title && <p className="text-sm text-danger">{errors.title.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-type">Type</Label>
          <Select value={watch("type")} onValueChange={(v) => setValue("type", v as EventType, { shouldValidate: true })}>
            <SelectTrigger id="event-type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(EVENT_TYPE_LABELS).map((t) => (
                <SelectItem key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="event-start-date">Start date</Label>
            <Input id="event-start-date" type="date" aria-invalid={!!errors.startDate} {...register("startDate")} />
            {errors.startDate && <p className="text-sm text-danger">{errors.startDate.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-start-time">Start time</Label>
            <Input id="event-start-time" type="time" {...register("startTime")} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="event-end-date">End date <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="event-end-date" type="date" {...register("endDate")} />
            {errors.endDate && <p className="text-sm text-danger">{errors.endDate.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-end-time">End time</Label>
            <Input id="event-end-time" type="time" aria-invalid={!!errors.endTime} {...register("endTime")} />
            {errors.endTime && <p className="text-sm text-danger">{errors.endTime.message}</p>}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="event-location">Location</Label>
            <Input id="event-location" placeholder="e.g. Hall 3B" {...register("location")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-course">Course</Label>
            <Select
              value={watch("courseId") || "none"}
              onValueChange={(v) => setValue("courseId", v === "none" ? "" : v, { shouldValidate: true })}
            >
              <SelectTrigger id="event-course">
                <SelectValue placeholder="No course" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No course</SelectItem>
                {(courses.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-description">Description</Label>
          <Textarea id="event-description" rows={2} {...register("description")} />
        </div>
        {mutationError && (
          <p role="alert" className="text-sm text-danger">
            {mutationError instanceof Error ? mutationError.message : "Could not save the event"}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton type="submit" loading={isSubmitting}>
            {event ? "Save changes" : "Add event"}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}