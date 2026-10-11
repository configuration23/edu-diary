import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { room, studyGroup, subject } from '../academics';
import { teachingAssignment } from '../staffing';
import {
  bellSchedule,
  lesson,
  scheduleEntry,
  scheduleException,
  substitution,
} from './schedule.schema';

/** SQL только здесь: звонки, расписание, исключения, уроки и замены. */

/** Время из базы приходит как `HH:MM:SS`: в DTO нужно `HH:MM`. */
function toTime(value: string): string {
  return value.slice(0, 5);
}

export interface BellScheduleRecord {
  id: string;
  pairNumber: number;
  timeStart: string;
  timeEnd: string;
  breakMinutes: number | null;
}

export interface ScheduleEntryRecord {
  id: string;
  assignmentId: string;
  studyGroupId: string;
  groupName: string;
  subjectId: string;
  subjectName: string;
  teacherUserId: string;
  roomId: string | null;
  roomName: string | null;
  dayOfWeek: number;
  pairNumber: number;
  timeStart: string;
  timeEnd: string;
  validFrom: string;
  validTo: string | null;
}

export interface ScheduleEntryInput {
  assignmentId: string;
  studyGroupId: string;
  roomId: string | null;
  dayOfWeek: number;
  pairNumber: number;
  timeStart: string;
  timeEnd: string;
  validFrom: string;
  validTo: string | null;
}

export interface ScheduleExceptionRecord {
  id: string;
  scheduleEntryId: string;
  studyGroupId: string;
  groupName: string;
  exceptionDate: string;
  pairNumber: number;
  action: string;
  payload: Record<string, unknown>;
  reason: string | null;
  createdAt: Date;
}

export interface LessonRecord {
  id: string;
  scheduleEntryId: string | null;
  assignmentId: string;
  studyGroupId: string;
  groupName: string;
  subjectId: string;
  subjectName: string;
  teacherUserId: string;
  plannedTeacherUserId: string | null;
  roomId: string | null;
  roomName: string | null;
  lessonDate: string;
  pairNumber: number;
  timeStart: string;
  timeEnd: string;
  topic: string | null;
  lessonType: string | null;
  status: string;
  isManual: boolean;
  createdAt: Date;
}

