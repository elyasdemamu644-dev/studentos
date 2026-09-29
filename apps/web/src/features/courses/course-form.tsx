"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Course, CourseStatus } from "@/types/api-types";
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
import { useCreateCourse, useSemesters, useUpdateCourse } from "@/features/courses/hooks";
import { DialogShell } from "@/features/tasks/task-form";

const courseFormSchema = z.object({
  name: z.string().trim().min(1, "A course name is required"),
  code: z.string().trim().optional(),
  credits: z.string().optional(),
  instructor: z.string().trim().optional(),
  semesterId: z.string().optional(),
  status: z.enum(["ACTIVE", "COMPLETED", "DROPPED"]).default("ACTIVE"),
  description: z.string().trim().max(2000, "Keep it under 2000 characters").optional(),
});

type CourseFormValues = z.infer<typeof courseFormSchema>;

const EMPTY_VALUES: CourseFormValues = {
  name: "",
  code: "",
  credits: "",
  instructor: "",
  semesterId: "",
  status: "ACTIVE",
  description: "",
};

export function CourseFormDialog({
  open,
  onOpenChange,
  course,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course?: Course;
}) {
  const createCourse = useCreateCourse();
  const updateCourse = useUpdateCourse();
  const semesters = useSemesters();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CourseFormValues>({
    resolver: zodResolver(courseFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    if (course) {
      reset({
        name: course.name,
        code: course.code ?? "",
        credits: course.credits != null ? String(course.credits) : "",
        instructor: course.instructor ?? "",
        semesterId: course.semesterId ?? "",
        status: course.status,
        description: course.description ?? "",
      });
    } else {
      reset({ ...EMPTY_VALUES, status: "ACTIVE" });
    }
  }, [open, course, reset]);

  const onSubmit = async (values: CourseFormValues) => {
    const payload = {
      name: values.name,
      code: values.code || null,
      credits: values.credits ? Number(values.credits) : null,
      instructor: values.instructor || null,
      semesterId: values.semesterId || null,
      description: values.description || null,
    };
    if (course) {
      await updateCourse.mutateAsync({ id: course.id, input: { ...payload, status: values.status as CourseStatus } });
    } else {
      await createCourse.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={course ? "Edit course" : "New course"}
      description={course ? "Update the details for this course." : "Add a course to track its assignments, notes and grades."}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="course-name">Name</Label>
          <Input id="course-name" autoFocus aria-invalid={!!errors.name} placeholder="e.g. Data Structures" {...register("name")} />
          {errors.name && <p className="text-sm text-danger">{errors.name.message}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="course-code">Course code</Label>
            <Input id="course-code" placeholder="e.g. CS201" {...register("code")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="course-credits">Credits</Label>
            <Input id="course-credits" type="number" min={0} placeholder="e.g. 3" {...register("credits")} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="course-instructor">Instructor</Label>
          <Input id="course-instructor" placeholder="e.g. Prof. Rivera" {...register("instructor")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="course-semester">Semester</Label>
          <Select value={watch("semesterId") || "none"} onValueChange={(v) => setValue("semesterId", v === "none" ? "" : v, { shouldValidate: true })}>
            <SelectTrigger id="course-semester">
              <SelectValue placeholder="No semester" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No semester</SelectItem>
              {(semesters.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {course && (
          <div className="space-y-2">
            <Label htmlFor="course-status">Status</Label>
            <Select value={watch("status")} onValueChange={(v) => setValue("status", v as CourseStatus, { shouldValidate: true })}>
              <SelectTrigger id="course-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="DROPPED">Dropped</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="course-description">Description</Label>
          <Textarea id="course-description" rows={3} {...register("description")} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton type="submit" loading={isSubmitting}>
            {course ? "Save changes" : "Create course"}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}