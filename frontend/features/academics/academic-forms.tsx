"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

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
import { DialogShell } from "@/features/tasks/task-form";
import {
  useAcademicYears,
  useCreateAcademicYear,
  useCreateSemester,
  useUpdateAcademicYear,
  useUpdateSemester,
} from "@/features/courses/hooks";
import type { AcademicYear, Semester, YearStatus } from "@/types/api-types";

export const ACADEMIC_STATUS_OPTIONS: Array<{ value: YearStatus; label: string }> = [
  { value: "UPCOMING", label: "Upcoming" },
  { value: "ACTIVE", label: "Active" },
  { value: "COMPLETED", label: "Completed" },
];

export const yearFormSchema = z
  .object({
    name: z.string().trim().min(1, "A name is required"),
    startDate: z.string().min(1, "Pick a start date"),
    endDate: z.string().min(1, "Pick an end date"),
    status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]).default("ACTIVE"),
  })
  .refine((v) => v.startDate <= v.endDate, {
    path: ["endDate"],
    message: "End date must be on or after the start date",
  });

export const semesterFormSchema = z
  .object({
    academicYearId: z.string().min(1, "Choose an academic year"),
    name: z.string().trim().min(1, "A name is required"),
    startDate: z.string().min(1, "Pick a start date"),
    endDate: z.string().min(1, "Pick an end date"),
    status: z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]).default("ACTIVE"),
  })
  .refine((v) => v.startDate <= v.endDate, {
    path: ["endDate"],
    message: "End date must be on or after the start date",
  });

type YearFormValues = z.infer<typeof yearFormSchema>;
type SemesterFormValues = z.infer<typeof semesterFormSchema>;

const EMPTY_YEAR: YearFormValues = {
  name: "",
  startDate: "",
  endDate: "",
  status: "ACTIVE",
};

const EMPTY_SEMESTER: SemesterFormValues = {
  academicYearId: "",
  name: "",
  startDate: "",
  endDate: "",
  status: "ACTIVE",
};

function mutationMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function StatusSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: YearStatus;
  onChange: (value: YearStatus) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Status</Label>
      <Select value={value} onValueChange={(v) => onChange(v as YearStatus)}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {ACADEMIC_STATUS_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function AcademicYearFormDialog({
  open,
  onOpenChange,
  year,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year?: AcademicYear;
}) {
  const createYear = useCreateAcademicYear();
  const updateYear = useUpdateAcademicYear();
  const mutationError = year ? updateYear.error : createYear.error;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<YearFormValues>({
    resolver: zodResolver(yearFormSchema),
    defaultValues: EMPTY_YEAR,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      year
        ? {
            name: year.name,
            startDate: year.startDate,
            endDate: year.endDate,
            status: year.status,
          }
        : EMPTY_YEAR,
    );
  }, [open, year, reset]);

  const onSubmit = async (values: YearFormValues) => {
    if (year) {
      await updateYear.mutateAsync({ id: year.id, input: values });
    } else {
      await createYear.mutateAsync(values);
    }
    onOpenChange(false);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={year ? "Edit academic year" : "New academic year"}
      description="Group your semesters into one year, e.g. 2025/2026."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="year-name">Name</Label>
          <Input
            id="year-name"
            autoFocus
            placeholder="e.g. 2025/2026"
            aria-invalid={!!errors.name}
            {...register("name")}
          />
          {errors.name && <p className="text-sm text-danger">{errors.name.message}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="year-start">Start date</Label>
            <Input
              id="year-start"
              type="date"
              aria-invalid={!!errors.startDate}
              {...register("startDate")}
            />
            {errors.startDate && (
              <p className="text-sm text-danger">{errors.startDate.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="year-end">End date</Label>
            <Input
              id="year-end"
              type="date"
              aria-invalid={!!errors.endDate}
              {...register("endDate")}
            />
            {errors.endDate && <p className="text-sm text-danger">{errors.endDate.message}</p>}
          </div>
        </div>

        <StatusSelect
          id="year-status"
          value={watch("status")}
          onChange={(v) => setValue("status", v, { shouldValidate: true })}
        />

        {mutationError && (
          <p role="alert" className="text-sm text-danger">
            {mutationMessage(mutationError, "Could not save the academic year")}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton type="submit" loading={isSubmitting}>
            {year ? "Save changes" : "Create year"}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}

export function SemesterFormDialog({
  open,
  onOpenChange,
  semester,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  semester?: Semester;
}) {
  const createSemester = useCreateSemester();
  const updateSemester = useUpdateSemester();
  const years = useAcademicYears();
  const mutationError = semester ? updateSemester.error : createSemester.error;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SemesterFormValues>({
    resolver: zodResolver(semesterFormSchema),
    defaultValues: EMPTY_SEMESTER,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      semester
        ? {
            academicYearId: semester.academicYearId,
            name: semester.name,
            startDate: semester.startDate,
            endDate: semester.endDate,
            status: semester.status,
          }
        : EMPTY_SEMESTER,
    );
  }, [open, semester, reset]);

  const onSubmit = async (values: SemesterFormValues) => {
    if (semester) {
      await updateSemester.mutateAsync({
        id: semester.id,
        input: {
          name: values.name,
          startDate: values.startDate,
          endDate: values.endDate,
          status: values.status,
        },
      });
    } else {
      await createSemester.mutateAsync(values);
    }
    onOpenChange(false);
  };

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={semester ? "Edit semester" : "New semester"}
      description="Semesters scope your courses, tasks, and the dashboard."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="semester-year">Academic year</Label>
          <Select
            value={watch("academicYearId") || undefined}
            onValueChange={(v) => setValue("academicYearId", v, { shouldValidate: true })}
            disabled={Boolean(semester)}
          >
            <SelectTrigger id="semester-year" disabled={Boolean(semester)}>
              <SelectValue placeholder="Choose a year" />
            </SelectTrigger>
            <SelectContent>
              {(years.data ?? []).map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.academicYearId && (
            <p className="text-sm text-danger">{errors.academicYearId.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="semester-name">Name</Label>
          <Input
            id="semester-name"
            autoFocus
            placeholder="e.g. Fall Semester"
            aria-invalid={!!errors.name}
            {...register("name")}
          />
          {errors.name && <p className="text-sm text-danger">{errors.name.message}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="semester-start">Start date</Label>
            <Input
              id="semester-start"
              type="date"
              aria-invalid={!!errors.startDate}
              {...register("startDate")}
            />
            {errors.startDate && (
              <p className="text-sm text-danger">{errors.startDate.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="semester-end">End date</Label>
            <Input
              id="semester-end"
              type="date"
              aria-invalid={!!errors.endDate}
              {...register("endDate")}
            />
            {errors.endDate && <p className="text-sm text-danger">{errors.endDate.message}</p>}
          </div>
        </div>

        <StatusSelect
          id="semester-status"
          value={watch("status")}
          onChange={(v) => setValue("status", v, { shouldValidate: true })}
        />

        {mutationError && (
          <p role="alert" className="text-sm text-danger">
            {mutationMessage(mutationError, "Could not save the semester")}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton type="submit" loading={isSubmitting}>
            {semester ? "Save changes" : "Create semester"}
          </LoadingButton>
        </div>
      </form>
    </DialogShell>
  );
}