export interface SubstitutionRecord {
  id: string;
  assignmentId: string;
  lessonId: string | null;
  substituteUserId: string;
  replacedUserId: string;
  startsOn: string;
  endsOn: string | null;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface LessonListFilters {
  studyGroupId?: string | undefined;
  teacherUserId?: string | undefined;
  /** Группы, доступные ученику или его представителю (область `own`). */
  studyGroupIds?: readonly string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: string | undefined;
  substitutedOnly?: boolean | undefined;
  limit: number;
  offset: number;
}

const ENTRY_SELECTION = {
  id: scheduleEntry.id,
  assignmentId: scheduleEntry.assignmentId,
  studyGroupId: scheduleEntry.studyGroupId,
  groupName: studyGroup.name,
  subjectId: teachingAssignment.subjectId,
  subjectName: subject.name,
  teacherUserId: teachingAssignment.teacherUserId,
  roomId: scheduleEntry.roomId,
  roomName: room.name,
  dayOfWeek: scheduleEntry.dayOfWeek,
  pairNumber: scheduleEntry.pairNumber,
  timeStart: scheduleEntry.timeStart,
  timeEnd: scheduleEntry.timeEnd,
  validFrom: scheduleEntry.validFrom,
  validTo: scheduleEntry.validTo,
};

const LESSON_SELECTION = {
  id: lesson.id,
  scheduleEntryId: lesson.scheduleEntryId,
  assignmentId: lesson.assignmentId,
  studyGroupId: lesson.studyGroupId,
  groupName: studyGroup.name,
  subjectId: lesson.subjectId,
  subjectName: subject.name,
  teacherUserId: lesson.teacherUserId,
  plannedTeacherUserId: lesson.plannedTeacherUserId,
  roomId: lesson.roomId,
  roomName: room.name,
  lessonDate: lesson.lessonDate,
  pairNumber: lesson.pairNumber,
  timeStart: lesson.timeStart,
  timeEnd: lesson.timeEnd,
  topic: lesson.topic,
  lessonType: lesson.lessonType,
  status: lesson.status,
  isManual: lesson.isManual,
  createdAt: lesson.createdAt,
};

const EXCEPTION_SELECTION = {
  id: scheduleException.id,
  scheduleEntryId: scheduleException.scheduleEntryId,
  studyGroupId: scheduleException.studyGroupId,
  groupName: studyGroup.name,
  exceptionDate: scheduleException.exceptionDate,
  pairNumber: scheduleException.pairNumber,
  action: scheduleException.action,
  payload: scheduleException.payload,
  reason: scheduleException.reason,
  createdAt: scheduleException.createdAt,
};

function toEntryRecord(
  row: Omit<ScheduleEntryRecord, 'timeStart' | 'timeEnd'> & { timeStart: string; timeEnd: string },
): ScheduleEntryRecord {
  return { ...row, timeStart: toTime(row.timeStart), timeEnd: toTime(row.timeEnd) };
}

function toLessonRecord(
  row: Omit<LessonRecord, 'timeStart' | 'timeEnd'> & { timeStart: string; timeEnd: string },
): LessonRecord {
  return { ...row, timeStart: toTime(row.timeStart), timeEnd: toTime(row.timeEnd) };
}

/**
 * `jsonb` из базы приходит как `unknown`: приводим к словарю — в этой колонке
 * лежит полезная нагрузка исключения, а не произвольные данные.
 */
function toExceptionRecord(
  row: Omit<ScheduleExceptionRecord, 'payload'> & { payload: unknown },
): ScheduleExceptionRecord {
  return { ...row, payload: (row.payload ?? {}) as Record<string, unknown> };
}

export interface ScheduleRepository {
  /** Звонки: сетка времени по номеру пары. */
  listBells(): Promise<BellScheduleRecord[]>;
  upsertBell(
    input: { pairNumber: number; timeStart: string; timeEnd: string; breakMinutes: number | null },
    executor?: Executor,
  ): Promise<BellScheduleRecord>;
  deleteBell(pairNumber: number, executor?: Executor): Promise<boolean>;

  listEntries(filter: {
    studyGroupId?: string | undefined;
    teacherUserId?: string | undefined;
    studyGroupIds?: readonly string[] | undefined;
  }): Promise<ScheduleEntryRecord[]>;
  findEntry(id: string, executor?: Executor): Promise<ScheduleEntryRecord | null>;
  insertEntry(input: ScheduleEntryInput, executor?: Executor): Promise<ScheduleEntryRecord>;
  updateEntry(
    id: string,
    input: Partial<ScheduleEntryInput>,
    executor?: Executor,
  ): Promise<ScheduleEntryRecord | null>;
  deleteEntry(id: string, executor?: Executor): Promise<boolean>;
  countEntriesForAssignment(assignmentId: string, executor?: Executor): Promise<number>;

  listExceptions(filter: {
    studyGroupId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }): Promise<ScheduleExceptionRecord[]>;
  findException(id: string, executor?: Executor): Promise<ScheduleExceptionRecord | null>;
  findExceptionForSlot(
    scheduleEntryId: string,
    exceptionDate: string,
    pairNumber: number,
    executor?: Executor,
  ): Promise<ScheduleExceptionRecord | null>;
  insertException(
    input: {
      scheduleEntryId: string;
      studyGroupId: string;
      exceptionDate: string;
      pairNumber: number;
      action: string;
      payload: Record<string, unknown>;
      reason: string | null;
    },
    executor?: Executor,
  ): Promise<ScheduleExceptionRecord>;
  deleteException(id: string, executor?: Executor): Promise<boolean>;

