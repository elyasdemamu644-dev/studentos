"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Plus, Search } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, GridSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { CourseCard } from "@/components/domain/course-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CourseFormDialog } from "@/features/courses/course-form";
import { useCourses, useSemesters } from "@/features/courses/hooks";

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

  return (
    <div>
      <PageHeader
        kicker="Academics"
        title="Courses"
        description="Your enrolled courses and study material, all in one place."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add course
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search courses…"
            aria-label="Search courses"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="DROPPED">Dropped</SelectItem>
          </SelectContent>
        </Select>
        <Select value={semesterId} onValueChange={setSemesterId}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by semester">
            <SelectValue placeholder="All semesters" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All semesters</SelectItem>
            {(semesters.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setDebouncedSearch("");
              setStatus("");
              setSemesterId("");
              router.replace("/courses");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

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