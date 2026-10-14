import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/utils/prisma";
import { authenticate, type AuthRequest } from "@/middlewares/auth";
import { ConflictError, NotFoundError, ValidationApiError } from "@/config/errors";
import { config } from "@/config";

const router = Router();

// ─────────────────────────────────────────────
// CSV Import schemas
// ─────────────────────────────────────────────

const csvImportCourseSchema = z.object({
  code: z.string().max(20).optional(),
  name: z.string().min(1).max(200),
  credits: z.number().int().min(0).max(50).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  semesterId: z.string().min(1).nullable().optional(),
});

const csvImportTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  type: z.enum(["ASSIGNMENT", "HOMEWORK", "PROJECT", "READING", "PRACTICE", "REVISION", "OTHER"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  courseId: z.string().min(1).optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function parseCsvRow(row: string, headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  // Simple CSV parsing: split by comma, respect quoting
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);

  // Map cells to headers
  for (let i = 0; i < headers.length; i++) {
    result[headers[i]] = i < cells.length ? cells[i].trim() : "";
  }
  return result;
}

async function resolveCourseId(userId: string, courseId: string | null): Promise<string | null> {
  if (!courseId) return null;
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId },
  });
  return course ? course.id : null;
}

// ─────────────────────────────────────────────
// POST /api/v1/import/courses  — CSV import courses
// ─────────────────────────────────────────────

router.post(
  "/courses",
  authenticate,
  async (req: AuthRequest, res, next) => {
    try {
      const { file } = req.body as {
        file: { content: string; headers: string[]; rows: string[][] };
      };

      if (!file?.content) {
        throw new ValidationApiError("No CSV file content provided");
      }

      const lines = file.content.split("\n").filter((line: string) => line.trim().length > 0);
      if (lines.length < 2) {
        throw new ValidationApiError("CSV must have at least a header row and one data row");
      }

      const headers = lines[0].split(",").map((h: string) => h.trim());
      const coursesCreated: string[] = [];
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        try {
          const row = parseCsvRow(lines[i], headers);
          const validated = csvImportCourseSchema.parse({
            code: row.code,
            name: row.name,
            credits: row.credits ? Number(row.credits) : null,
            description: row.description,
            semesterId: row.semesterId,
          });

          // Find or create the course linked to the authenticated user
          let course = await prisma.course.findFirst({
            where: { userId: req.currentUser!.id, code: validated.code ?? undefined },
          });

          if (!course) {
            // Try to find the semester first
            const semesterId = validated.semesterId ?? undefined;
            const semester = semesterId
              ? await prisma.semester.findFirst({ where: { id: semesterId, userId: req.currentUser!.id } })
              : null;

            course = await prisma.course.create({
              data: {
                userId: req.currentUser!.id,
                code: validated.code ?? undefined ? validated.code! : undefined,
                name: validated.name,
                semesterId: semester?.id ?? null,
                status: "ACTIVE",
              },
            });
          }

          coursesCreated.push(course.id);
        } catch (error: any) {
          errors.push(`Row ${i + 1}: ${error.errors?.map((e: any) => e.message).join(", ")}`);
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          coursesCreated,
          errors,
          totalRows: lines.length - 1,
        },
      });
    } catch (error: any) {
      next(error);
    }
  }
);

// ─────────────────────────────────────────────
// POST /api/v1/import/tasks  — CSV import tasks
// ─────────────────────────────────────────────

router.post(
  "/tasks",
  authenticate,
  async (req: AuthRequest, res, next) => {
    try {
      const { file } = req.body as {
        file: { content: string; headers: string[]; rows: string[][] };
      };

      if (!file?.content) {
        throw new ValidationApiError("No CSV file content provided");
      }

      const lines = file.content.split("\n").filter((line: string) => line.trim().length > 0);
      if (lines.length < 2) {
        throw new ValidationApiError("CSV must have at least a header row and one data row");
      }

      const headers = lines[0].split(",").map((h: string) => h.trim());
      const tasksCreated: string[] = [];
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        try {
          const row = parseCsvRow(lines[i], headers);
          const validated = csvImportTaskSchema.parse({
            title: row.title,
            description: row.description,
            type: row.type,
            priority: row.priority,
            dueDate: row.dueDate,
            estimatedMinutes: row.estimatedMinutes ? Number(row.estimatedMinutes) : null,
            courseId: row.courseId,
            status: row.status,
          });

          // Resolve course if courseId provided — only link if the course belongs to this user
          const resolvedCourseId = await resolveCourseId(req.currentUser!.id, validated.courseId ?? null);

          const task = await prisma.task.create({
            data: {
              userId: req.currentUser!.id,
              title: validated.title,
              description: validated.description ?? null,
              type: validated.type ?? "OTHER",
              priority: validated.priority ?? "MEDIUM",
              dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
              estimatedMinutes: validated.estimatedMinutes ?? null,
              courseId: resolvedCourseId,
              status: validated.status ?? "TODO",
            },
            include: {
              course: {
                select: { id: true, code: true, name: true },
              },
            },
          });
          tasksCreated.push(task.id);
        } catch (error: any) {
          errors.push(`Row ${i + 1}: ${error.errors?.map((e: any) => e.message).join(", ")}`);
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          tasksCreated,
          errors,
          totalRows: lines.length - 1,
        },
      });
    } catch (error: any) {
      next(error);
    }
  }
);

export default router;