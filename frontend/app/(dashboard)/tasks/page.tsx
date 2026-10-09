"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, ListTodo, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Chip, Panel } from "@/components/panel";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { TaskCard } from "@/components/domain/task-card";
import { Button } from "@/components/ui/button";
import { FilterBar, SearchField, SelectFilter } from "@/components/ui/filter-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
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
  useTask,
  useTasks,
  useUpdateTask,
} from "@/features/tasks/hooks";
import { TaskFormDialog } from "@/features/tasks/task-form";
import { useCourses } from "@/features/courses/hooks";
import { PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/labels";
import type { Task, TaskPriority, TaskType } from "@/types/api-types";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import { useAcademicBreadcrumb } from "@/features/academics/use-academic-breadcrumb";

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
  const [courseId, setCourseId] = useState(searchParams.get("course") ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  /** Drop one query param and keep the rest, so Back doesn't reopen dialogs. */
  const stripParam = useCallback(
    (key: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete(key);
      const qs = params.toString();
      router.replace(qs ? `/tasks?${qs}` : "/tasks", { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditing(undefined);
      setFormOpen(true);
      stripParam("new");
    }
  }, [searchParams, stripParam]);

  // Deep links from the command palette: `/tasks?task=<id>` opens that task's
  // editor. A stale id (deleted elsewhere) is dropped rather than spinning.
  const taskIdParam = searchParams.get("task");
  const taskQuery = useTask(taskIdParam ?? undefined);
  const openedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!taskIdParam) {
      openedTaskRef.current = null;
      return;
    }
    if (taskQuery.isError) {
      openedTaskRef.current = null;
      stripParam("task");
      return;
    }
    const task = taskQuery.data;
    if (!task || openedTaskRef.current === taskIdParam) return;
    openedTaskRef.current = taskIdParam;
    setEditing(task);
    setFormOpen(true);
    stripParam("task");
  }, [taskIdParam, taskQuery.data, taskQuery.isError, stripParam]);

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

  const stats = useMemo(() => {
    const all = tasks.data?.items ?? [];
    let open = 0;
    let overdue = 0;
    let done = 0;
    const now = Date.now();
    for (const t of all) {
      if (t.status === "COMPLETED" || t.status === "CANCELLED") {
        done += 1;
        continue;
      }
      open += 1;
      if (t.dueDate && new Date(t.dueDate).getTime() < now) overdue += 1;
    }
    return { open, overdue, done };
  }, [tasks.data]);

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

  const breadcrumbItems = useAcademicBreadcrumb(courseId, "Tasks");

  return (
    <div>
      <Breadcrumb items={breadcrumbItems} />
      <PageHeader
        kicker="Workload"
        title="Tasks"
        description="Track assignments, homework and study prep."
        chips={
          tasks.data ? (
            <>
              <Chip tone="primary" icon={ListTodo}>
                {stats.open} open
              </Chip>
              {stats.overdue > 0 && (
                <Chip tone="danger" icon={AlertTriangle}>
                  {stats.overdue} overdue
                </Chip>
              )}
              <Chip tone="success" icon={CheckCircle2}>
                {stats.done} done
              </Chip>
            </>
          ) : undefined
        }
        actions={
          <Button size="sm" onClick={() => openForm()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New task
          </Button>
        }
      />

      <div className="mb-4">
        <SegmentedControl<View>
          label="Task view"
          value={view}
          onChange={setView}
          options={VIEWS}
          className="max-w-full overflow-x-auto"
        />
      </div>

      <FilterBar
        onClear={
          hasFilters
            ? () => {
                setSearch("");
                setDebouncedSearch("");
                setPriority("");
                setType("");
                setCourseId("");
                setView("ALL");
                router.replace("/tasks");
              }
            : undefined
        }
      >
        <SearchField
          value={search}
          onChange={setSearch}
          label="Search tasks"
          placeholder="Search tasks…"
        />
        <SelectFilter
          value={priority}
          onChange={setPriority}
          label="Filter by priority"
          placeholder="Any priority"
          allLabel="Any priority"
          options={(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => ({
            value: p,
            label: PRIORITY_LABELS[p],
          }))}
        />
        <SelectFilter
          value={type}
          onChange={setType}
          label="Filter by type"
          placeholder="Any type"
          allLabel="Any type"
          options={(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => ({
            value: t,
            label: TASK_TYPE_LABELS[t],
          }))}
        />
        <SelectFilter
          value={courseId}
          onChange={setCourseId}
          label="Filter by course"
          placeholder="Any course"
          allLabel="Any course"
          options={(courses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          className="sm:w-48"
        />
      </FilterBar>

      {tasks.isPending ? (
        <ListSkeleton rows={6} />
      ) : tasks.isError ? (
        <ErrorState error={tasks.error} retry={() => tasks.refetch()} />
      ) : tasks.data && tasks.data.items.length > 0 ? (
        <div className="space-y-6">
          {items.single ? (
            <Panel
              title={VIEWS.find((v) => v.value === view)?.label ?? "Tasks"}
              icon={ListTodo}
              tone="neutral"
              collapsible={false}
              actions={<Chip tone="neutral">{items.open.length + items.done.length}</Chip>}
            >
              {renderList(items.open, view === "COMPLETED")}
            </Panel>
          ) : (
            <>
              {items.open.length > 0 && (
                <Panel
                  title="Open"
                  icon={ListTodo}
                  tone="primary"
                  collapsible={false}
                  actions={<Chip tone="primary">{items.open.length}</Chip>}
                >
                  {renderList(items.open, false)}
                </Panel>
              )}
              {items.done.length > 0 && (
                <Panel
                  title="Done"
                  icon={CheckCircle2}
                  tone="success"
                  defaultOpen={false}
                  actions={<Chip tone="success">{items.done.length}</Chip>}
                >
                  {renderList(items.done, true)}
                </Panel>
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