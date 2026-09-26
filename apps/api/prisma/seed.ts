import { PrismaClient, AcademicYearStatus, SemesterStatus, CourseStatus, TaskType, TaskPriority, TaskStatus, EventType, GoalStatus, MilestoneStatus, GradeType } from "@prisma/client";
import { hash as argon2Hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 4 });
}

async function main() {
  console.log("🌱 Seeding StudentOS database...");

  // 1. Clean slate in reverse foreign-key order
  await prisma.aiStudyPlanEntry.deleteMany();
  await prisma.aiStudyPlan.deleteMany();
  await prisma.aiMessage.deleteMany();
  await prisma.aiConversation.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.grade.deleteMany();
  await prisma.goalMilestone.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.studySession.deleteMany();
  await prisma.event.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.note.deleteMany();
  await prisma.taskTag.deleteMany();
  await prisma.taskSubtask.deleteMany();
  await prisma.task.deleteMany();
  await prisma.course.deleteMany();
  await prisma.semester.deleteMany();
  await prisma.academicYear.deleteMany();
  await prisma.userSetting.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await hashPassword("StudentPass123!");

  // 2. Demo User
  const demoUser = await prisma.user.create({
    data: {
      email: "demo@studentos.dev",
      passwordHash,
      firstName: "Alex",
      lastName: "Rivera",
      university: "Stanford University",
      department: "Computer Science",
      academicYear: "Junior (Year 3)",
      timezone: "America/Los_Angeles",
      settings: {
        createMany: {
          data: [
            { key: "theme", value: "system" },
            { key: "notifications_email", value: "true" },
            { key: "compact_mode", value: "false" },
          ],
        },
      },
    },
  });

  // Secondary User for multi-tenant isolation verification
  const bobUser = await prisma.user.create({
    data: {
      email: "bob@studentos.dev",
      passwordHash,
      firstName: "Bob",
      lastName: "Stone",
      university: "MIT",
      department: "Mathematics",
      academicYear: "Senior (Year 4)",
      timezone: "America/New_York",
    },
  });

  // 3. Academic Structure for Demo User
  const academicYear = await prisma.academicYear.create({
    data: {
      userId: demoUser.id,
      name: "2026 / 2027",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2027-06-30T00:00:00.000Z"),
      status: AcademicYearStatus.ACTIVE,
    },
  });

  const fallSemester = await prisma.semester.create({
    data: {
      userId: demoUser.id,
      academicYearId: academicYear.id,
      name: "Fall 2026",
      startDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-12-20T00:00:00.000Z"),
      status: SemesterStatus.ACTIVE,
    },
  });

  const springSemester = await prisma.semester.create({
    data: {
      userId: demoUser.id,
      academicYearId: academicYear.id,
      name: "Spring 2027",
      startDate: new Date("2027-01-15T00:00:00.000Z"),
      endDate: new Date("2027-05-31T00:00:00.000Z"),
      status: SemesterStatus.UPCOMING,
    },
  });

  // 4. Courses
  const dbCourse = await prisma.course.create({
    data: {
      userId: demoUser.id,
      semesterId: fallSemester.id,
      name: "Database Systems",
      code: "CS-345",
      description: "Relational modeling, indexing, B-Trees, transaction concurrency, and SQL optimization.",
      instructor: "Dr. Hector Garcia-Molina",
      credits: 4,
      color: "#6366f1",
      status: CourseStatus.ACTIVE,
    },
  });

  const osCourse = await prisma.course.create({
    data: {
      userId: demoUser.id,
      semesterId: fallSemester.id,
      name: "Operating Systems",
      code: "CS-210",
      description: "Kernel architecture, virtual memory, threads, synchronization, and file systems.",
      instructor: "Prof. John Ousterhout",
      credits: 4,
      color: "#10b981",
      status: CourseStatus.ACTIVE,
    },
  });

  const algosCourse = await prisma.course.create({
    data: {
      userId: demoUser.id,
      semesterId: fallSemester.id,
      name: "Algorithms & Complexity",
      code: "CS-161",
      description: "Greedy algorithms, dynamic programming, network flow, and NP-completeness.",
      instructor: "Dr. Mary Wootters",
      credits: 4,
      color: "#f59e0b",
      status: CourseStatus.ACTIVE,
    },
  });

  // 5. Tasks & Subtasks
  const task1 = await prisma.task.create({
    data: {
      userId: demoUser.id,
      courseId: dbCourse.id,
      title: "Problem Set 3: B+ Tree Index Implementation",
      description: "Implement node split and merge operations in Python with automated unit tests.",
      type: TaskType.ASSIGNMENT,
      priority: TaskPriority.HIGH,
      status: TaskStatus.IN_PROGRESS,
      dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // +5 days
      estimatedMinutes: 240,
      subtasks: {
        createMany: {
          data: [
            { title: "Review B+ tree invariant rules", status: TaskStatus.COMPLETED, position: 0 },
            { title: "Implement leaf node split logic", status: TaskStatus.IN_PROGRESS, position: 1 },
            { title: "Implement root expansion", status: TaskStatus.TODO, position: 2 },
            { title: "Run test harness suite", status: TaskStatus.TODO, position: 3 },
          ],
        },
      },
      taskTags: {
        createMany: {
          data: [
            { name: "homework", color: "#6366f1" },
            { name: "coding", color: "#10b981" },
          ],
        },
      },
    },
  });

  await prisma.task.create({
    data: {
      userId: demoUser.id,
      courseId: osCourse.id,
      title: "Read Pintos Project 1 Specification",
      description: "Understand timer_sleep and priority scheduler requirements.",
      type: TaskType.READING,
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.TODO,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      estimatedMinutes: 90,
    },
  });

  // 6. Notes
  await prisma.note.create({
    data: {
      userId: demoUser.id,
      courseId: dbCourse.id,
      title: "ACID Transactions & Two-Phase Locking (2PL)",
      content: `# ACID Guarantees in Relational Engines

## Atomicity
All or nothing. Implemented via Write-Ahead Logging (WAL).

## Consistency
Preserves integrity constraints across state transitions.

## Isolation
Transactions execute as if running sequentially.
- **Strict 2PL**: Hold all exclusive locks until commit/abort.
- **MVCC**: Multiple versions of each tuple for snapshot isolation.

## Durability
Committed state survives crashes via persistent log records.
`,
    },
  });

  // 7. Events (Calendar)
  await prisma.event.create({
    data: {
      userId: demoUser.id,
      courseId: dbCourse.id,
      title: "Database Systems Midterm Examination",
      description: "Covers SQL, relational algebra, disk storage, and indexing.",
      type: EventType.EXAM,
      startAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      location: "Gates Computer Science Building, Hall B",
    },
  });

  await prisma.event.create({
    data: {
      userId: demoUser.id,
      courseId: osCourse.id,
      title: "OS Lab Session — Concurrency",
      type: EventType.CLASS,
      startAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000),
      location: "Turing Lab 102",
    },
  });

  // 8. Study Sessions
  await prisma.studySession.create({
    data: {
      userId: demoUser.id,
      courseId: dbCourse.id,
      taskId: task1.id,
      topic: "B+ Tree Index Range Scans",
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      endedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      durationMinutes: 60,
      focusRating: 5,
    },
  });

  // 9. Goals & Milestones
  await prisma.goal.create({
    data: {
      userId: demoUser.id,
      title: "Maintain 3.8+ GPA in Core CS Curriculum",
      description: "Targeting high mastery in Systems and Algorithms.",
      status: GoalStatus.ACTIVE,
      progress: 65,
      deadline: new Date("2026-12-20T00:00:00.000Z"),
      milestones: {
        createMany: {
          data: [
            { title: "Score > 90% on DB Quiz 1", status: MilestoneStatus.COMPLETED, position: 0 },
            { title: "Complete all OS labs before deadlines", status: MilestoneStatus.IN_PROGRESS, position: 1 },
            { title: "Complete Algorithms mid-term revision sheet", status: MilestoneStatus.TODO, position: 2 },
          ],
        },
      },
    },
  });

  // 10. Grades
  await prisma.grade.create({
    data: {
      userId: demoUser.id,
      courseId: dbCourse.id,
      title: "Database Quiz 1: Relational Algebra",
      score: 96,
      maxScore: 100,
      weight: 10,
      type: GradeType.QUIZ,
    },
  });

  await prisma.grade.create({
    data: {
      userId: demoUser.id,
      courseId: osCourse.id,
      title: "Kernel Synchronization Lab 0",
      score: 100,
      maxScore: 100,
      weight: 15,
      type: GradeType.PROJECT,
    },
  });

  // 11. Notifications
  await prisma.notification.create({
    data: {
      userId: demoUser.id,
      title: "Upcoming Exam Alert",
      message: "Database Systems Midterm is in 12 days. Start your study plan!",
      type: "EXAM_REMINDER",
      status: "UNREAD",
      relatedType: "EXAM",
    },
  });

  // 12. Resources (URL type)
  await prisma.resource.create({
    data: {
      userId: demoUser.id,
      courseId: dbCourse.id,
      title: "Database Internals Book Companion",
      description: "Online chapters and code snippets for B-Tree implementations.",
      url: "https://www.databass.dev/",
      storageType: "URL",
      resourceType: "LINK",
    },
  });

  console.log("✅ Seed successfully completed!");
  console.log(`   Users:          ${await prisma.user.count()} (Demo: demo@studentos.dev / StudentPass123!)`);
  console.log(`   Academic Years: ${await prisma.academicYear.count()}`);
  console.log(`   Semesters:      ${await prisma.semester.count()}`);
  console.log(`   Courses:        ${await prisma.course.count()}`);
  console.log(`   Tasks:          ${await prisma.task.count()}`);
  console.log(`   Notes:          ${await prisma.note.count()}`);
  console.log(`   Events:         ${await prisma.event.count()}`);
  console.log(`   Grades:         ${await prisma.grade.count()}`);
  console.log(`   Goals:          ${await prisma.goal.count()}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
