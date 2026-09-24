import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database…");

  // Clean slate
  await prisma.refreshToken.deleteMany();
  await prisma.note.deleteMany();
  await prisma.task.deleteMany();
  await prisma.course.deleteMany();
  await prisma.semester.deleteMany();
  await prisma.academicYear.deleteMany();
  await prisma.user.deleteMany();

  // Academic years
  const ay2026 = await prisma.academicYear.create({
    data: {
      year: 2026,
      startDate: new Date("2026-09-01"),
      endDate: new Date("2027-06-30"),
      isActive: true,
    },
  });

  const ay2025 = await prisma.academicYear.create({
    data: {
      year: 2025,
      startDate: new Date("2025-09-01"),
      endDate: new Date("2026-06-30"),
      isActive: false,
    },
  });

  // Semesters
  const sem1 = await prisma.semester.create({
    data: {
      name: "Fall 2026",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2026-12-15"),
      academicYearId: ay2026.id,
      isActive: true,
    },
  });

  const sem2 = await prisma.semester.create({
    data: {
      name: "Spring 2027",
      startDate: new Date("2027-01-15"),
      endDate: new Date("2027-05-30"),
      academicYearId: ay2026.id,
      isActive: false,
    },
  });

  // Users
  const admin = await prisma.user.create({
    data: {
      email: "admin@studentos.dev",
      password: "admin123",
      firstName: "Admin",
      lastName: "User",
      university: "Test University",
      department: "Computer Science",
      academicYear: "2026",
      timezone: "Africa/Addis_Ababa",
    },
  });

  const student1 = await prisma.user.create({
    data: {
      email: "student1@studentos.dev",
      password: "student123",
      firstName: "Alice",
      lastName: "Student",
      university: "Test University",
      department: "Electrical Engineering",
      academicYear: "2026",
      timezone: "Africa/Addis_Ababa",
    },
  });

  const student2 = await prisma.user.create({
    data: {
      email: "student2@studentos.dev",
      password: "student223",
      firstName: "Bob",
      lastName: "Learner",
      university: "Test University",
      department: "Mathematics",
      academicYear: "2026",
      timezone: "Africa/Addis_Ababa",
    },
  });

  console.log("✅ Seed complete:");
  console.log(`   ${await prisma.academicYear.count()} academic years`);
  console.log(`   ${await prisma.semester.count()} semesters`);
  console.log(`   ${await prisma.user.count()} users`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
