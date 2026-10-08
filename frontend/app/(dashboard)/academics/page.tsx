"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarRange, ChevronDown, GraduationCap, Pencil, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Surface } from "@/components/ui/surface";
import {
  AcademicYearFormDialog,
  SemesterFormDialog,
} from "@/features/academics/academic-forms";
import {
  useAcademicYears,
  useCourses,
  useDeleteAcademicYear,
  useDeleteSemester,
  useSemesters,
} from "@/features/courses/hooks";
import type { AcademicYear, Semester, YearStatus } from "@/types/api-types";
import { formatDate } from "@/lib/format";

const STATUS_VARIANT: Record<YearStatus, "default" | "success" | "muted"> = {
  UPCOMING: "default",
  ACTIVE: "success",
  COMPLETED: "muted",
};

type PendingDelete =
  | { kind: "year"; item: AcademicYear; childCount: number }
  | { kind: "semester"; item: Semester }
  | null;

export default function AcademicsPage() {
  const years = useAcademicYears();
  const semesters = useSemesters();
  const deleteYear = useDeleteAcademicYear();
  const deleteSemester = useDeleteSemester();
  const allCourses = useCourses({ limit: 50 });

  const [yearDialog, setYearDialog] = useState(false);
  const [semesterDialog, setSemesterDialog] = useState(false);
  const [editingYear, setEditingYear] = useState<AcademicYear | undefined>(undefined);
  const [editingSemester, setEditingSemester] = useState<Semester | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [expandedSemesters, setExpandedSemesters] = useState<Set<string>>(new Set());

  const toggleSemester = (semesterId: string) => {
    setExpandedSemesters((prev) => {
      const next = new Set(prev);
      if (next.has(semesterId)) {
        next.delete(semesterId);
      } else {
        next.add(semesterId);
      }
      return next;
    });
  };

  const openYearForm = (year?: AcademicYear) => {
    setEditingYear(year);
    setYearDialog(true);
  };
  const openSemesterForm = (semester?: Semester) => {
    setEditingSemester(semester);
    setSemesterDialog(true);
  };

  const orderedYears = [...(years.data ?? [])].sort((a, b) =>
    b.startDate.localeCompare(a.startDate),
  );
  const semestersFor = (yearId: string) =>
    (semesters.data ?? [])
      .filter((s) => s.academicYearId === yearId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const isPending = years.isPending || semesters.isPending;
  const deletePending = deleteYear.isPending || deleteSemester.isPending;

  return (
    <div>
      <PageHeader
        kicker="Structure"
        title="Academics"
        description="Your academic years and semesters — the backbone for courses, tasks, and the dashboard."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={orderedYears.length === 0}
              onClick={() => openSemesterForm()}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New semester
            </Button>
            <Button size="sm" onClick={() => openYearForm()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New academic year
            </Button>
          </>
        }
      />

      {isPending ? (
        <ListSkeleton rows={3} />
      ) : years.isError || semesters.isError ? (
        <ErrorState
          error={years.error ?? semesters.error}
          retry={() => {
            void years.refetch();
            void semesters.refetch();
          }}
        />
      ) : orderedYears.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No academic years yet"
          description="Create an academic year such as 2025/2026, then add your semesters inside it."
          action={
            <Button size="sm" onClick={() => openYearForm()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New academic year
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {orderedYears.map((year) => {
            const children = semestersFor(year.id);
            return (
              <Surface key={year.id} className="p-4">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CalendarRange className="h-4 w-4 text-primary" aria-hidden />
                    <h2 className="font-semibold">{year.name}</h2>
                    <Badge variant={STATUS_VARIANT[year.status]}>
                      {year.status.toLowerCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(year.startDate, "MMM d, yyyy")} –{" "}
                      {formatDate(year.endDate, "MMM d, yyyy")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openYearForm(year)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${year.name}`}
                      className="text-danger hover:text-danger"
                      onClick={() =>
                        setPendingDelete({ kind: "year", item: year, childCount: children.length })
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </header>

                {children.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No semesters in this year yet.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {children.map((semester) => {
                      const coursesForSemester = (allCourses.data ?? []).filter(
                        (c) => c.semesterId === semester.id,
                      );
                      const isExpanded = expandedSemesters.has(semester.id);
                      return (
                        <li
                          key={semester.id}
                          className="rounded-lg border border-border/70 bg-background/40 transition-colors hover:border-primary/30 hover:bg-background"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                            <button
                              type="button"
                              className="flex flex-1 items-center gap-2 text-left"
                              onClick={() => toggleSemester(semester.id)}
                              aria-expanded={isExpanded}
                            >
                              <ChevronDown
                                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                                aria-hidden
                              />
                              <div>
                                <p className="flex items-center gap-2 text-sm font-medium">
                                  {semester.name}
                                  <Badge variant={STATUS_VARIANT[semester.status]}>
                                    {semester.status.toLowerCase()}
                                  </Badge>
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(semester.startDate, "MMM d")} –{" "}
                                  {formatDate(semester.endDate, "MMM d, yyyy")}
                                </p>
                              </div>
                            </button>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openSemesterForm(semester)}
                              >
                                <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Delete ${semester.name}`}
                                className="text-danger hover:text-danger"
                                onClick={() => setPendingDelete({ kind: "semester", item: semester })}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="border-t border-border/50 px-3 py-2">
                              {coursesForSemester.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No courses in this semester yet.
                                </p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {coursesForSemester.map((course) => (
                                    <li key={course.id}>
                                      <Link
                                        href={`/courses/${course.id}`}
                                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-primary/5 hover:text-primary"
                                      >
                                        <span className="truncate font-medium">{course.name}</span>
                                        {course.code && (
                                          <span className="shrink-0 text-xs text-muted-foreground">
                                            {course.code}
                                          </span>
                                        )}
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Surface>
            );
          })}
        </div>
      )}

      <AcademicYearFormDialog
        open={yearDialog}
        onOpenChange={setYearDialog}
        year={editingYear}
      />
      <SemesterFormDialog
        open={semesterDialog}
        onOpenChange={setSemesterDialog}
        semester={editingSemester}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={pendingDelete?.kind === "year" ? "Delete academic year" : "Delete semester"}
        description={
          pendingDelete?.kind === "year"
            ? `"${pendingDelete.item.name}" and its ${pendingDelete.childCount} semester(s) will be removed. Courses keep their data but lose the term link. This cannot be undone.`
            : pendingDelete
              ? `"${pendingDelete.item.name}" will be removed. Courses keep their data but lose the term link. This cannot be undone.`
              : undefined
        }
        busy={deletePending}
        onConfirm={() => {
          if (!pendingDelete) return;
          const request =
            pendingDelete.kind === "year"
              ? deleteYear.mutateAsync(pendingDelete.item.id)
              : deleteSemester.mutateAsync(pendingDelete.item.id);
          void request.then(() => setPendingDelete(null));
        }}
      />
    </div>
  );
}
