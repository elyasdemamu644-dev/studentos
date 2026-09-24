"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListTodo, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { TaskCard } from "@/components/domain/task-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCompleteTask,
  useDeleteTask,
  useTasks,
  useUpdateTask,
} from "@/features/tasks/hooks";
import { TaskFormDialog } from "@/features/tasks/task-form";
import { useCourses } from "@/features/courses/hooks";
import { PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/labels";
import type { Task, TaskPriority, TaskType } from "@/features/api-types";
import { cn } from "@/lib/utils";

type View = "ALL" | "TODO" | "IN_PROGRESS" | "COMPLETED";

const VIEWS: Array<{ value: View; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "TODO", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
];

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [view, setView] = useState<View>("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [type, setType] = useState("");
  const [courseId, setCourseId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditing(undefined);
      setFormOpen(true);
      router.replace("/tasks");
    }
  }, [searchParams, router]);

  const tasks = useTasks({
    status: view === "ALL" || view === "COMPLETED" ? undefined : view,
    priority: (priority as TaskPriority) || undefined,
    type: (type as TaskType) || undefined,
    courseId: courseId || undefined,
    search: debouncedSearch || undefined,
    limit: 50,
  });
  const courses = useCourses();

  const completeTask = useCompleteTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const items = useMemo(() => {
    const all = tasks.data?.items ?? [];
    if (view === "ALL") {
      const open = all.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
      const done = all.filter((t) => t.status === "COMPLETED" || t.status === "CANCELLED");
      return { open, done, single: false };
    }
    return { open: all, done: [], single: true };
  }, [tasks.data, view]);

  const hasFilters = Boolean(debouncedSearch || priority || type || courseId || view !== "ALL");

  const openForm = (task?: Task) => {
    setEditing(task);
    setFormOpen(true);
  };

  const toggleTask = (task: Task) => {
    if (task.status === "COMPLETED") {
      void updateTask.mutateAsync({ id: task.id, input: { status: "TODO", completedAt: null } });
    } else {
      void completeTask.mutateAsync(task.id);
    }
  };

  const renderList = (tasks: Task[], done: boolean) => (
    <ul className="space-y-2.5">
      {tasks.map((task) => (
        <li key={task.id} className="group flex items-stretch gap-2">
          <div className="min-w-0 flex-1">
            <TaskCard task={task} onToggle={() => toggleTask(task)} />
          </div>
          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${task.title}`}>
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => openForm(task)}>
                  <Pencil aria-hidden /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (done || task.status === "COMPLETED") {
                      void updateTask.mutateAsync({ id: task.id, input: { status: "TODO", completedAt: null } });
                    } else {
                      void completeTask.mutateAsync(task.id);
                    }
                  }}
                >
                  <ListTodo aria-hidden /> {task.status === "COMPLETED" ? "Reopen" : "Mark done"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void deleteTask.mutateAsync(task.id)}
                >
                  <Trash2 aria-hidden /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div>
      <PageHeader
        kicker="Workload"
        title="Tasks"
        description="Track assignments, homework and study prep."
        actions={
          <Button size="sm" onClick={() => openForm()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New task
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setView(v.value)}
              aria-pressed={view === v.value}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view === v.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="relative w-full flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="pl-9"
          />
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by priority">
            <SelectValue placeholder="Any priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Any priority</SelectItem>
            {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by type">
            <SelectValue placeholder="Any type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Any type</SelectItem>
            {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TASK_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={courseId} onValueChange={setCourseId}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by course">
            <SelectValue placeholder="Any course" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Any course</SelectItem>
            {(courses.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
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
              setPriority("");
              setType("");
              setCourseId("");
              setView("ALL");
              router.replace("/tasks");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {tasks.isPending ? (
        <ListSkeleton rows={6} />
      ) : tasks.isError ? (
        <ErrorState error={tasks.error} retry={() => tasks.refetch()} />
      ) : tasks.data && tasks.data.items.length > 0 ? (
        <div className="space-y-8">
          {items.single ? (
            renderList(items.open, false)
          ) : (
            <>
              {items.open.length > 0 && (
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Open · {items.open.length}
                  </h2>
                  {renderList(items.open, false)}
                </section>
              )}
              {items.done.length > 0 && (
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Done · {items.done.length}
                  </h2>
                  {renderList(items.done, true)}
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <EmptyState
          icon={ListTodo}
          title={hasFilters ? "No matching tasks" : "No tasks yet"}
          description={
            hasFilters
              ? "Try adjusting your filters."
              : "Add a task to keep track of your work — you can link it to a course and set a due date."
          }
          action={
            !hasFilters && (
              <Button size="sm" onClick={() => openForm()}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New task
              </Button>
            )
          }
        />
      )}

      <TaskFormDialog open={formOpen} onOpenChange={setFormOpen} task={editing} />
    </div>
  );
}