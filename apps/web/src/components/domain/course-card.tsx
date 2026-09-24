import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { Course } from "@/features/api-types";
import { courseColor, courseColorSoft } from "@/features/courses/courses-api";
import { cn } from "@/lib/utils";

export function CourseCard({ course, children }: { course: Course; children?: ReactNode }) {
  const soft = courseColorSoft(course.id);
  return (
    <Link
      href={`/courses/${course.id}`}
      className="group block rounded-xl border border-border bg-card p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="inline-block h-2.5 w-10 rounded-full"
          style={{ backgroundColor: soft, boxShadow: `inset 0 0 0 2px ${courseColor(course.id)}` }}
          aria-hidden
        />
        <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>
      <h3 className="mt-3 truncate font-semibold">{course.name}</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {course.code ?? "—"}
        {course.credits ? ` · ${course.credits} credits` : ""}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
            course.status === "ACTIVE" && "bg-success/10 text-success",
            course.status === "COMPLETED" && "bg-primary/10 text-primary",
            course.status === "DROPPED" && "bg-muted text-muted-foreground",
          )}
        >
          {course.status.toLowerCase()}
        </span>
        {course.semester && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {course.semester.name}
          </span>
        )}
      </div>
      {children}
    </Link>
  );
}