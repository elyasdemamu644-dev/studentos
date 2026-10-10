import { describe, it, expect } from "vitest";

import { prisma, registerAndLogin } from "./helpers";
import { studentContextBuilder } from "@/services/ai/context";

/**
 * The student snapshot is the AI's upfront view of the student's own data. These
 * tests pin the fields the agent needs to answer well — the current term, and
 * the course linkage + time budget that let it prioritise — and that the read is
 * always owner-scoped.
 */

async function seedStudent(tag: string) {
  const auth = await registerAndLogin(`${tag}@ai-context.test`, "Pass123!");
  const userId = auth.user.id;
  const now = new Date();

  const year = await prisma.academicYear.create({
    data: {
      userId,
      name: "2026/27",
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: new Date("2027-06-30T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  const semester = await prisma.semester.create({
    data: {
      userId,
      academicYearId: year.id,
      name: "Fall 2026",
      startDate: new Date(now.getTime() - 7 * 86400000),
      endDate: new Date(now.getTime() + 30 * 86400000),
      status: "ACTIVE",
    },
  });
  const course = await prisma.course.create({
    data: {
      userId,
      name: "Databases",
      code: "CS204",
      status: "ACTIVE",
      semesterId: semester.id,
      credits: 5,
    },
  });
  await prisma.task.create({
    data: {
      userId,
      courseId: course.id,
      title: "ER diagram",
      status: "TODO",
      priority: "HIGH",
      dueDate: now,
      estimatedMinutes: 90,
    },
  });
  await prisma.event.create({
    data: {
      userId,
      courseId: course.id,
      title: "CS204 Final",
      type: "EXAM",
      startAt: new Date(now.getTime() + 86400000),
    },
  });
  await prisma.grade.create({
    data: { userId, courseId: course.id, title: "Midterm", score: 40, maxScore: 50, weight: 30 },
  });

  return { userId, semesterId: semester.id, courseId: course.id };
}

describe("studentContextBuilder.build", () => {
  it("includes the current semester when one covers now", async () => {
    const { userId, semesterId } = await seedStudent("current-semester");

    const context = await studentContextBuilder.build(userId);

    expect(context.currentSemester).toMatchObject({
      id: semesterId,
      name: "Fall 2026",
      academicYearName: "2026/27",
    });
  });

  it("carries the course linkage and time budget the agent needs", async () => {
    const { userId, courseId, semesterId } = await seedStudent("linkage");

    const context = await studentContextBuilder.build(userId);

    expect(context.courses[0]).toMatchObject({
      code: "CS204",
      semesterId,
      credits: 5,
    });
    expect(context.tasks[0]).toMatchObject({
      title: "ER diagram",
      courseId,
      estimatedMinutes: 90,
    });
    expect(context.upcomingEvents[0]).toMatchObject({ title: "CS204 Final", courseId, type: "EXAM" });
    expect(context.recentGrades[0]).toMatchObject({ title: "Midterm", courseId, weight: 30 });
  });

  it("never leaks another student's data into the snapshot", async () => {
    const { userId } = await seedStudent("owner");
    const other = await seedStudent("intruder");

    const context = await studentContextBuilder.build(userId);

    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain(other.courseId);
    expect(serialized).not.toContain("intruder");
  });

  it("reports no current semester when none covers now", async () => {
    const auth = await registerAndLogin("no-semester@ai-context.test", "Pass123!");
    const userId = auth.user.id;
    const year = await prisma.academicYear.create({
      data: {
        userId,
        name: "2034/35",
        startDate: new Date("2034-08-01T00:00:00.000Z"),
        endDate: new Date("2035-06-30T00:00:00.000Z"),
        status: "UPCOMING",
      },
    });
    await prisma.semester.create({
      data: {
        userId,
        academicYearId: year.id,
        name: "Fall 2034",
        startDate: new Date("2034-09-01T00:00:00.000Z"),
        endDate: new Date("2034-12-15T00:00:00.000Z"),
        status: "UPCOMING",
      },
    });

    const context = await studentContextBuilder.build(userId);

    expect(context.currentSemester).toBeNull();
  });
});
