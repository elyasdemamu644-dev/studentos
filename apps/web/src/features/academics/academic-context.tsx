"use client";

import { useSearchParams } from "next/navigation";

/**
 * Reads the current academic context from URL search params.
 *
 * This allows forms and pages to know which course/semester the user
 * is currently working in, without prop-drilling through every component.
 *
 * The URL is the source of truth — it survives refresh, is shareable,
 * and works naturally with Next.js App Router navigation.
 */
export function useCourseContext(): string | null {
  const searchParams = useSearchParams();
  return searchParams.get("course");
}

export function useSemesterContext(): string | null {
  const searchParams = useSearchParams();
  return searchParams.get("semester");
}
