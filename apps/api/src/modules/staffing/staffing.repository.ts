import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { studyGroup, subject } from '../academics';
import { appUser } from '../iam';
import { teachingAssignment } from './staffing.schema';

/**
 * SQL только здесь: назначения «преподаватель ↔ предмет ↔ группа».
 *
 * Модуль `academics` не знает об этой таблице: чтобы не удалить предмет или
 * группу, которые уже используются, он спрашивает модуль `staffing` через порт
 * (собирается в `app.ts`). Так границы модулей остаются проверяемыми, а не «по
 * договорённости».
 *
 * Имена преподавателя, предмета и группы собираются соединениями, чтобы сервис
 * не ходил в чужие модули за каждой строкой списка.
 */

export interface AssignmentRow {
  id: string;
  teacherUserId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  studyGroupId: string;
  groupName: string;
  startsOn: string;
  endsOn: string | null;
  hoursPlanned: number | null;
}

export interface AssignmentListFilters {
  teacherUserId?: string | undefined;
  studyGroupId?: string | undefined;
  subjectId?: string | undefined;
  limit: number;
  offset: number;
}

export interface AssignmentInput {
  teacherUserId: string;
  subjectId: string;
  studyGroupId: string;
  startsOn: string;
  endsOn: string | null;
  hoursPlanned: number | null;
  note: string | null;
}

export interface AssignmentUsageFilter {
  subjectId?: string | undefined;
  studyGroupId?: string | undefined;
  teacherUserId?: string | undefined;
}

export interface StaffingRepository {
  list(filters: AssignmentListFilters): Promise<{ items: AssignmentRow[]; total: number }>;
  listActiveOn(date: string, executor?: Executor): Promise<AssignmentRow[]>;
  find(id: string, executor?: Executor): Promise<AssignmentRow | null>;
  /** Назначения выбранного преподавателя — для проверки пересечений периодов. */
  listByTeacher(teacherUserId: string, executor?: Executor): Promise<AssignmentRow[]>;
  /** Назначения выбранной группы — для проверки пересечений периодов. */
  listByGroup(studyGroupId: string, executor?: Executor): Promise<AssignmentRow[]>;
  insert(input: AssignmentInput, executor?: Executor): Promise<AssignmentRow>;
  update(
    id: string,
    input: {
      startsOn?: string;
      endsOn?: string | null;
      hoursPlanned?: number | null;
      note?: string | null;
    },
    executor?: Executor,
  ): Promise<AssignmentRow | null>;
  updateMany(
    ids: readonly string[],
    input: { endsOn: string },
    executor?: Executor,
  ): Promise<number>;
  remove(id: string, executor?: Executor): Promise<boolean>;
  /** Сколько назначений ссылается на предмет, группу или преподавателя. */
  countUsages(filter: AssignmentUsageFilter, executor?: Executor): Promise<number>;
}

