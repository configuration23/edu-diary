import { and, asc, eq, ilike, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { academicYear, period, student } from './academics.schema';

/** SQL только здесь: ученики, учебные годы и периоды. */

export interface StudentRecord {
  id: string;
  userId: string | null;
  fullName: string;
  shortName: string | null;
  birthDate: string | null;
  note: string | null;
  createdAt: Date;
}

export interface StudentListFilters {
  search?: string | undefined;
  limit: number;
  offset: number;
}

export interface AcademicYearRecord {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
}

export interface PeriodRecord {
  id: string;
  academicYearId: string;
  title: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  sort: number;
}

export interface AcademicsRepository {
  listStudents(filters: StudentListFilters): Promise<{ items: StudentRecord[]; total: number }>;
  findStudent(id: string, executor?: Executor): Promise<StudentRecord | null>;
  insertStudent(
    input: {
      userId: string | null;
      fullName: string;
      shortName: string | null;
      birthDate: string | null;
      note: string | null;
    },
    executor?: Executor,
  ): Promise<StudentRecord>;
  updateStudent(
    id: string,
    input: {
      userId?: string | null;
      fullName?: string;
      shortName?: string | null;
      birthDate?: string | null;
      note?: string | null;
    },
    executor?: Executor,
  ): Promise<StudentRecord | null>;
  listAcademicYears(): Promise<AcademicYearRecord[]>;
  findAcademicYear(id: string, executor?: Executor): Promise<AcademicYearRecord | null>;
  insertAcademicYear(
    input: { title: string; startsOn: string; endsOn: string; isActive: boolean },
    executor?: Executor,
  ): Promise<AcademicYearRecord>;
  deactivateAcademicYears(executor?: Executor): Promise<void>;
  listPeriods(academicYearId?: string | undefined): Promise<PeriodRecord[]>;
  insertPeriod(
    input: {
      academicYearId: string;
      title: string;
      kind: string;
      startsOn: string;
      endsOn: string;
      sort: number;
    },
    executor?: Executor,
  ): Promise<PeriodRecord>;
  countPeriods(academicYearId: string, executor?: Executor): Promise<number>;
}

export function createAcademicsRepository(db: Database): AcademicsRepository {
  return {
    async listStudents(
      filters: StudentListFilters,
    ): Promise<{ items: StudentRecord[]; total: number }> {
      const where =
        filters.search === undefined || filters.search.trim() === ''
          ? undefined
          : ilike(student.fullName, `%${filters.search.trim()}%`);

      const items = await db.orm
        .select()
        .from(student)
        .where(where)
        .orderBy(asc(student.fullName))
        .limit(filters.limit)
        .offset(filters.offset);

      const totals = await db.orm
        .select({ count: sql<number>`count(*)::int` })
        .from(student)
        .where(where);

      return { items, total: totals[0]?.count ?? 0 };
    },

    async findStudent(id: string, executor: Executor = db.orm): Promise<StudentRecord | null> {
      const rows = await executor.select().from(student).where(eq(student.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async insertStudent(input, executor: Executor = db.orm): Promise<StudentRecord> {
      const rows = await executor.insert(student).values(input).returning();
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать ученика');
      return created;
    },

    async updateStudent(id, input, executor: Executor = db.orm): Promise<StudentRecord | null> {
      const rows = await executor
        .update(student)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(student.id, id))
        .returning();

      return rows[0] ?? null;
    },

    async listAcademicYears(): Promise<AcademicYearRecord[]> {
      return db.orm.select().from(academicYear).orderBy(asc(academicYear.startsOn));
    },

    async findAcademicYear(
      id: string,
      executor: Executor = db.orm,
    ): Promise<AcademicYearRecord | null> {
      const rows = await executor
        .select()
        .from(academicYear)
        .where(eq(academicYear.id, id))
        .limit(1);

      return rows[0] ?? null;
    },

    async insertAcademicYear(input, executor: Executor = db.orm): Promise<AcademicYearRecord> {
      const rows = await executor.insert(academicYear).values(input).returning();
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать учебный год');
      return created;
    },

    async deactivateAcademicYears(executor: Executor = db.orm): Promise<void> {
      await executor
        .update(academicYear)
        .set({ isActive: false })
        .where(eq(academicYear.isActive, true));
    },

    async listPeriods(academicYearId?: string | undefined): Promise<PeriodRecord[]> {
      const where =
        academicYearId === undefined ? undefined : eq(period.academicYearId, academicYearId);

      return db.orm
        .select()
        .from(period)
        .where(where)
        .orderBy(asc(period.startsOn), asc(period.sort));
    },

    async insertPeriod(input, executor: Executor = db.orm): Promise<PeriodRecord> {
      const rows = await executor.insert(period).values(input).returning();
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать период');
      return created;
    },

    async countPeriods(academicYearId: string, executor: Executor = db.orm): Promise<number> {
      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(period)
        .where(and(eq(period.academicYearId, academicYearId)));

      return rows[0]?.count ?? 0;
    },
  };
}
