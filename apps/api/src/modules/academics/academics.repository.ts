import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import {
  academicYear,
  gradeCategory,
  period,
  room,
  student,
  studentEnrollment,
  studyGroup,
  subject,
} from './academics.schema';

/**
 * SQL только здесь: ученики, учебные годы и периоды, группы, зачисления и
 * справочники (предметы, аудитории, категории оценок).
 *
 * Запросы, которым нужны связанные имена (группа + число учеников, зачисление +
 * ФИО), используют `leftJoin`: сервис не собирает данные из нескольких вызовов.
 */

/** Минимум для списков: идентификатор и имя. */
export interface StatisticalStudent {
  id: string;
  fullName: string;
}

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

export interface StudyGroupRecord {
  id: string;
  academicYearId: string;
  name: string;
  course: number | null;
  specialty: string | null;
  curatorUserId: string | null;
  startsOn: string;
  endsOn: string;
  /** Сколько учеников числится сейчас (без отчисленных). */
  studentsCount: number;
}

export interface EnrollmentRecord {
  id: string;
  studentId: string;
  studyGroupId: string;
  studentName: string;
  joinedOn: string;
  leftOn: string | null;
  note: string | null;
}

export interface SubjectRecord {
  id: string;
  name: string;
  shortName: string | null;
  kind: string;
  color: string | null;
}

export interface RoomRecord {
  id: string;
  name: string;
  capacity: number | null;
  note: string | null;
}

export interface GradeCategoryRecord {
  id: string;
  code: string;
  title: string;
  weight: number;
  color: string | null;
  isDefault: boolean;
  /** Накопительный знак (`plus`/`dot`) или `null` у обычной причины. */
  sign: string | null;
  signThreshold: number | null;
  signRuleActive: boolean;
}

/**
 * Накопительный знак для пересчёта в оценки.
 *
 * Порог и выключатель лежат у самой причины знака, поэтому здесь только удобный
 * вид: журналу нужны знак, причина знака и порог.
 */
export interface SignRuleRecord {
  id: string;
  sign: string;
  categoryId: string;
  categoryTitle: string;
  threshold: number;
  isActive: boolean;
}

/** Виды зависимостей, из-за которых справочник или группа не удаляются. */
export type DependencyKind = 'assignments' | 'enrollments';

export interface Dependencies {
  assignments: number;
  enrollments: number;
}

export interface AcademicsRepository {
  listStudents(filters: StudentListFilters): Promise<{ items: StudentRecord[]; total: number }>;
  /**
   * Ученики по идентификаторам.
   *
   * Нужен там, где состав уже известен (зачисления группы), а имена надо получить: тянуть
   * весь справочник ради десятка фамилий нельзя — он растёт с каждым учебным годом.
   */
  listStudentsByIds(ids: readonly string[]): Promise<StatisticalStudent[]>;
  findStudent(id: string, executor?: Executor): Promise<StudentRecord | null>;
  /** Ученик по учётной записи: у ролей «ученик» и «родитель» известен её идентификатор. */
  findStudentByUserId(userId: string, executor?: Executor): Promise<StudentRecord | null>;
  /** Удаление карточки ученика: разрешено только без ссылок — проверяет сервис. */
  deleteStudent(id: string, executor?: Executor): Promise<void>;
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
  updateAcademicYear(
    id: string,
    input: { title?: string; startsOn?: string; endsOn?: string },
    executor?: Executor,
  ): Promise<AcademicYearRecord | null>;
  setActiveAcademicYear(id: string, executor?: Executor): Promise<AcademicYearRecord | null>;
  deactivateAcademicYears(excludeId?: string | null, executor?: Executor): Promise<void>;
  deleteAcademicYear(id: string, executor?: Executor): Promise<boolean>;

