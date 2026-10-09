"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Award, BookOpen, Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Chip } from "@/components/panel";
import { EmptyState, GridSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { CourseCard } from "@/components/domain/course-card";
import { Button } from "@/components/ui/button";
import { FilterBar, SearchField, SelectFilter } from "@/components/ui/filter-bar";
import { CourseFormDialog } from "@/features/courses/course-form";
import { useCourses, useSemesters } from "@/features/courses/hooks";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "COMPLETED", label: "Completed" },
  { value: "DROPPED", label: "Dropped" },
] as const;

export default function CoursesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [open, setOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (searchParams.get("new") === "1") setOpen(true);
  }, [searchParams]);

  const courses = useCourses({
    search: debouncedSearch || undefined,
    status: (status as "ACTIVE" | "COMPLETED" | "DROPPED") || undefined,
    semesterId: semesterId || undefined,
  });
  const semesters = useSemesters();

  const hasFilters = Boolean(debouncedSearch || status || semesterId);

  const stats = useMemo(() => {
    const all = courses.data ?? [];
    return {
      active: all.filter((c) => c.status === "ACTIVE").length,
      completed: all.filter((c) => c.status === "COMPLETED").length,
    };
  }, [courses.data]);

  return (
    <div>
      <PageHeader
        kicker="Academics"
        title="Courses"
        description="Your enrolled courses and study material, all in one place."
        chips={
          courses.data ? (
            <>
              <Chip tone="primary" icon={BookOpen}>
                {stats.active} active
              </Chip>
              <Chip tone="success" icon={Award}>
                {stats.completed} completed
              </Chip>
            </>
          ) : undefined
        }
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add course
          </Button>
        }
      />

      <FilterBar
        onClear={
          hasFilters
            ? () => {
                setSearch("");
                setDebouncedSearch("");
                setStatus("");
                setSemesterId("");
                router.replace("/courses");
              }
            : undefined
        }
      >
        <SearchField
          value={search}
          onChange={setSearch}
          label="Search courses"
          placeholder="Search courses…"
        />
        <SelectFilter
          value={status}
          onChange={setStatus}
          label="Filter by status"
          placeholder="All statuses"
          allLabel="All statuses"
          options={STATUS_OPTIONS}
        />
        <SelectFilter
          value={semesterId}
          onChange={setSemesterId}
          label="Filter by semester"
          placeholder="All semesters"
          allLabel="All semesters"
          options={(semesters.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          className="sm:w-44"
        />
      </FilterBar>

      {courses.isPending ? (
        <GridSkeleton cards={6} />
      ) : courses.isError ? (
        <ErrorState error={courses.error} retry={() => courses.refetch()} />
      ) : courses.data && courses.data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.data.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title={hasFilters ? "No matching courses" : "No courses yet"}
          description={
            hasFilters
              ? "Try adjusting your search or filters."
              : "Add your first course to start tracking assignments, notes and grades."
          }
          action={
            !hasFilters && (
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add a course
              </Button>
            )
          }
        />
      )}

      <CourseFormDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}