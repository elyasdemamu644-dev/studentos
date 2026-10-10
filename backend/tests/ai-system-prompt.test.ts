import { describe, expect, it } from "vitest";

import { AGENT_SYSTEM_INSTRUCTION, buildAgentSystemPrompt } from "@/services/ai/system-prompt";

/**
 * The agent prompt is the product here: it is what makes the assistant answer
 * like a tutor instead of a template. These tests pin the guidance that shapes
 * answer structure, and — just as importantly — that it never comes at the cost
 * of the honesty, confirmation and verification rules.
 */

describe("agent system prompt: answer style", () => {
  it("tells the model to shape the answer around the request", () => {
    expect(AGENT_SYSTEM_INSTRUCTION).toContain("ANSWERING WELL:");
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/factual question/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/table/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/lead with the answer/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/no filler/i);
  });

  it("covers the answer shapes a student actually asks for", () => {
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/problem to solve/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/checks it/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/misconception/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/says plainly when the evidence is missing/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/match the depth to the level/i);
  });

  it("scales length and formatting to the question", () => {
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/prefer prose for one or two points/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/match the length to the question/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/ask a single focused follow-up/i);
  });
});

describe("agent system prompt: safeguards are preserved", () => {
  it("keeps the ground rules about real data and confirmation", () => {
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/never guess/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/Never claim the change was made/i);
    expect(AGENT_SYSTEM_INSTRUCTION).toContain("confirm_pending_actions");
    expect(AGENT_SYSTEM_INSTRUCTION).toMatch(/never relaxes the tool, confirmation, verification or honesty rules/i);
  });
});

describe("buildAgentSystemPrompt", () => {
  it("frames the session with the date and optional details", () => {
    const prompt = buildAgentSystemPrompt({
      now: new Date("2026-10-10T09:00:00.000Z"),
      studentName: "Ada",
      pendingProposal: {
        id: "p1",
        title: "Add task",
        actionCount: 1,
        expiresAt: "2026-10-10T09:15:00.000Z",
      },
    });

    expect(prompt.startsWith(AGENT_SYSTEM_INSTRUCTION)).toBe(true);
    expect(prompt).toContain("2026-10-10T09:00:00.000Z");
    expect(prompt).toContain("Ada");
    expect(prompt).toContain('id "p1"');
  });

  it("omits the student and proposal when absent", () => {
    const prompt = buildAgentSystemPrompt({ now: new Date("2026-10-10T09:00:00.000Z") });
    expect(prompt).not.toContain("Student:");
    expect(prompt).not.toContain("PENDING PROPOSAL");
  });

  it("inlines the student snapshot so the tool path starts oriented", () => {
    const prompt = buildAgentSystemPrompt({
      now: new Date("2026-10-10T09:00:00.000Z"),
      studentContext: {
        currentSemester: {
          id: "sem-1",
          name: "Fall 2026",
          startDate: "2026-09-01T00:00:00.000Z",
          endDate: "2026-12-20T00:00:00.000Z",
          academicYearName: "2026/27",
        },
        courses: [
          { id: "c1", name: "Databases", code: "CS204", status: "ACTIVE", semesterId: "sem-1", credits: 5 },
        ],
        tasks: [
          {
            id: "t1",
            title: "ER diagram",
            courseId: "c1",
            status: "TODO",
            priority: "HIGH",
            dueDate: "2026-10-12T09:00:00.000Z",
            estimatedMinutes: 90,
          },
        ],
        upcomingEvents: [],
        recentStudySessions: [],
        activeGoals: [],
        recentNotes: [],
        recentGrades: [],
      },
    });

    expect(prompt).toContain("STUDENT SNAPSHOT");
    expect(prompt).toContain("Fall 2026");
    expect(prompt).toContain("CS204");
    // The snapshot is framed as possibly stale and tool-verifiable, so the
    // model does not state cached values as fact.
    expect(prompt).toMatch(/may be stale/i);
    expect(prompt).toMatch(/verify .* with a tool/i);
  });

  it("omits the snapshot section when there is no context", () => {
    const prompt = buildAgentSystemPrompt({ now: new Date("2026-10-10T09:00:00.000Z") });
    expect(prompt).not.toContain("STUDENT SNAPSHOT");
  });

  it("caps a very large snapshot so it cannot blow the context window", () => {
    const courses = Array.from({ length: 200 }, (_, i) => ({
      id: `course-${i}`,
      name: `A very long course name number ${i}`,
      code: `CODE${i}`,
      status: "ACTIVE",
      semesterId: null,
      credits: 3,
    }));
    const prompt = buildAgentSystemPrompt({
      now: new Date("2026-10-10T09:00:00.000Z"),
      studentContext: {
        currentSemester: null,
        courses,
        tasks: [],
        upcomingEvents: [],
        recentStudySessions: [],
        activeGoals: [],
        recentNotes: [],
        recentGrades: [],
      },
    });
    expect(prompt).toContain("[truncated]");
  });
});