  listLessons(filters: LessonListFilters): Promise<{ items: LessonRecord[]; total: number }>;
  findLesson(id: string, executor?: Executor): Promise<LessonRecord | null>;
  /**
   * Уроки назначения в периоде: нужны снятию замены на диапазон дат, чтобы
   * вернуть исходного преподавателя всем затронутым занятиям.
   */
  listLessonsForAssignment(
    assignmentId: string,
    from: string,
    to: string,
    executor?: Executor,
  ): Promise<LessonRecord[]>;
  /** Уроки преподавателя на дату: проверка занятости заменяющего. */
  listLessonsForTeacherOnDate(
    teacherUserId: string,
    lessonDate: string,
    executor?: Executor,
  ): Promise<LessonRecord[]>;
  listLessonsForGroup(
    studyGroupId: string,
    from: string,
    to: string,
    executor?: Executor,
  ): Promise<LessonRecord[]>;
  insertLesson(
    input: {
      scheduleEntryId: string | null;
      assignmentId: string;
      studyGroupId: string;
      subjectId: string;
      teacherUserId: string;
      roomId: string | null;
      lessonDate: string;
      pairNumber: number;
      timeStart: string;
      timeEnd: string;
      status: string;
      isManual: boolean;
    },
    executor?: Executor,
  ): Promise<LessonRecord>;
  updateLesson(
    id: string,
    input: {
      topic?: string | null;
      lessonType?: string | null;
      roomId?: string | null;
      lessonDate?: string;
      pairNumber?: number;
      timeStart?: string;
      timeEnd?: string;
      status?: string;
      teacherUserId?: string;
      plannedTeacherUserId?: string | null;
      isManual?: boolean;
    },
    executor?: Executor,
  ): Promise<LessonRecord | null>;
  deleteLesson(id: string, executor?: Executor): Promise<boolean>;
  /** Урок на эту пару даты: проверка наложения и повторной генерации. */
  findLessonForSlot(
    studyGroupId: string,
    lessonDate: string,
    pairNumber: number,
    executor?: Executor,
  ): Promise<LessonRecord | null>;

