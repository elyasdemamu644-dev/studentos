"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, Award, Flame, Pencil, Plus, TrendingUp, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState, ListSkeleton } from "@/components/feedback";
import { ErrorState } from "@/components/states";
import { StatCard } from "@/components/domain/stat-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGrades, useDeleteGrade } from "@/features/grades/hooks";
import { GradeFormDialog } from "@/features/grades/grade-form";
import { useCourses } from "@/features/courses/hooks";
import { useSessions } from "@/features/study/hooks";
import type { GradeRecord, GradeType } from "@/features/api-types";
import { formatDate, formatMinutes } from "@/lib/format";

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

const GRADE_TYPE_LABELS: Record<string, string> = {
  ASSIGNMENT: "Assignment",
  EXAM: "Exam",
  QUIZ: "Quiz",
  PROJECT: "Project",
  PARTICIPATION: "Participation",
  FINAL: "Final",
  OTHER: "Other",
  ASSESSMENT: "Assessment",
};

interface GradeDatum extends GradeRecord {
  pct: number | null;
}

function toPct(score: number | null, maxScore: number | null): number | null {
  if (score == null || !maxScore) return null;
  return Math.round((score / maxScore) * 100);
}

export default function AnalyticsPage() {
  const [courseFilter, setCourseFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GradeRecord | undefined>(undefined);

  const grades = useGrades({
    courseId: courseFilter || undefined,
    type: (typeFilter as GradeType) || undefined,
    limit: 500,
  });
  const courses = useCourses();
  const weekSessions = useSessions({ range: "week", limit: 1 });
  const deleteGrade = useDeleteGrade();

  const items = useMemo(
    () => (grades.data?.items ?? []).map((g) => ({ ...g, pct: toPct(g.score, g.maxScore) }) as GradeDatum),
    [grades.data],
  );
  const graded = items.filter((g) => g.pct != null).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  const avg = graded.length ? Math.round(graded.reduce((s, g) => s + (g.pct ?? 0), 0) / graded.length) : null;
  const best = graded.length ? Math.max(...graded.map((g) => g.pct ?? 0)) : null;

  const trendData = useMemo(
    () =>
      graded.slice(-20).map((g) => ({
        name: formatDate(g.recordedAt, "MMM d"),
        score: g.pct,
      })),
    [graded],
  );

  const byType = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const g of graded) {
      const list = map.get(g.type) ?? [];
      list.push(g.pct ?? 0);
      map.set(g.type, list);
    }
    return [...map.entries()]
      .map(([type, values]) => ({
        type,
        label: GRADE_TYPE_LABELS[type] ?? type,
        value: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      }))
      .sort((a, b) => b.value - a.value);
  }, [graded]);

  const byCourse = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const g of graded) {
      const key = g.course?.name ?? "Uncategorized";
      const list = map.get(key) ?? [];
      list.push(g.pct ?? 0);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([name, values]) => ({
        name,
        value: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      }))
      .sort((a, b) => b.value - a.value);
  }, [graded]);

  const hasData = items.length > 0;

  return (
    <div>
      <PageHeader
        kicker="Insights"
        title="Analytics"
        description="Your performance and study habits at a glance."
        actions={
          <Button size="sm" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Record grade
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by course">
            <SelectValue placeholder="All courses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All courses</SelectItem>
            {(courses.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by type">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All types</SelectItem>
            {Object.entries(GRADE_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Award} label="Average score" value={avg != null ? `${avg}%` : "—"} tone="primary" />
        <StatCard icon={TrendingUp} label="Best score" value={best != null ? `${best}%` : "—"} tone="success" />
        <StatCard icon={Flame} label="Studied this week" value={formatMinutes(weekSessions.data?.summary.totalMinutes)} tone="warning" />
        <StatCard icon={Award} label="Grades recorded" value={items.length} tone="neutral" />
      </div>

      {grades.isPending ? (
        <ListSkeleton rows={4} />
      ) : grades.isError ? (
        <ErrorState error={grades.error} retry={() => grades.refetch()} />
      ) : !hasData ? (
        <div className="mt-6">
          <EmptyState
            icon={Award}
            title="No grades yet"
            description="Record your first grade to start tracking your performance, or head to Analytics once you have some."
            action={
              <Button size="sm" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Record grade
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-5 shadow-card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <TrendingUp className="h-4 w-4 text-primary" aria-hidden /> Score trend
                </h2>
                <span className="text-xs text-muted-foreground">Last {trendData.length} grades</span>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                    <Tooltip formatter={(value) => [`${value}%`, "Score"]} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }} />
                    <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 shadow-card">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Award className="h-4 w-4 text-primary" aria-hidden /> Average by type
                </h2>
                <span className="text-xs text-muted-foreground">Percentages</span>
              </div>
              {byType.length === 0 ? (
                <EmptyState icon={Award} title="Not enough data" className="py-10" />
              ) : (
                <div className="flex items-center gap-2">
                  <div className="h-56 w-40 shrink-0 sm:w-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={byType}
                          dataKey="value"
                          nameKey="label"
                          innerRadius={40}
                          outerRadius={70}
                          paddingAngle={3}
                        >
                          {byType.map((_, i) => (
                            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => [`${value}%`, "Average"]} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="min-w-0 flex-1 space-y-1.5">
                    {byType.slice(0, 6).map((entry, i) => (
                      <li key={entry.type} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} aria-hidden />
                          <span className="truncate">{entry.label}</span>
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">{entry.value}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-semibold">
              <Award className="h-4 w-4 text-primary" aria-hidden /> Average by course
            </h2>
            {byCourse.length === 0 ? (
              <EmptyState icon={Award} title="Not enough scored data" className="py-10" />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCourse} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                    <Tooltip formatter={(value) => [`${value}%`, "Average"]} contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)" }} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {byCourse.map((_, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <Award className="h-4 w-4 text-primary" aria-hidden /> All grades
              </h2>
              <Button asChild variant="ghost" size="sm">
                <Link href="/courses">
                  Manage courses <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-semibold">Title</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Type</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Course</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Score</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Weight</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Date</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...items].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map((grade) => (
                    <tr key={grade.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2.5 font-medium">{grade.title}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {GradeTypeLabel(grade.type)}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{grade.course?.name ?? "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        <span className="font-semibold text-primary">
                          {grade.score != null ? grade.score : "—"}
                        </span>
                        {grade.maxScore != null && <span className="text-muted-foreground"> / {grade.maxScore}</span>}
                        {grade.pct != null && <span className="ml-2 text-xs text-muted-foreground">({grade.pct}%)</span>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                        {grade.weight != null ? `${grade.weight}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{formatDate(grade.recordedAt)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => { setEditing(grade); setFormOpen(true); }} aria-label="Edit grade">
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button variant="ghost" size="icon-sm" className="text-danger hover:text-danger" onClick={() => void deleteGrade.mutateAsync(grade.id)} aria-label="Delete grade">
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <GradeFormDialog open={formOpen} onOpenChange={setFormOpen} grade={editing} />
    </div>
  );
}

function GradeTypeLabel(type: string): string {
  return GRADE_TYPE_LABELS[type] ?? type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}