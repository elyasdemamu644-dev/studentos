import { CalendarClock, Check, Link2 } from "lucide-react";
import type { Task } from "@/types/api-types";
import { dueLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "./priority-badge";
import { CourseSwatch } from "./course-swatch";

export function TaskCard({
  task,
  onToggle,
  onClick,
}: {
  task: Task;
  onToggle?: () => void;
  onClick?: () => void;
}) {
  const due = dueLabel(task.dueDate, task.status);
  const done = task.status === "COMPLETED";
  const late = due.tone === "overdue";

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "surface-panel group flex items-start gap-3 p-4 transition-all",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-pop",
        late && !done && "border-danger/25 bg-danger/[0.04]",
        done && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        aria-label={done ? "Mark as not completed" : "Mark as completed"}
        disabled={!onToggle}
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/50 hover:border-primary hover:text-primary",
        )}
      >
        {done && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("font-medium", done && "line-through")}>{task.title}</p>
          <PriorityBadge priority={task.priority} />
        </div>
        {task.description && (
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{task.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {task.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                late && "font-medium text-danger",
                due.tone === "soon" && "font-medium text-warning",
                due.tone === "done" && "text-success",
              )}
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              {due.label}
            </span>
          )}
          {task.course && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <CourseSwatch id={task.course.id} className="h-4 w-4 shrink-0 rounded-sm" />
              <span className="truncate">{task.course.code ?? task.course.name}</span>
            </span>
          )}
          {!task.dueDate && !task.course && (
            <span className="inline-flex items-center gap-1">
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              Unlinked
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
