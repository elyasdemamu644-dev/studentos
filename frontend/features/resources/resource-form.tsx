"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ResourceRecord, ResourceType } from "@/types/api-types";
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
import { useCourses } from "@/features/courses/hooks";
import { useCreateResource, useUpdateResource } from "./hooks";
import { DialogShell } from "@/features/tasks/task-form";

// The API validates the URL with `z.string().url()`; mirror it so the user
// gets feedback before a round-trip. http(s) only — a resource link must be
// openable in a browser.
const resourceFormSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(200, "Keep the title under 200 characters"),
  url: z
    .string()
    .trim()
    .min(1, "A link is required")
    .refine((v) => /^https?:\/\/.+\..+/.test(v), "Enter a full link starting with http:// or https://"),
  resourceType: z
    .enum(["PDF", "VIDEO", "AUDIO", "SLIDES", "LINK", "DOCUMENT", "OTHER"])
    .default("LINK"),
  courseId: z.string().optional(),
  description: z.string().trim().max(2000, "Keep it under 2000 characters").optional(),
});

type ResourceFormValues = z.infer<typeof resourceFormSchema>;

const EMPTY_VALUES: ResourceFormValues = {
  title: "",
  url: "",
  resourceType: "LINK",
  courseId: "",
  description: "",
};

export function ResourceFormDialog({
  open,
  onOpenChange,
  resource,
  defaultCourseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource?: ResourceRecord;
  defaultCourseId?: string;
}) {
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const courses = useCourses();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResourceFormValues>({
    resolver: zodResolver(resourceFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    if (resource) {
      reset({
        title: resource.title,
        url: resource.url ?? "",
        resourceType: resource.resourceType,
        courseId: resource.courseId ?? "",
        description: resource.description ?? "",
      });
    } else {
      reset({ ...EMPTY_VALUES, courseId: defaultCourseId ?? "" });
    }
  }, [open, resource, defaultCourseId, reset]);

  const onSubmit = async (values: ResourceFormValues) => {
    const payload = {
      title: values.title,
      url: values.url,
      resourceType: values.resourceType as ResourceType,
      courseId: values.courseId || null,
      description: values.description || null,
    };
    if (resource) {
      await updateResource.mutateAsync({ id: resource.id, input: payload });
    } else {
      await createResource.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={resource ? "Edit resource" : "Add resource"}
      description={
        resource
          ? "Update the link, type or course for this resource."
          : "Save a link to lecture slides, readings, videos or past papers."
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="resource-title">Title</Label>
          <Input
            id="resource-title"
            autoFocus
            aria-invalid={!!errors.title}
            placeholder="e.g. Week 3 lecture slides"
            {...register("title")}
          />
          {errors.title && <p className="text-sm text-danger">{errors.title.message}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="resource-url">Link</Label>
          <Input
            id="resource-url"
            type="url"
            inputMode="url"
            aria-invalid={!!errors.url}
            placeholder="https://example.com/slides"
            {...register("url")}
          />
          {errors.url && <p className="text-sm text-danger">{errors.url.message}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="resource-type">Type</Label>
            <Select
              value={watch("resourceType")}
              onValueChange={(v) =>
                setValue("resourceType", v as ResourceFormValues["resourceType"], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id="resource-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LINK">Link</SelectItem>
                <SelectItem value="PDF">PDF</SelectItem>
                <SelectItem value="SLIDES">Slides</SelectItem>
                <SelectItem value="VIDEO">Video</SelectItem>
                <SelectItem value="AUDIO">Audio</SelectItem>
                <SelectItem value="DOCUMENT">Document</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resource-course">Course</Label>
            <Select
              value={watch("courseId") || "none"}
              onValueChange={(v) => setValue("courseId", v === "none" ? "" : v)}
            >
              <SelectTrigger id="resource-course">
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
          <Label htmlFor="resource-description">Description</Label>
          <Textarea
            id="resource-description"
            rows={3}
            placeholder="Optional notes about this resource"
            {...register("description")}
          />
          {errors.description && <p className="text-sm text-danger">{errors.description.message}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton type="submit" loading={isSubmitting}>
            {resource ? "Save changes" : "Add resource"}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}
