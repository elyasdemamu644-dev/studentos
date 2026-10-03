import { CalendarClock, Link2 } from "lucide-react";
import type { Task } from "@/types/api-types";
import { dueLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "./priority-badge";

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
        "flex items-start gap-3 surface-panel p-4 transition-all group",
        onClick && "cursor-pointer hover:border-primary/40 hover:shadow-card",
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
          done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 hover:border-primary",
        )}
      >
        <span
          className="text-[10px] text-current"
          aria-hidden
        >
          {done ? "âœ“" : ""}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn("font-medium", done && "line-through")}>{task.title}</p>
          <PriorityBadge priority={task.priority} />
        </div>
        {task.description && (
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{task.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {task.dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                due.tone === "overdue" && "font-medium text-danger",
                due.tone === "soon" && "font-medium text-warning",
                due.tone === "done" && "text-success",
              )}
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              {due.label}
            </span>
          )}
          {task.course && (
            <span className="inline-flex items-center gap-1 truncate">
              <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {task.course.name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}