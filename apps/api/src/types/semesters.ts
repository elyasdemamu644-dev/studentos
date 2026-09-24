import type { Prisma } from "@prisma/client";

export type DeserializeSemester = Pick<
  Prisma.SemesterGetPayload<{
    include: {
      academicYear: { select: { id: true; name: true; startDate: true; endDate: true; status: true } };
    };
  }>,
  | "id"
  | "name"
  | "status"
  | "startDate"
  | "endDate"
  | "createdAt"
  | "updatedAt"
  | "academicYearId"
> & {
  academicYear: Pick<Prisma.SemesterGetPayload<{ include: { academicYear: { select: { id: true; name: true; startDate: true; endDate: true; status: true } } } }>, "id" | "name" | "startDate" | "endDate" | "status">;
};

export type DeserializeAcademicYear = Pick<
  Prisma.AcademicYearGetPayload<{ select: { id: true; name: true; startDate: true; endDate: true; status: true; createdAt: true; updatedAt: true } }>,
  "id" | "name" | "startDate" | "endDate" | "status" | "createdAt" | "updatedAt"
>;

export type SemesterCreateInput = {
  name: string;
  academicYearId: string;
  startDate: Date | string;
  endDate: Date | string;
  status?: string;
};

export type SemesterUpdateInput = Partial<SemesterCreateInput> & { id: string };

export type CreateSemesterInput = SemesterCreateInput;
export type UpdateSemesterInput = SemesterUpdateInput;
export type SemesterResponse = DeserializeSemester;
export type AcademicYearResponse = DeserializeAcademicYear;