  listPeriods(academicYearId?: string | undefined): Promise<PeriodRecord[]>;
  findPeriod(id: string, executor?: Executor): Promise<PeriodRecord | null>;
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
  updatePeriod(
    id: string,
    input: { title?: string; kind?: string; startsOn?: string; endsOn?: string },
    executor?: Executor,
  ): Promise<PeriodRecord | null>;
  countPeriods(academicYearId: string, executor?: Executor): Promise<number>;
  deletePeriod(id: string, executor?: Executor): Promise<boolean>;

  listGroups(filters: {
    academicYearId?: string | undefined;
    /** Ограничение конкретными группами: нужно выборкам «мои группы». */
    ids?: readonly string[] | undefined;
    search?: string | undefined;
  }): Promise<StudyGroupRecord[]>;
  findGroup(id: string, executor?: Executor): Promise<StudyGroupRecord | null>;
  insertGroup(
    input: {
      academicYearId: string;
      name: string;
      course: number | null;
      specialty: string | null;
      curatorUserId: string | null;
      startsOn: string;
      endsOn: string;
    },
    executor?: Executor,
  ): Promise<StudyGroupRecord>;
  updateGroup(
    id: string,
    input: {
      name?: string;
      course?: number | null;
      specialty?: string | null;
      curatorUserId?: string | null;
      startsOn?: string;
      endsOn?: string;
    },
    executor?: Executor,
  ): Promise<StudyGroupRecord | null>;
  deleteGroup(id: string, executor?: Executor): Promise<boolean>;
  countGroupDependencies(id: string, executor?: Executor): Promise<Dependencies>;

  listEnrollments(studyGroupId: string, executor?: Executor): Promise<EnrollmentRecord[]>;
  /** Группы текущих зачислений перечисленных учеников: «мои группы» для ученика и родителя. */
  listGroupsForStudents(
    studentIds: readonly string[],
    executor?: Executor,
  ): Promise<{ id: string; name: string }[]>;
  listStudentEnrollments(
    studentId: string,
    executor?: Executor,
  ): Promise<(EnrollmentRecord & { groupStartsOn: string; groupEndsOn: string })[]>;
  findEnrollment(id: string, executor?: Executor): Promise<EnrollmentRecord | null>;
  insertEnrollment(
    input: { studentId: string; studyGroupId: string; joinedOn: string; note: string | null },
    executor?: Executor,
  ): Promise<EnrollmentRecord>;
  closeEnrollment(
    id: string,
    leftOn: string,
    note?: string | undefined,
    executor?: Executor,
  ): Promise<EnrollmentRecord | null>;

  listSubjects(): Promise<SubjectRecord[]>;
  findSubject(id: string, executor?: Executor): Promise<SubjectRecord | null>;
  insertSubject(
    input: { name: string; shortName: string | null; kind: string; color: string | null },
    executor?: Executor,
  ): Promise<SubjectRecord>;
  updateSubject(
    id: string,
    input: { name?: string; shortName?: string | null; kind?: string; color?: string | null },
    executor?: Executor,
  ): Promise<SubjectRecord | null>;
  deleteSubject(id: string, executor?: Executor): Promise<boolean>;

  listRooms(): Promise<RoomRecord[]>;
  findRoom(id: string, executor?: Executor): Promise<RoomRecord | null>;
  insertRoom(
    input: { name: string; capacity: number | null; note: string | null },
    executor?: Executor,
  ): Promise<RoomRecord>;
  updateRoom(
    id: string,
    input: { name?: string; capacity?: number | null; note?: string | null },
    executor?: Executor,
  ): Promise<RoomRecord | null>;
  deleteRoom(id: string, executor?: Executor): Promise<boolean>;