  listSubstitutions(filter: {
    lessonId?: string | undefined;
    assignmentId?: string | undefined;
    substituteUserId?: string | undefined;
  }): Promise<SubstitutionRecord[]>;
  findSubstitution(id: string, executor?: Executor): Promise<SubstitutionRecord | null>;
  /** Замена, действующая на дату по назначению (для генерации уроков). */
  findActiveForAssignment(
    assignmentId: string,
    date: string,
    executor?: Executor,
  ): Promise<SubstitutionRecord | null>;
  insertSubstitution(
    input: {
      assignmentId: string;
      lessonId: string | null;
      substituteUserId: string;
      replacedUserId: string;
      startsOn: string;
      endsOn: string | null;
      reason: string;
      createdBy: string | null;
    },
    executor?: Executor,
  ): Promise<SubstitutionRecord>;
  deleteSubstitution(id: string, executor?: Executor): Promise<boolean>;
}

export function createScheduleRepository(db: Database): ScheduleRepository {
  const entryQuery = () =>
    db.orm
      .select(ENTRY_SELECTION)
      .from(scheduleEntry)
      .innerJoin(studyGroup, eq(studyGroup.id, scheduleEntry.studyGroupId))
      .innerJoin(teachingAssignment, eq(teachingAssignment.id, scheduleEntry.assignmentId))
      .innerJoin(subject, eq(subject.id, teachingAssignment.subjectId))
      .leftJoin(room, eq(room.id, scheduleEntry.roomId));

  const lessonQuery = () =>
    db.orm
      .select(LESSON_SELECTION)
      .from(lesson)
      .innerJoin(studyGroup, eq(studyGroup.id, lesson.studyGroupId))
      .innerJoin(subject, eq(subject.id, lesson.subjectId))
      .leftJoin(room, eq(room.id, lesson.roomId));

  const exceptionQuery = () =>
    db.orm
      .select(EXCEPTION_SELECTION)
      .from(scheduleException)
      .innerJoin(studyGroup, eq(studyGroup.id, scheduleException.studyGroupId));

  return {
    async listBells() {
      const rows = await db.orm.select().from(bellSchedule).orderBy(asc(bellSchedule.pairNumber));

      return rows.map((row) => ({
        id: row.id,
        pairNumber: row.pairNumber,
        timeStart: toTime(row.timeStart),
        timeEnd: toTime(row.timeEnd),
        breakMinutes: row.breakMinutes,
      }));
    },

    async upsertBell(input, executor: Executor = db.orm) {
      // Пара уникальна: повторная запись — это правка сетки, а не вторая строка.
      const rows = await executor
        .insert(bellSchedule)
        .values(input)
        .onConflictDoUpdate({
          target: bellSchedule.pairNumber,
          set: {
            timeStart: input.timeStart,
            timeEnd: input.timeEnd,
            breakMinutes: input.breakMinutes,
            updatedAt: new Date(),
          },
        })
        .returning();

      const saved = rows[0];
      if (saved === undefined) throw new Error('Не удалось сохранить звонок');

      return {
        id: saved.id,
        pairNumber: saved.pairNumber,
        timeStart: toTime(saved.timeStart),
        timeEnd: toTime(saved.timeEnd),
        breakMinutes: saved.breakMinutes,
      };
    },

    async deleteBell(pairNumber, executor: Executor = db.orm) {
      const rows = await executor
        .delete(bellSchedule)
        .where(eq(bellSchedule.pairNumber, pairNumber))
        .returning({ id: bellSchedule.id });

      return rows.length > 0;
    },

    async listEntries(filter) {
      const conditions = [
        filter.studyGroupId === undefined
          ? undefined
          : eq(scheduleEntry.studyGroupId, filter.studyGroupId),
        filter.teacherUserId === undefined
          ? undefined
          : eq(teachingAssignment.teacherUserId, filter.teacherUserId),
        filter.studyGroupIds === undefined
          ? undefined
          : inArray(scheduleEntry.studyGroupId, [...filter.studyGroupIds]),
      ].filter((condition) => condition !== undefined);

      const rows = await entryQuery()
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(asc(scheduleEntry.dayOfWeek), asc(scheduleEntry.pairNumber));

      return rows.map(toEntryRecord);
    },

    async findEntry(id, executor: Executor = db.orm) {
      const rows = await executor
        .select(ENTRY_SELECTION)
        .from(scheduleEntry)
        .innerJoin(studyGroup, eq(studyGroup.id, scheduleEntry.studyGroupId))
        .innerJoin(teachingAssignment, eq(teachingAssignment.id, scheduleEntry.assignmentId))
        .innerJoin(subject, eq(subject.id, teachingAssignment.subjectId))
        .leftJoin(room, eq(room.id, scheduleEntry.roomId))
        .where(eq(scheduleEntry.id, id))
        .limit(1);

      const found = rows[0];
      return found === undefined ? null : toEntryRecord(found);
    },

    async insertEntry(input, executor: Executor = db.orm) {
      const rows = await executor
        .insert(scheduleEntry)
        .values(input)
        .returning({ id: scheduleEntry.id });

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать шаблон расписания');

      const record = await this.findEntry(created.id, executor);
      if (record === null) throw new Error('Шаблон расписания не найден после создания');
      return record;
    },

    async updateEntry(id, input, executor: Executor = db.orm) {
      const rows = await executor
        .update(scheduleEntry)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(scheduleEntry.id, id))
        .returning({ id: scheduleEntry.id });

      if (rows.length === 0) return null;
      return this.findEntry(id, executor);
    },

    async deleteEntry(id, executor: Executor = db.orm) {
      const rows = await executor
        .delete(scheduleEntry)
        .where(eq(scheduleEntry.id, id))
        .returning({ id: scheduleEntry.id });

      return rows.length > 0;
    },

    async countEntriesForAssignment(assignmentId, executor: Executor = db.orm) {
      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(scheduleEntry)
        .where(eq(scheduleEntry.assignmentId, assignmentId));

      return rows[0]?.count ?? 0;
    },

    async listExceptions(filter) {
      const conditions = [
        filter.studyGroupId === undefined
          ? undefined
          : eq(scheduleException.studyGroupId, filter.studyGroupId),
        filter.from === undefined ? undefined : gte(scheduleException.exceptionDate, filter.from),
        filter.to === undefined ? undefined : lte(scheduleException.exceptionDate, filter.to),
      ].filter((condition) => condition !== undefined);

      const rows = await exceptionQuery()
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(asc(scheduleException.exceptionDate), asc(scheduleException.pairNumber));

      return rows.map(toExceptionRecord);
    },

    async findException(id, executor: Executor = db.orm) {
      const rows = await executor
        .select(EXCEPTION_SELECTION)
        .from(scheduleException)
        .innerJoin(studyGroup, eq(studyGroup.id, scheduleException.studyGroupId))
        .where(eq(scheduleException.id, id))
        .limit(1);

      const found = rows[0];
      return found === undefined ? null : toExceptionRecord(found);
    },

    async findExceptionForSlot(
      scheduleEntryId,
      exceptionDate,
      pairNumber,
      executor: Executor = db.orm,
    ) {
      const rows = await executor
        .select(EXCEPTION_SELECTION)
        .from(scheduleException)
        .innerJoin(studyGroup, eq(studyGroup.id, scheduleException.studyGroupId))
        .where(
          and(
            eq(scheduleException.scheduleEntryId, scheduleEntryId),
            eq(scheduleException.exceptionDate, exceptionDate),
            eq(scheduleException.pairNumber, pairNumber),
          ),
        )
        .limit(1);

      const found = rows[0];
      return found === undefined ? null : toExceptionRecord(found);
    },

    async insertException(input, executor: Executor = db.orm) {
      const rows = await executor
        .insert(scheduleException)
        .values(input)
        .returning({ id: scheduleException.id });

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать исключение расписания');

      const record = await this.findException(created.id, executor);
      if (record === null) throw new Error('Исключение не найдено после создания');
      return record;
    },

    async deleteException(id, executor: Executor = db.orm) {
      const rows = await executor
        .delete(scheduleException)
        .where(eq(scheduleException.id, id))
        .returning({ id: scheduleException.id });

      return rows.length > 0;
    },

    async listLessons(filters) {
      const conditions = [
        filters.studyGroupId === undefined
          ? undefined
          : eq(lesson.studyGroupId, filters.studyGroupId),
        filters.teacherUserId === undefined
          ? undefined
          : eq(lesson.teacherUserId, filters.teacherUserId),
        filters.studyGroupIds === undefined
          ? undefined
          : inArray(lesson.studyGroupId, [...filters.studyGroupIds]),
        filters.from === undefined ? undefined : gte(lesson.lessonDate, filters.from),
        filters.to === undefined ? undefined : lte(lesson.lessonDate, filters.to),
        filters.status === undefined ? undefined : eq(lesson.status, filters.status),
        filters.substitutedOnly === true
          ? and(ne(lesson.status, 'cancelled'), sql`${lesson.plannedTeacherUserId} is not null`)
          : undefined,
      ].filter((condition) => condition !== undefined);

      const where = conditions.length === 0 ? undefined : and(...conditions);

      const rows = await lessonQuery()
        .where(where)
        .orderBy(asc(lesson.lessonDate), asc(lesson.pairNumber))
        .limit(filters.limit)
        .offset(filters.offset);

      const totalRows = await db.orm
        .select({ count: sql<number>`count(*)::int` })
        .from(lesson)
        .where(where);

      return { items: rows.map(toLessonRecord), total: totalRows[0]?.count ?? 0 };
    },

    async findLesson(id, executor: Executor = db.orm) {
      const rows = await executor
        .select(LESSON_SELECTION)
        .from(lesson)
        .innerJoin(studyGroup, eq(studyGroup.id, lesson.studyGroupId))
        .innerJoin(subject, eq(subject.id, lesson.subjectId))
        .leftJoin(room, eq(room.id, lesson.roomId))
        .where(eq(lesson.id, id))
        .limit(1);

      const found = rows[0];
      return found === undefined ? null : toLessonRecord(found);
    },

    async listLessonsForAssignment(assignmentId, from, to, executor: Executor = db.orm) {
      const rows = await executor
        .select(LESSON_SELECTION)
        .from(lesson)
        .innerJoin(studyGroup, eq(studyGroup.id, lesson.studyGroupId))
        .innerJoin(subject, eq(subject.id, lesson.subjectId))
        .leftJoin(room, eq(room.id, lesson.roomId))
        .where(
          and(
            eq(lesson.assignmentId, assignmentId),
            gte(lesson.lessonDate, from),
            lte(lesson.lessonDate, to),
          ),
        )
        .orderBy(asc(lesson.lessonDate), asc(lesson.pairNumber));

      return rows.map(toLessonRecord);
    },

    /**
     * Уроки конкретного преподавателя на дату.
     *
     * Нужны проверке занятости заменяющего: его занятие может быть в любой группе,
     * поэтому поиск идёт по преподавателю, а не по группе.
     */
    async listLessonsForTeacherOnDate(
      teacherUserId: string,
      lessonDate: string,
      executor: Executor = db.orm,
    ) {
      const rows = await executor
        .select(LESSON_SELECTION)
        .from(lesson)
        .innerJoin(studyGroup, eq(studyGroup.id, lesson.studyGroupId))
        .innerJoin(subject, eq(subject.id, lesson.subjectId))
        .leftJoin(room, eq(room.id, lesson.roomId))
        .where(and(eq(lesson.teacherUserId, teacherUserId), eq(lesson.lessonDate, lessonDate)));

      return rows.map(toLessonRecord);
    },

    async listLessonsForGroup(studyGroupId, from, to, executor: Executor = db.orm) {
      const rows = await executor
        .select(LESSON_SELECTION)
        .from(lesson)
        .innerJoin(studyGroup, eq(studyGroup.id, lesson.studyGroupId))
        .innerJoin(subject, eq(subject.id, lesson.subjectId))
        .leftJoin(room, eq(room.id, lesson.roomId))
        .where(
          and(
            eq(lesson.studyGroupId, studyGroupId),
            gte(lesson.lessonDate, from),
            lte(lesson.lessonDate, to),
          ),
        )
        .orderBy(asc(lesson.lessonDate), asc(lesson.pairNumber));

      return rows.map(toLessonRecord);
    },

    async insertLesson(input, executor: Executor = db.orm) {
      const rows = await executor.insert(lesson).values(input).returning({ id: lesson.id });
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать урок');

      const record = await this.findLesson(created.id, executor);
      if (record === null) throw new Error('Урок не найден после создания');
      return record;
    },

    async updateLesson(id, input, executor: Executor = db.orm) {
      const rows = await executor
        .update(lesson)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(lesson.id, id))
        .returning({ id: lesson.id });

      if (rows.length === 0) return null;
      return this.findLesson(id, executor);
    },

