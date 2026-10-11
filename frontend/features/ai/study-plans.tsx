"use client";

import { useState } from "react";
import { format } from "date-fns";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";

import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { Button, LoadingButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/surface";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCourses } from "@/features/courses/hooks";
import { useCreateStudyPlan, useDeleteStudyPlan, useStudyPlans, useUpdateStudyPlan, useUpdateStudyPlanEntry } from "@/features/ai/hooks";
import type { StudyPlan, StudyPlanEntryStatus } from "@/types/api-types";

interface DraftEntry {
  dayNumber: number;
  title: string;
  description: string;
  durationMinutes: number;
}

const EMPTY_ENTRY: DraftEntry = { dayNumber: 1, title: "", description: "", durationMinutes: 30 };

export function StudyPlans() {
  const plans = useStudyPlans();
  const courses = useCourses();
  const createPlan = useCreateStudyPlan();
  const updatePlan = useUpdateStudyPlan();
  const deletePlan = useDeleteStudyPlan();
  const updateEntry = useUpdateStudyPlanEntry();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<StudyPlan | null>(null);
  const [entryEditor, setEntryEditor] = useState<{ planId: string; entryId: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudyPlan | null>(null);
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [examDate, setExamDate] = useState("");
  const [entries, setEntries] = useState<DraftEntry[]>([{ ...EMPTY_ENTRY }]);
  const [entryTitle, setEntryTitle] = useState("");
  const [entryDescription, setEntryDescription] = useState("");
  const [entryDayNumber, setEntryDayNumber] = useState(1);
  const [entryDuration, setEntryDuration] = useState(30);

  const openCreate = () => {
    setEditingPlan(null);
    setTitle("");
    setCourseId("");
    setExamDate("");
    setEntries([{ ...EMPTY_ENTRY }]);
    setDialogOpen(true);
  };

  const openEdit = (plan: StudyPlan) => {
    setEditingPlan(plan);
    setTitle(plan.title);
    setCourseId(plan.courseId ?? "");
    setExamDate(plan.examDate ? format(new Date(plan.examDate), "yyyy-MM-dd") : "");
    setDialogOpen(true);
  };

  const savePlan = async () => {
    const name = title.trim();
    if (!name) return;
    const date = examDate ? new Date(`${examDate}T23:59:59`).toISOString() : null;
    if (editingPlan) {
      await updatePlan.mutateAsync({
        id: editingPlan.id,
        input: { title: name, courseId: courseId || null, examDate: date },
      });
    } else {
      const validEntries = entries
        .filter((entry) => entry.title.trim())
        .map((entry) => ({
          ...entry,
          title: entry.title.trim(),
          description: entry.description.trim() || null,
        }));
      await createPlan.mutateAsync({
        title: name,
        courseId: courseId || null,
        examDate: date,
        entries: validEntries,
      });
    }
    setDialogOpen(false);
  };

  const removePlan = () => {
    if (!deleteTarget) return;
    void deletePlan.mutateAsync(deleteTarget.id, { onSettled: () => setDeleteTarget(null) }).catch(() => undefined);
  };

  const editEntry = (planId: string, entry: StudyPlan["entries"][number]) => {
    setEntryEditor({ planId, entryId: entry.id });
    setEntryTitle(entry.title);
    setEntryDescription(entry.description ?? "");
    setEntryDayNumber(entry.dayNumber);
    setEntryDuration(entry.durationMinutes);
  };

  const saveEntry = async () => {
    if (!entryEditor || !entryTitle.trim()) return;
    await updateEntry.mutateAsync({
      ...entryEditor,
      input: {
        title: entryTitle.trim(),
        description: entryDescription.trim() || null,
        dayNumber: entryDayNumber,
        durationMinutes: entryDuration,
      },
    });
    setEntryEditor(null);
  };

  return (
    <SectionCard
      title="Saved study plans"
      icon={BookOpen}
      className="mt-6 p-5"
      headerExtra={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4" aria-hidden /> New plan</Button>}
    >
      {plans.isPending ? (
        <ListSkeleton rows={2} label="Loading study plans" />
      ) : plans.isError ? (
        <ErrorState error={plans.error} retry={() => void plans.refetch()} />
      ) : plans.data?.items.length ? (
        <ul className="space-y-4">
          {plans.data.items.map((plan) => {
            const course = courses.data?.find((item) => item.id === plan.courseId);
            return (
              <li key={plan.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{plan.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {course?.name ?? (plan.courseId ? "Course unavailable" : "No course")}
                      {plan.examDate && ` · Exam ${format(new Date(plan.examDate), "MMM d, yyyy")}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${plan.title}`} onClick={() => openEdit(plan)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${plan.title}`} onClick={() => setDeleteTarget(plan)}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
                {plan.entries.length ? (
                  <ol className="mt-3 space-y-2">
                    {plan.entries.map((entry) => (
                      <li key={entry.id} className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-2">
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="mr-2 text-xs text-muted-foreground">Day {entry.dayNumber}</span>
                          {entry.title}
                          {entry.description && <span className="ml-2 text-xs text-muted-foreground">· {entry.description}</span>}
                          <span className="ml-2 text-xs text-muted-foreground">· {entry.durationMinutes} min</span>
                        </span>
                        <Select
                          value={entry.status}
                          onValueChange={(status) => updateEntry.mutate({ planId: plan.id, entryId: entry.id, input: { status: status as StudyPlanEntryStatus } })}
                        >
                          <SelectTrigger className="h-8 w-36" aria-label={`Status for ${entry.title}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PENDING">Pending</SelectItem>
                            <SelectItem value="IN_PROGRESS">In progress</SelectItem>
                            <SelectItem value="COMPLETED">Completed</SelectItem>
                            <SelectItem value="SKIPPED">Skipped</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${entry.title}`} onClick={() => editEntry(plan.id, entry)}>
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">No sessions were added to this plan.</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={BookOpen} title="No saved study plans" description="Create a plan and organize sessions around an exam or course." compact />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Edit study plan" : "Create study plan"}</DialogTitle>
            <DialogDescription>
              {editingPlan ? "Update the plan details." : "Add a course, exam date and as many initial study steps as you need."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="study-plan-title">Plan title</Label>
              <Input id="study-plan-title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="study-plan-course">Course</Label>
                <Select value={courseId || "__none"} onValueChange={(value) => setCourseId(value === "__none" ? "" : value)}>
                  <SelectTrigger id="study-plan-course"><SelectValue placeholder="No course" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No course</SelectItem>
                    {(courses.data ?? []).map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="study-plan-exam-date">Exam date</Label>
                <Input id="study-plan-exam-date" type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
              </div>
            </div>
            {!editingPlan && (
              <div className="max-h-64 space-y-3 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <Label>Initial study steps</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEntries((current) => [...current, { ...EMPTY_ENTRY, dayNumber: current.length + 1 }])}>
                    <Plus className="h-4 w-4" aria-hidden /> Add step
                  </Button>
                </div>
                {entries.map((entry, index) => (
                  <div key={index} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[5rem_1fr_6rem_auto]">
                    <div className="space-y-1">
                      <Label htmlFor={`plan-day-${index}`}>Day</Label>
                      <Input id={`plan-day-${index}`} type="number" min={1} max={365} value={entry.dayNumber} onChange={(event) => setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, dayNumber: Math.max(1, Number(event.target.value)) } : item))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`plan-entry-title-${index}`}>Step</Label>
                      <Input id={`plan-entry-title-${index}`} value={entry.title} maxLength={200} onChange={(event) => setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
                      <Label htmlFor={`plan-entry-description-${index}`} className="sr-only">Description</Label>
                      <Input id={`plan-entry-description-${index}`} value={entry.description} maxLength={2000} placeholder="Optional description" onChange={(event) => setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`plan-duration-${index}`}>Minutes</Label>
                      <Input id={`plan-duration-${index}`} type="number" min={1} max={1440} value={entry.durationMinutes} onChange={(event) => setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, durationMinutes: Math.max(1, Number(event.target.value)) } : item))} />
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" className="self-end" aria-label={`Remove step ${index + 1}`} disabled={entries.length === 1} onClick={() => setEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <LoadingButton loading={createPlan.isPending || updatePlan.isPending} disabled={!title.trim()} onClick={() => void savePlan().catch(() => undefined)}>
              {editingPlan ? "Save changes" : "Create plan"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={entryEditor !== null} onOpenChange={(open) => { if (!open) setEntryEditor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit study step</DialogTitle>
            <DialogDescription>Update the day, title, description and planned duration.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="plan-entry-edit-day">Day</Label>
                <Input id="plan-entry-edit-day" type="number" min={1} max={365} value={entryDayNumber} onChange={(event) => setEntryDayNumber(Math.max(1, Number(event.target.value)))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-entry-edit-duration">Minutes</Label>
                <Input id="plan-entry-edit-duration" type="number" min={1} max={1440} value={entryDuration} onChange={(event) => setEntryDuration(Math.max(1, Number(event.target.value)))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-entry-edit-title">Title</Label>
              <Input id="plan-entry-edit-title" value={entryTitle} maxLength={200} onChange={(event) => setEntryTitle(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-entry-edit-description">Description</Label>
              <Input id="plan-entry-edit-description" value={entryDescription} maxLength={2000} onChange={(event) => setEntryDescription(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEntryEditor(null)}>Cancel</Button>
            <LoadingButton loading={updateEntry.isPending} disabled={!entryTitle.trim()} onClick={() => void saveEntry().catch(() => undefined)}>Save step</LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete study plan?"
        description={`“${deleteTarget?.title ?? ""}” and its study steps will be permanently removed.`}
        busy={deletePlan.isPending}
        onConfirm={removePlan}
      />
    </SectionCard>
  );
}