  listGradeCategories(executor?: Executor): Promise<GradeCategoryRecord[]>;
  /** Накопительные знаки: плюсы и точки с порогами. */
  listSignRules(executor?: Executor): Promise<SignRuleRecord[]>;
  findSignRule(sign: string, executor?: Executor): Promise<SignRuleRecord | null>;
  /** Правка причины знака: меняются только порог и выключатель пересчёта. */
  updateSignRule(
    sign: string,
    input: { threshold?: number | undefined; isActive?: boolean | undefined },
    executor?: Executor,
  ): Promise<SignRuleRecord | null>;
  /** Поиск причины по коду: нужен синхронизации справочника «из коробки». */
  findGradeCategoryByCode(code: string, executor?: Executor): Promise<GradeCategoryRecord | null>;
  findGradeCategory(id: string, executor?: Executor): Promise<GradeCategoryRecord | null>;
  insertGradeCategory(
    input: {
      code: string;
      title: string;
      weight: number;
      color: string | null;
      isDefault: boolean;
      /** Заполняется только для накопительных знаков: плюсы и точки. */
      sign?: string | undefined;
      signThreshold?: number | undefined;
      signRuleActive?: boolean | undefined;
    },
    executor?: Executor,
  ): Promise<GradeCategoryRecord>;
  updateGradeCategory(
    id: string,
    input: { title?: string; weight?: number; color?: string | null; isDefault?: boolean },
    executor?: Executor,
  ): Promise<GradeCategoryRecord | null>;
  deleteGradeCategory(id: string, executor?: Executor): Promise<boolean>;
}

/**
 * Приведение строки справочника к накопительному знаку.
 *
 * Порог у знака обязателен по смыслу: без него непонятно, сколько знаков даёт
 * оценку. Строку без порога пропускаем — так повреждённый справочник не сломает
 * пересчёт, а просто не даст правила.
 */
function toSignRule(
  row:
    | {
        id: string;
        sign: string | null;
        categoryId: string;
        categoryTitle: string;
        threshold: number | null;
        isActive: boolean;
      }
    | undefined,
): SignRuleRecord | null {
  if (row === undefined || row.sign === null || row.threshold === null) return null;

  return {
    id: row.id,
    sign: row.sign,
    categoryId: row.categoryId,
    categoryTitle: row.categoryTitle,
    threshold: row.threshold,
    isActive: row.isActive,
  };
}

const EMPTY_DEPENDENCIES: Dependencies = { assignments: 0, enrollments: 0 };

