import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

type ItemFixture = {
  id: string;
  kind: "TASK_OVERDUE" | "TASK_DUE_SOON" | "EXAM_UPCOMING" | "GOAL_AT_RISK" | "STUDY_SUMMARY";
  title: string;
  detail: string;
  dueAt: string | null;
  link: string;
  severity: "info" | "warning" | "urgent";
};

const FAILED_ESSAY: ItemFixture = {
  id: "task-1",
  kind: "TASK_OVERDUE",
  title: "Essay draft",
  detail: "Overdue · due 2 days ago",
  dueAt: "2026-10-17T10:00:00.000Z",
  link: "/tasks",
  severity: "urgent",
};

const CS301_EXAM: ItemFixture = {
  id: "event-1",
  kind: "EXAM_UPCOMING",
  title: "CS301 midterm",
  detail: "Exam · in 3 days",
  dueAt: "2026-10-22T08:00:00.000Z",
  link: "/calendar",
  severity: "warning",
};

const GOAL: ItemFixture = {
  id: "goal-1",
  kind: "GOAL_AT_RISK",
  title: "Finish reading list",
  detail: "Goal · 40% with 5 days left",
  dueAt: "2026-10-24T00:00:00.000Z",
  link: "/goals",
  severity: "info",
};

const STUDY_WEEK: ItemFixture = {
  id: "study-week",
  kind: "STUDY_SUMMARY",
  title: "This week's study",
  detail: "75 min across 2 sessions in the last 7 days",
  dueAt: null,
  link: "/study-sessions",
  severity: "info",
};

const h = vi.hoisted(() => {
  const briefing: {
    data: { generatedAt: string; items: unknown[]; summary: Record<string, number> } | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  } = { data: undefined, isPending: false, isError: false, error: null };
  return { briefing };
});

vi.mock("@/features/ai/hooks", () => ({
  useProactiveBriefing: () => h.briefing,
}));

import { ProactiveBriefingStrip } from "@/features/ai/proactive-briefing";

describe("proactive briefing strip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.briefing.data = {
      generatedAt: "2026-10-19T07:00:00.000Z",
      // Deliberately not in urgency order: the strip is what sorts them.
      items: [GOAL, STUDY_WEEK, CS301_EXAM, FAILED_ESSAY],
      summary: {
        overdueTasks: 1,
        dueSoonTasks: 0,
        upcomingExams: 1,
        atRiskGoals: 1,
        studySessionsThisWeek: 2,
        studyMinutesThisWeek: 75,
      },
    };
    h.briefing.isPending = false;
    h.briefing.isError = false;
    h.briefing.error = null;
  });

  it("shows the most urgent items first and links each to its workspace", () => {
    const { container } = render(<ProactiveBriefingStrip />);

    const text = container.textContent ?? "";
    expect(text).toContain("Needs attention");
    expect(text.indexOf(FAILED_ESSAY.title)).toBeLessThan(text.indexOf(CS301_EXAM.title));
    expect(text.indexOf(CS301_EXAM.title)).toBeLessThan(text.indexOf(GOAL.title));
    // Four items, three shown, the rest summarised.
    expect(text).not.toContain(STUDY_WEEK.title);
    expect(screen.getByText("+1 more")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Essay draft/ })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("link", { name: /CS301 midterm/ })).toHaveAttribute("href", "/calendar");
    expect(screen.getByRole("link", { name: /Finish reading list/ })).toHaveAttribute("href", "/goals");
  });

  it("carries the human detail line on each chip", () => {
    render(<ProactiveBriefingStrip />);

    expect(screen.getByRole("link", { name: /Essay draft/ })).toHaveTextContent(
      "Overdue · due 2 days ago",
    );
  });

  it("stays out of the way when there is nothing to flag", () => {
    h.briefing.data = { generatedAt: "2026-10-19T07:00:00.000Z", items: [], summary: {} };
    const { container } = render(<ProactiveBriefingStrip />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while loading instead of reserving empty space", () => {
    h.briefing.data = undefined;
    h.briefing.isPending = true;
    const { container } = render(<ProactiveBriefingStrip />);

    expect(container).toBeEmptyDOMElement();
  });

  it("hides a failed briefing rather than breaking the chat", () => {
    h.briefing.data = undefined;
    h.briefing.isError = true;
    h.briefing.error = new Error("briefing unavailable");
    const { container } = render(<ProactiveBriefingStrip />);

    expect(container).toBeEmptyDOMElement();
  });
});