    async deleteLesson(id, executor: Executor = db.orm) {
      const rows = await executor
        .delete(lesson)
        .where(eq(lesson.id, id))
        .returning({ id: lesson.id });

      return rows.length > 0;
    },

    /**
     * Урок на паре в конкретную дату.
     *
     * Отменённый урок в поиск не попадает: пара считается свободной, и на неё
     * можно поставить новое занятие. Генерации, которой нужно вернуть отменённый
     * урок в план (например, после снятия исключения), нужен другой поиск — она
     * использует `listLessonsForGroup` и не отбрасывает отменённые.
     */
    async findLessonForSlot(studyGroupId, lessonDate, pairNumber, executor: Executor = db.orm) {
      // Берём уроки группы на дату и выбираем нужную пару в коде: условий в SQL
      // получается меньше, а поведение — предсказуемее. Уроков на одну дату в
      // группе не больше восьми (по числу пар).
      const rows = await executor
        .select(LESSON_SELECTION)
        .from(lesson)
        .innerJoin(studyGroup, eq(studyGroup.id, lesson.studyGroupId))
        .innerJoin(subject, eq(subject.id, lesson.subjectId))
        .leftJoin(room, eq(room.id, lesson.roomId))
        .where(and(eq(lesson.studyGroupId, studyGroupId), eq(lesson.lessonDate, lessonDate)));

      const found = rows.find((row) => row.pairNumber === pairNumber && row.status !== 'cancelled');

      // Контрольный запрос базовым соединением: отличает «нет данных» от
      // «исполнитель вернул не то».
      const direct = await db.orm
        .select({ pair: lesson.pairNumber, status: lesson.status, id: lesson.id })
        .from(lesson)
        .where(and(eq(lesson.studyGroupId, studyGroupId), eq(lesson.lessonDate, lessonDate)));

      process.stdout.write(
        `РЕПОЗИТОРИЙ pair=${pairNumber}(${typeof pairNumber}) через исполнитель=${rows.length} пары=${JSON.stringify(rows.map((row) => [row.pairNumber, typeof row.pairNumber]))} напрямую=${JSON.stringify(direct.map((row) => [row.pair, row.status]))}\n`,
      );

      return found === undefined ? null : toLessonRecord(found);
    },