export function createAcademicsRepository(db: Database): AcademicsRepository {
  return {
    async listStudentsByIds(ids) {
      if (ids.length === 0) return [];

      return db.orm
        .select({ id: student.id, fullName: student.fullName })
        .from(student)
        .where(inArray(student.id, [...ids]));
    },

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

    /**
     * Ученик по учётной записи: связь нужна ролям, которые приходят с
     * идентификатором пользователя (ученик, родитель), а не ученика.
     */
    async findStudentByUserId(
      userId: string,
      executor: Executor = db.orm,
    ): Promise<StudentRecord | null> {
      const rows = await executor.select().from(student).where(eq(student.userId, userId)).limit(1);
      return rows[0] ?? null;
    },

    /**
     * Группы по текущим зачислениям учеников.
     *
     * Список учеников приходит снаружи: связь «представитель ↔ ученик» живёт в
     * модуле учётных записей, и сюда её приводит порт, а не прямой запрос через
     * границу модуля (ADR-031).
     */
    async listGroupsForStudents(studentIds: readonly string[], executor: Executor = db.orm) {
      if (studentIds.length === 0) return [];

      const rows = await executor
        .selectDistinct({
          id: studyGroup.id,
          name: studyGroup.name,
        })
        .from(studentEnrollment)
        .innerJoin(studyGroup, eq(studyGroup.id, studentEnrollment.studyGroupId))
        .where(
          and(
            isNull(studentEnrollment.leftOn),
            inArray(studentEnrollment.studentId, [...studentIds]),
          ),
        )
        .orderBy(asc(studyGroup.name));

      return rows;
    },

    async deleteStudent(id, executor: Executor = db.orm): Promise<void> {
      await executor.delete(student).where(eq(student.id, id));
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
      return db.orm.select().from(academicYear).orderBy(desc(academicYear.startsOn));
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

    async updateAcademicYear(
      id,
      input,
      executor: Executor = db.orm,
    ): Promise<AcademicYearRecord | null> {
      const rows = await executor
        .update(academicYear)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(academicYear.id, id))
        .returning();

      return rows[0] ?? null;
    },

    async setActiveAcademicYear(
      id: string,
      executor: Executor = db.orm,
    ): Promise<AcademicYearRecord | null> {
      const rows = await executor
        .update(academicYear)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(academicYear.id, id))
        .returning();

      return rows[0] ?? null;
    },

    async deactivateAcademicYears(
      excludeId: string | null = null,
      executor: Executor = db.orm,
    ): Promise<void> {
      const where =
        excludeId === null
          ? eq(academicYear.isActive, true)
          : and(eq(academicYear.isActive, true), ne(academicYear.id, excludeId));

      await executor.update(academicYear).set({ isActive: false }).where(where);
    },

    async deleteAcademicYear(id: string, executor: Executor = db.orm): Promise<boolean> {
      const rows = await executor
        .delete(academicYear)
        .where(eq(academicYear.id, id))
        .returning({ id: academicYear.id });

      return rows.length > 0;
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

    async findPeriod(id: string, executor: Executor = db.orm): Promise<PeriodRecord | null> {
      const rows = await executor.select().from(period).where(eq(period.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async insertPeriod(input, executor: Executor = db.orm): Promise<PeriodRecord> {
      const rows = await executor.insert(period).values(input).returning();
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать период');
      return created;
    },

    async updatePeriod(id, input, executor: Executor = db.orm): Promise<PeriodRecord | null> {
      const rows = await executor.update(period).set(input).where(eq(period.id, id)).returning();

      return rows[0] ?? null;
    },

    async deletePeriod(id: string, executor: Executor = db.orm): Promise<boolean> {
      const rows = await executor.delete(period).where(eq(period.id, id)).returning();

      return rows.length > 0;
    },

    async countPeriods(academicYearId: string, executor: Executor = db.orm): Promise<number> {
      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(period)
        .where(and(eq(period.academicYearId, academicYearId)));

      return rows[0]?.count ?? 0;
    },

    async listGroups(filters): Promise<StudyGroupRecord[]> {
      const conditions = [
        filters.academicYearId === undefined
          ? undefined
          : eq(studyGroup.academicYearId, filters.academicYearId),
        filters.ids === undefined || filters.ids.length === 0
          ? undefined
          : inArray(studyGroup.id, [...filters.ids]),
        filters.search === undefined || filters.search.trim() === ''
          ? undefined
          : ilike(studyGroup.name, `%${filters.search.trim()}%`),
      ].filter((condition) => condition !== undefined);

      const rows = await db.orm
        .select({
          id: studyGroup.id,
          academicYearId: studyGroup.academicYearId,
          name: studyGroup.name,
          course: studyGroup.course,
          specialty: studyGroup.specialty,
          curatorUserId: studyGroup.curatorUserId,
          startsOn: studyGroup.startsOn,
          endsOn: studyGroup.endsOn,
          studentsCount: sql<number>`count(${studentEnrollment.id})::int`,
        })
        .from(studyGroup)
        .leftJoin(
          studentEnrollment,
          and(eq(studentEnrollment.studyGroupId, studyGroup.id), isNull(studentEnrollment.leftOn)),
        )
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .groupBy(studyGroup.id)
        .orderBy(asc(studyGroup.name));

      return rows;
    },

    async findGroup(id: string, executor: Executor = db.orm): Promise<StudyGroupRecord | null> {
      const rows = await executor
        .select({
          id: studyGroup.id,
          academicYearId: studyGroup.academicYearId,
          name: studyGroup.name,
          course: studyGroup.course,
          specialty: studyGroup.specialty,
          curatorUserId: studyGroup.curatorUserId,
          startsOn: studyGroup.startsOn,
          endsOn: studyGroup.endsOn,
          studentsCount: sql<number>`count(${studentEnrollment.id})::int`,
        })
        .from(studyGroup)
        .leftJoin(
          studentEnrollment,
          and(eq(studentEnrollment.studyGroupId, studyGroup.id), isNull(studentEnrollment.leftOn)),
        )
        .where(eq(studyGroup.id, id))
        .groupBy(studyGroup.id)
        .limit(1);

      return rows[0] ?? null;
    },

    async insertGroup(input, executor: Executor = db.orm): Promise<StudyGroupRecord> {
      const rows = await executor.insert(studyGroup).values(input).returning({
        id: studyGroup.id,
        academicYearId: studyGroup.academicYearId,
        name: studyGroup.name,
        course: studyGroup.course,
        specialty: studyGroup.specialty,
        curatorUserId: studyGroup.curatorUserId,
        startsOn: studyGroup.startsOn,
        endsOn: studyGroup.endsOn,
      });

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать группу');
      return { ...created, studentsCount: 0 };
    },

    async updateGroup(id, input, executor: Executor = db.orm): Promise<StudyGroupRecord | null> {
      const rows = await executor
        .update(studyGroup)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(studyGroup.id, id))
        .returning({
          id: studyGroup.id,
          academicYearId: studyGroup.academicYearId,
          name: studyGroup.name,
          course: studyGroup.course,
          specialty: studyGroup.specialty,
          curatorUserId: studyGroup.curatorUserId,
          startsOn: studyGroup.startsOn,
          endsOn: studyGroup.endsOn,
        });

      const updated = rows[0];
      if (updated === undefined) return null;

      return { ...updated, studentsCount: await countActiveEnrollments(executor, id) };
    },

    async deleteGroup(id: string, executor: Executor = db.orm): Promise<boolean> {
      const rows = await executor
        .delete(studyGroup)
        .where(eq(studyGroup.id, id))
        .returning({ id: studyGroup.id });

      return rows.length > 0;
    },

    countGroupDependencies(id, executor: Executor = db.orm) {
      return countDependencies(executor, { groupId: id });
    },

    async listEnrollments(
      studyGroupId: string,
      executor: Executor = db.orm,
    ): Promise<EnrollmentRecord[]> {
      return executor
        .select({
          id: studentEnrollment.id,
          studentId: studentEnrollment.studentId,
          studyGroupId: studentEnrollment.studyGroupId,
          studentName: student.fullName,
          joinedOn: studentEnrollment.joinedOn,
          leftOn: studentEnrollment.leftOn,
          note: studentEnrollment.note,
        })
        .from(studentEnrollment)
        .innerJoin(student, eq(student.id, studentEnrollment.studentId))
        .where(eq(studentEnrollment.studyGroupId, studyGroupId))
        .orderBy(asc(student.fullName), desc(studentEnrollment.joinedOn));
    },

    async listStudentEnrollments(studentId, executor: Executor = db.orm) {
      return executor
        .select({
          id: studentEnrollment.id,
          studentId: studentEnrollment.studentId,
          studyGroupId: studentEnrollment.studyGroupId,
          studentName: student.fullName,
          joinedOn: studentEnrollment.joinedOn,
          leftOn: studentEnrollment.leftOn,
          note: studentEnrollment.note,
          groupStartsOn: studyGroup.startsOn,
          groupEndsOn: studyGroup.endsOn,
        })
        .from(studentEnrollment)
        .innerJoin(student, eq(student.id, studentEnrollment.studentId))
        .innerJoin(studyGroup, eq(studyGroup.id, studentEnrollment.studyGroupId))
        .where(eq(studentEnrollment.studentId, studentId))
        .orderBy(desc(studentEnrollment.joinedOn));
    },

    async findEnrollment(
      id: string,
      executor: Executor = db.orm,
    ): Promise<EnrollmentRecord | null> {
      const rows = await executor
        .select({
          id: studentEnrollment.id,
          studentId: studentEnrollment.studentId,
          studyGroupId: studentEnrollment.studyGroupId,
          studentName: student.fullName,
          joinedOn: studentEnrollment.joinedOn,
          leftOn: studentEnrollment.leftOn,
          note: studentEnrollment.note,
        })
        .from(studentEnrollment)
        .innerJoin(student, eq(student.id, studentEnrollment.studentId))
        .where(eq(studentEnrollment.id, id))
        .limit(1);

      return rows[0] ?? null;
    },

    async insertEnrollment(input, executor: Executor = db.orm): Promise<EnrollmentRecord> {
      const rows = await executor
        .insert(studentEnrollment)
        .values(input)
        .returning({ id: studentEnrollment.id });

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать зачисление');

      const enrollment = await this.findEnrollment(created.id, executor);
      if (enrollment === null) throw new Error('Не удалось прочитать зачисление');
      return enrollment;
    },

    async closeEnrollment(
      id: string,
      leftOn: string,
      note?: string | undefined,
      executor: Executor = db.orm,
    ): Promise<EnrollmentRecord | null> {
      const rows = await executor
        .update(studentEnrollment)
        // Примечание перезаписываем только когда его передали: иначе причина
        // зачисления потерялась бы при отчислении.
        .set(note === undefined ? { leftOn } : { leftOn, note })
        .where(eq(studentEnrollment.id, id))
        .returning({ id: studentEnrollment.id });

      if (rows.length === 0) return null;
      return this.findEnrollment(id, executor);
    },

    async listSubjects(): Promise<SubjectRecord[]> {
      return db.orm.select().from(subject).orderBy(asc(subject.name));
    },

    async findSubject(id: string, executor: Executor = db.orm): Promise<SubjectRecord | null> {
      const rows = await executor.select().from(subject).where(eq(subject.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async insertSubject(input, executor: Executor = db.orm): Promise<SubjectRecord> {
      const rows = await executor.insert(subject).values(input).returning();
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать предмет');
      return created;
    },

    async updateSubject(id, input, executor: Executor = db.orm): Promise<SubjectRecord | null> {
      const rows = await executor
        .update(subject)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(subject.id, id))
        .returning();

      return rows[0] ?? null;
    },

    async deleteSubject(id: string, executor: Executor = db.orm): Promise<boolean> {
      const rows = await executor
        .delete(subject)
        .where(eq(subject.id, id))
        .returning({ id: subject.id });

      return rows.length > 0;
    },

    async listRooms(): Promise<RoomRecord[]> {
      return db.orm.select().from(room).orderBy(asc(room.name));
    },

    async findRoom(id: string, executor: Executor = db.orm): Promise<RoomRecord | null> {
      const rows = await executor.select().from(room).where(eq(room.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async insertRoom(input, executor: Executor = db.orm): Promise<RoomRecord> {
      const rows = await executor.insert(room).values(input).returning();
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать аудиторию');
      return created;
    },

    async updateRoom(id, input, executor: Executor = db.orm): Promise<RoomRecord | null> {
      const rows = await executor
        .update(room)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(room.id, id))
        .returning();

      return rows[0] ?? null;
    },

    async deleteRoom(id: string, executor: Executor = db.orm): Promise<boolean> {
      const rows = await executor.delete(room).where(eq(room.id, id)).returning({ id: room.id });
      return rows.length > 0;
    },

    async listGradeCategories(executor: Executor = db.orm): Promise<GradeCategoryRecord[]> {
      return executor
        .select()
        .from(gradeCategory)
        .orderBy(desc(gradeCategory.isDefault), asc(gradeCategory.title));
    },

    async findGradeCategoryByCode(code, executor: Executor = db.orm) {
      const rows = await executor
        .select()
        .from(gradeCategory)
        .where(eq(gradeCategory.code, code))
        .limit(1);

      return rows[0] ?? null;
    },

    async findGradeCategory(
      id: string,
      executor: Executor = db.orm,
    ): Promise<GradeCategoryRecord | null> {
      const rows = await executor
        .select()
        .from(gradeCategory)
        .where(eq(gradeCategory.id, id))
        .limit(1);

      return rows[0] ?? null;
    },

    async findSignRule(sign: string, executor: Executor = db.orm): Promise<SignRuleRecord | null> {
      const rows = await executor
        .select({
          id: gradeCategory.id,
          sign: gradeCategory.sign,
          categoryId: gradeCategory.id,
          categoryTitle: gradeCategory.title,
          threshold: gradeCategory.signThreshold,
          isActive: gradeCategory.signRuleActive,
        })
        .from(gradeCategory)
        .where(eq(gradeCategory.sign, sign))
        .limit(1);

      return toSignRule(rows[0]);
    },

    async listSignRules(executor: Executor = db.orm): Promise<SignRuleRecord[]> {
      const rows = await executor
        .select({
          id: gradeCategory.id,
          sign: gradeCategory.sign,
          categoryId: gradeCategory.id,
          categoryTitle: gradeCategory.title,
          threshold: gradeCategory.signThreshold,
          isActive: gradeCategory.signRuleActive,
        })
        .from(gradeCategory)
        .where(isNotNull(gradeCategory.sign))
        .orderBy(asc(gradeCategory.sign));

      return rows
        .map((row) => toSignRule(row))
        .filter((rule): rule is SignRuleRecord => rule !== null);
    },

    async updateSignRule(sign, input, executor: Executor = db.orm) {
      const rows = await executor
        .update(gradeCategory)
        .set({
          ...(input.threshold === undefined ? {} : { signThreshold: input.threshold }),
          ...(input.isActive === undefined ? {} : { signRuleActive: input.isActive }),
          updatedAt: new Date(),
        })
        .where(eq(gradeCategory.sign, sign))
        .returning({
          id: gradeCategory.id,
          sign: gradeCategory.sign,
          categoryId: gradeCategory.id,
          categoryTitle: gradeCategory.title,
          threshold: gradeCategory.signThreshold,
          isActive: gradeCategory.signRuleActive,
        });

      return toSignRule(rows[0]);
    },

    async insertGradeCategory(input, executor: Executor = db.orm): Promise<GradeCategoryRecord> {
      const rows = await executor.insert(gradeCategory).values(input).returning();
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать категорию');
      return created;
    },

    async updateGradeCategory(
      id,
      input,
      executor: Executor = db.orm,
    ): Promise<GradeCategoryRecord | null> {
      const rows = await executor
        .update(gradeCategory)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(gradeCategory.id, id))
        .returning();

      return rows[0] ?? null;
    },

    async deleteGradeCategory(id: string, executor: Executor = db.orm): Promise<boolean> {
      const rows = await executor
        .delete(gradeCategory)
        .where(eq(gradeCategory.id, id))
        .returning({ id: gradeCategory.id });

      return rows.length > 0;
    },
  };

  async function countActiveEnrollments(executor: Executor, groupId: string): Promise<number> {
    const rows = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(studentEnrollment)
      .where(and(eq(studentEnrollment.studyGroupId, groupId), isNull(studentEnrollment.leftOn)));

    return rows[0]?.count ?? 0;
  }
}

/**
 * Считает зависимости, из-за которых удаление запрещено.
 *
 * Ссылки на назначения считает модуль `staffing` — сюда приходит уже готовое
 * число через порт `AssignmentUsagePort` (см. `academics.service.ts`): модуль
 * `academics` не знает о существовании таблицы назначений.
 *
 * Оценки, уроки и домашние задания появятся на Этапах 3–5 и добавятся сюда;
 * независимо от этого БД не даст удалить используемый справочник — внешние
 * ключи объявлены `on delete restrict`.
 */
async function countDependencies(
  executor: Executor,
  filter: { groupId?: string },
): Promise<Dependencies> {
  if (filter.groupId === undefined) {
    return EMPTY_DEPENDENCIES;
  }

  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(studentEnrollment)
    .where(eq(studentEnrollment.studyGroupId, filter.groupId));

  return { assignments: 0, enrollments: rows[0]?.count ?? 0 };
}
