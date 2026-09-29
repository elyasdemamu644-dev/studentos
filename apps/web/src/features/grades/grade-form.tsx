"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { GradeRecord, GradeType } from "@/types/api-types";
import { Button, LoadingButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateGrade, useUpdateGrade } from "@/features/grades/hooks";
import { useCourses } from "@/features/courses/hooks";
import { DialogShell } from "@/features/tasks/task-form";

const GRADE_TYPES: GradeType[] = [
  "ASSIGNMENT",
  "EXAM",
  "QUIZ",
  "PROJECT",
  "PARTICIPATION",
  "FINAL",
  "OTHER",
  "ASSESSMENT",
];

const GRADE_TYPE_LABELS: Record<GradeType, string> = {
  ASSIGNMENT: "Assignment",
  EXAM: "Exam",
  QUIZ: "Quiz",
  PROJECT: "Project",
  PARTICIPATION: "Participation",
  FINAL: "Final",
  OTHER: "Other",
  ASSESSMENT: "Assessment",
};

const gradeFormSchema = z.object({
  title: z.string().trim().min(1, "A title is required"),
  type: z.enum(["ASSIGNMENT", "EXAM", "QUIZ", "PROJECT", "PARTICIPATION", "FINAL", "OTHER", "ASSESSMENT"]).default("ASSIGNMENT"),
  courseId: z.string().optional(),
  score: z.string().optional(),
  maxScore: z.string().optional(),
  weight: z.string().optional(),
  recordedAt: z.string().optional(),
});

type GradeFormValues = z.infer<typeof gradeFormSchema>;

const EMPTY_VALUES: GradeFormValues = {
  title: "",
  type: "ASSIGNMENT",
  courseId: "",
  score: "",
  maxScore: "",
  weight: "",
  recordedAt: new Date().toISOString().slice(0, 10),
};

function parseNumber(value: string | undefined): number | null {
  if (!value || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function GradeFormDialog({
  open,
  onOpenChange,
  grade,
  defaultCourseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grade?: GradeRecord;
  defaultCourseId?: string;
}) {
  const createGrade = useCreateGrade();
  const updateGrade = useUpdateGrade();
  const courses = useCourses();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GradeFormValues>({
    resolver: zodResolver(gradeFormSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!open) return;
    if (grade) {
      reset({
        title: grade.title,
        type: grade.type,
        courseId: grade.courseId ?? "",
        score: grade.score != null ? String(grade.score) : "",
        maxScore: grade.maxScore != null ? String(grade.maxScore) : "",
        weight: grade.weight != null ? String(grade.weight) : "",
        recordedAt: grade.recordedAt ? grade.recordedAt.slice(0, 10) : "",
      });
    } else {
      reset({ ...EMPTY_VALUES, courseId: defaultCourseId ?? "" });
    }
  }, [open, grade, defaultCourseId, reset]);

  const onSubmit = async (values: GradeFormValues) => {
    const payload = {
      title: values.title,
      type: values.type as GradeType,
      courseId: values.courseId || null,
      score: parseNumber(values.score),
      maxScore: parseNumber(values.maxScore),
      weight: parseNumber(values.weight),
      recordedAt: values.recordedAt ? new Date(`${values.recordedAt}T12:00:00`).toISOString() : new Date().toISOString(),
    };
    if (grade) {
      await updateGrade.mutateAsync({ id: grade.id, input: payload });
    } else {
      await createGrade.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={grade ? "Edit grade" : "Record grade"}
      description="Log a score so you can track your performance over time."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="grade-title">Title</Label>
          <Input id="grade-title" autoFocus aria-invalid={!!errors.title} placeholder="e.g. Midterm exam" {...register("title")} />
          {errors.title && <p className="text-sm text-danger">{errors.title.message}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="grade-type">Type</Label>
            <Select value={watch("type")} onValueChange={(v) => setValue("type", v as GradeType, { shouldValidate: true })}>
              <SelectTrigger id="grade-type">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {GRADE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {GRADE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="grade-course">Course</Label>
            <Select value={watch("courseId")} onValueChange={(v) => setValue("courseId", v, { shouldValidate: true })}>
              <SelectTrigger id="grade-course">
                <SelectValue placeholder="No course" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No course</SelectItem>
                {(courses.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="grade-score">Score</Label>
            <Input id="grade-score" type="number" step="any" min={0} placeholder="e.g. 18" {...register("score")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="grade-max">Max score</Label>
            <Input id="grade-max" type="number" step="any" min={0} placeholder="e.g. 20" {...register("maxScore")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="grade-weight">Weight %</Label>
            <Input id="grade-weight" type="number" step="any" min={0} placeholder="e.g. 30" {...register("weight")} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="grade-date">Date</Label>
          <Input id="grade-date" type="date" {...register("recordedAt")} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton type="submit" loading={isSubmitting}>
            {grade ? "Save changes" : "Record grade"}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}