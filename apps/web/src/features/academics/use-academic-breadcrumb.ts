"use client";

import { useCourse } from "@/features/courses/hooks";
import type { BreadcrumbItem } from "@/components/layout/breadcrumb";

/**
 * Resolves the full academic hierarchy for a course and returns breadcrumb items.
 *
 * Returns: Academics → Year → Semester → Course
 * If the course has no semester/year, it stops at Course.
 */
export function useAcademicBreadcrumb(
  courseId: string | null,
  currentLabel?: string,
): BreadcrumbItem[] {
  const course = useCourse(courseId ?? undefined);

  if (!courseId || course.isPending || course.isError || !course.data) {
    return currentLabel ? [{ label: currentLabel }] : [];
  }

  const data = course.data;
  const items: BreadcrumbItem[] = [{ label: "Academics", href: "/academics" }];

  if (data.semester) {
    if (data.semester.academicYear) {
      items.push({
        label: data.semester.academicYear.name,
        href: `/academics?year=${data.semester.academicYear.id}`,
      });
    }
    items.push({ label: data.semester.name, href: `/academics?semester=${data.semesterId}` });
  }

  items.push({ label: data.name, href: `/courses/${data.id}` });

  if (currentLabel) {
    items.push({ label: currentLabel });
  }

  return items;
}