function toConditions(filters: AssignmentListFilters): SQL[] {
  const conditions: (SQL | undefined)[] = [
    filters.teacherUserId === undefined
      ? undefined
      : eq(teachingAssignment.teacherUserId, filters.teacherUserId),
    filters.studyGroupId === undefined
      ? undefined
      : eq(teachingAssignment.studyGroupId, filters.studyGroupId),
    filters.subjectId === undefined
      ? undefined
      : eq(teachingAssignment.subjectId, filters.subjectId),
  ];

  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

export function createStaffingRepository(db: Database): StaffingRepository {
  const selection = {
    id: teachingAssignment.id,
    teacherUserId: teachingAssignment.teacherUserId,
    teacherName: appUser.fullName,
    subjectId: teachingAssignment.subjectId,
    subjectName: subject.name,
    studyGroupId: teachingAssignment.studyGroupId,
    groupName: studyGroup.name,
    startsOn: teachingAssignment.startsOn,
    endsOn: teachingAssignment.endsOn,
    hoursPlanned: teachingAssignment.hoursPlanned,
  };

  const withNames = (executor: Executor) =>
    executor
      .select(selection)
      .from(teachingAssignment)
      .innerJoin(appUser, eq(appUser.id, teachingAssignment.teacherUserId))
      .innerJoin(subject, eq(subject.id, teachingAssignment.subjectId))
      .innerJoin(studyGroup, eq(studyGroup.id, teachingAssignment.studyGroupId));

  return {
    async list(filters) {
      const conditions = toConditions(filters);
      const where = conditions.length === 0 ? undefined : and(...conditions);

      const items = await withNames(db.orm)
        .where(where)
        .orderBy(asc(studyGroup.name), asc(subject.name), desc(teachingAssignment.startsOn))
        .limit(filters.limit)
        .offset(filters.offset);

      const totals = await db.orm
        .select({ count: sql<number>`count(*)::int` })
        .from(teachingAssignment)
        .where(where);

      return { items, total: totals[0]?.count ?? 0 };
    },

    async listActiveOn(date, executor: Executor = db.orm): Promise<AssignmentRow[]> {
      return withNames(executor)
        .where(
          and(
            or(isNull(teachingAssignment.endsOn), sql`${teachingAssignment.endsOn} >= ${date}`),
            sql`${teachingAssignment.startsOn} <= ${date}`,
          ),
        )
        .orderBy(asc(studyGroup.name), asc(subject.name));
    },

    async find(id, executor: Executor = db.orm): Promise<AssignmentRow | null> {
      const rows = await withNames(executor).where(eq(teachingAssignment.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listByTeacher(teacherUserId, executor: Executor = db.orm): Promise<AssignmentRow[]> {
      return withNames(executor)
        .where(eq(teachingAssignment.teacherUserId, teacherUserId))
        .orderBy(asc(teachingAssignment.startsOn));
    },

    async listByGroup(studyGroupId, executor: Executor = db.orm): Promise<AssignmentRow[]> {
      return withNames(executor)
        .where(eq(teachingAssignment.studyGroupId, studyGroupId))
        .orderBy(asc(teachingAssignment.startsOn));
    },

    async insert(input, executor: Executor = db.orm): Promise<AssignmentRow> {
      const rows = await executor
        .insert(teachingAssignment)
        .values(input)
        .returning({ id: teachingAssignment.id });

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать назначение');

      const assignment = await this.find(created.id, executor);
      if (assignment === null) throw new Error('Не удалось прочитать назначение');
      return assignment;
    },

    async update(id, input, executor: Executor = db.orm): Promise<AssignmentRow | null> {
      const rows = await executor
        .update(teachingAssignment)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(teachingAssignment.id, id))
        .returning({ id: teachingAssignment.id });

      if (rows.length === 0) return null;
      return this.find(id, executor);
    },

    async updateMany(ids, input, executor: Executor = db.orm): Promise<number> {
      let updated = 0;

      for (const id of ids) {
        const rows = await executor
          .update(teachingAssignment)
          .set({ endsOn: input.endsOn, updatedAt: new Date() })
          .where(eq(teachingAssignment.id, id))
          .returning({ id: teachingAssignment.id });

        updated += rows.length;
      }

      return updated;
    },

    async remove(id, executor: Executor = db.orm): Promise<boolean> {
      const rows = await executor
        .delete(teachingAssignment)
        .where(eq(teachingAssignment.id, id))
        .returning({ id: teachingAssignment.id });

      return rows.length > 0;
    },

    async countUsages(filter, executor: Executor = db.orm): Promise<number> {
      const conditions: (SQL | undefined)[] = [
        filter.subjectId === undefined
          ? undefined
          : eq(teachingAssignment.subjectId, filter.subjectId),
        filter.studyGroupId === undefined
          ? undefined
          : eq(teachingAssignment.studyGroupId, filter.studyGroupId),
        filter.teacherUserId === undefined
          ? undefined
          : eq(teachingAssignment.teacherUserId, filter.teacherUserId),
      ];

      const present = conditions.filter((condition): condition is SQL => condition !== undefined);
      if (present.length === 0) return 0;

      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(teachingAssignment)
        .where(and(...present));

      return rows[0]?.count ?? 0;
    },
  };
}