    async listSubstitutions(filter) {
      const conditions = [
        filter.lessonId === undefined ? undefined : eq(substitution.lessonId, filter.lessonId),
        filter.assignmentId === undefined
          ? undefined
          : eq(substitution.assignmentId, filter.assignmentId),
        filter.substituteUserId === undefined
          ? undefined
          : eq(substitution.substituteUserId, filter.substituteUserId),
      ].filter((condition) => condition !== undefined);

      return db.orm
        .select()
        .from(substitution)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(asc(substitution.startsOn));
    },

    async findSubstitution(id, executor: Executor = db.orm) {
      // Читаем через переданный исполнитель: внутри транзакции только что
      // вставленная строка ещё не видна базовому соединению.
      const rows = await executor
        .select()
        .from(substitution)
        .where(eq(substitution.id, id))
        .limit(1);

      return rows[0] ?? null;
    },

    async findActiveForAssignment(assignmentId, date, executor: Executor = db.orm) {
      const rows = await executor
        .select()
        .from(substitution)
        .where(
          and(
            eq(substitution.assignmentId, assignmentId),
            lte(substitution.startsOn, date),
            // Замена без даты окончания действует до отмены: `null` — «до сих пор».
            sql`(${substitution.endsOn} is null or ${substitution.endsOn} >= ${date})`,
          ),
        )
        .orderBy(asc(substitution.startsOn))
        .limit(1);

      return rows[0] ?? null;
    },

    async insertSubstitution(input, executor: Executor = db.orm) {
      const rows = await executor
        .insert(substitution)
        .values(input)
        .returning({ id: substitution.id });

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать замену');

      const record = await this.findSubstitution(created.id, executor);
      if (record === null) throw new Error('Замена не найдена после создания');
      return record;
    },

    async deleteSubstitution(id, executor: Executor = db.orm) {
      const rows = await executor
        .delete(substitution)
        .where(eq(substitution.id, id))
        .returning({ id: substitution.id });

      return rows.length > 0;
    },
  };
}
