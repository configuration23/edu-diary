import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { gradeCategory } from '../academics';
import {
  attendanceEntry,
  attendanceRevision,
  gradeEntry,
  gradeRevision,
  gradeRule,
  gradeRuleApplication,
} from './journal.schema';

/**
 * Репозиторий журнала: доступ к оценкам, посещаемости, правилам и истории.
 *
 * SQL живёт только здесь (правило архитектуры): сервис журнала работает с
 * записями, а не с запросами.
 */

export interface GradeRecord {
  id: string;
  lessonId: string;
  studentId: string;
  value: string | null;
  sign: string | null;
  categoryId: string | null;
  categoryTitle: string | null;
  categoryWeight: number | null;
  comment: string | null;
  createdAt: Date;
}

export interface AttendanceRecord {
  id: string;
  lessonId: string;
  studentId: string;
  status: string;
  reason: string | null;
  createdAt: Date;
}

export interface RevisionRecord {
  id: string;
  action: string;
  before: string | null;
  after: string | null;
  reason: string | null;
  actorId: string | null;
  createdAt: Date;
}

export interface RuleRecord {
  id: string;
  sign: string;
  threshold: number;
  reward: string;
  categoryId: string | null;
  subjectId: string | null;
  isActive: boolean;
}

export interface JournalRepository {
  /** Оценки урока (без удалённых) с названием и весом категории. */
  listGradesForLesson(lessonId: string, executor?: Executor): Promise<GradeRecord[]>;
  /** Отметки посещаемости урока (без удалённых). */
  listAttendanceForLesson(lessonId: string, executor?: Executor): Promise<AttendanceRecord[]>;
  /** Ученики группы, которые числились в ней на дату урока. */
  listStudentsForGroup(
    studyGroupId: string,
    onDate: string,
    executor?: Executor,
  ): Promise<{ studentId: string; fullName: string }[]>;
  /** Знаки ученика по предмету за период: накопление для правила. */
  listSignsForStudentSubject(
    filter: { studentId: string; subjectId: string; from?: string; to?: string },
    executor?: Executor,
  ): Promise<{ sign: string | null }[]>;
  /**
   * Все знаки группы за период: вход для пересчёта правил.
   *
   * Собираем одним запросом, а не по ученику: на большом заведении разница
   * заметна, а пересчёт запускается по группе целиком.
   */
  listSignsForGroup(
    filter: { studyGroupId: string; from?: string; to?: string },
    executor?: Executor,
  ): Promise<{ studentId: string; subjectId: string; sign: string }[]>;
  /** Числовые оценки ученика по предмету за период: для аналитики. */
  listGradesForStudentSubject(
    filter: { studentId: string; subjectId: string; from?: string; to?: string },
    executor?: Executor,
  ): Promise<GradeRecord[]>;
  /** Все оценки и посещаемость учеников группы за период: для аналитики. */
  listGradesForStudents(
    filter: { studentIds: string[]; subjectId?: string; from?: string; to?: string },
    executor?: Executor,
  ): Promise<GradeRecord[]>;
  listAttendanceForStudents(
    filter: { studentIds: string[]; from?: string; to?: string },
    executor?: Executor,
  ): Promise<AttendanceRecord[]>;

  findGrade(id: string, executor?: Executor): Promise<GradeRecord | null>;
  /** Активная оценка ученика в уроке: заменяется при повторной записи. */
  findGradeForSlot(
    lessonId: string,
    studentId: string,
    executor?: Executor,
  ): Promise<GradeRecord | null>;
  insertGrade(
    input: {
      lessonId: string;
      studentId: string;
      value: string | null;
      sign: string | null;
      categoryId: string | null;
      comment: string | null;
      createdBy: string | null;
    },
    executor?: Executor,
  ): Promise<GradeRecord>;
  updateGrade(
    id: string,
    input: {
      value?: string | null;
      sign?: string | null;
      categoryId?: string | null;
      comment?: string | null;
    },
    executor?: Executor,
  ): Promise<GradeRecord | null>;
  softDeleteGrade(
    id: string,
    input: { reason: string; actorId: string | null },
    executor?: Executor,
  ): Promise<boolean>;
  restoreGrade(id: string, executor?: Executor): Promise<boolean>;

  recordGradeRevision(
    input: {
      gradeEntryId: string;
      action: string;
      before: string | null;
      after: string | null;
      reason: string | null;
      actorId: string | null;
    },
    executor?: Executor,
  ): Promise<void>;
  listGradeRevisions(
    gradeEntryId: string,
    executor?: Executor,
  ): Promise<{ revision: RevisionRecord; actorName: string | null }[]>;

  findAttendanceForSlot(
    lessonId: string,
    studentId: string,
    executor?: Executor,
  ): Promise<AttendanceRecord | null>;
  insertAttendance(
    input: {
      lessonId: string;
      studentId: string;
      status: string;
      reason: string | null;
      createdBy: string | null;
    },
    executor?: Executor,
  ): Promise<AttendanceRecord>;
  updateAttendance(
    id: string,
    input: { status?: string; reason?: string | null },
    executor?: Executor,
  ): Promise<AttendanceRecord | null>;
  recordAttendanceRevision(
    input: {
      attendanceEntryId: string;
      action: string;
      before: string | null;
      after: string | null;
      reason: string | null;
      actorId: string | null;
    },
    executor?: Executor,
  ): Promise<void>;

  /** Правила, действующие для предмета: общие и уточнённые для него. */
  listRulesForSubject(subjectId: string, executor?: Executor): Promise<RuleRecord[]>;
  listRules(executor?: Executor): Promise<RuleRecord[]>;
  /** Сколько раз правило уже сработало у ученика по предмету за период. */
  countApplications(
    filter: { ruleId: string; studentId: string; subjectId: string; periodId: string | null },
    executor?: Executor,
  ): Promise<number>;
  insertApplication(
    input: {
      ruleId: string;
      studentId: string;
      subjectId: string;
      periodId: string | null;
      applicationNumber: number;
      counterValue: number;
      gradeEntryId: string | null;
    },
    executor?: Executor,
  ): Promise<void>;
  /** Учебный период, в который попадает дата: границы счётчика знаков (ADR-009). */
  findPeriodForDate(
    date: string,
    executor?: Executor,
  ): Promise<{ id: string; title: string; startsOn: string; endsOn: string } | null>;
}

/** Строка оценки с подтянутой категорией: единый вид во всех выборках. */
const GRADE_SELECTION = {
  id: gradeEntry.id,
  lessonId: gradeEntry.lessonId,
  studentId: gradeEntry.studentId,
  value: gradeEntry.value,
  sign: gradeEntry.sign,
  categoryId: gradeEntry.categoryId,
  categoryTitle: gradeCategory.title,
  categoryWeight: gradeCategory.weight,
  comment: gradeEntry.comment,
  createdAt: gradeEntry.createdAt,
};

export function createJournalRepository(db: Database): JournalRepository {
  const queryGrades = (executor: Executor) =>
    executor
      .select(GRADE_SELECTION)
      .from(gradeEntry)
      .leftJoin(gradeCategory, eq(gradeCategory.id, gradeEntry.categoryId));

  return {
    async listGradesForLesson(lessonId, executor: Executor = db.orm) {
      return queryGrades(executor)
        .where(and(eq(gradeEntry.lessonId, lessonId), isNull(gradeEntry.deletedAt)))
        .orderBy(asc(gradeEntry.createdAt));
    },

    async listAttendanceForLesson(lessonId, executor: Executor = db.orm) {
      return executor
        .select({
          id: attendanceEntry.id,
          lessonId: attendanceEntry.lessonId,
          studentId: attendanceEntry.studentId,
          status: attendanceEntry.status,
          reason: attendanceEntry.reason,
          createdAt: attendanceEntry.createdAt,
        })
        .from(attendanceEntry)
        .where(and(eq(attendanceEntry.lessonId, lessonId), isNull(attendanceEntry.deletedAt)));
    },

    async listStudentsForGroup(studyGroupId, onDate, executor: Executor = db.orm) {
      /**
       * Состав группы на дату урока: ученик числился, если зачислен не позже и не
       * отчислен раньше. Это важно для журнала: отметки ставятся тем, кто был в
       * группе в тот день, а не текущему составу.
       */
      const rows = await executor.execute(sql`
        select s.id as student_id, s.full_name
        from student_enrollment e
        join student s on s.id = e.student_id
        where e.study_group_id = ${studyGroupId}
          and e.joined_on <= ${onDate}
          and (e.left_on is null or e.left_on >= ${onDate})
        order by s.full_name
      `);

      return (rows as unknown as { student_id: string; full_name: string }[]).map((row) => ({
        studentId: row.student_id,
        fullName: row.full_name,
      }));
    },

    async listSignsForStudentSubject(filter, executor: Executor = db.orm) {
      const conditions = [
        eq(gradeEntry.studentId, filter.studentId),
        isNull(gradeEntry.deletedAt),
        sql`${gradeEntry.sign} is not null`,
        sql`${gradeEntry.lessonId} in (select id from lesson where subject_id = ${filter.subjectId}${
          filter.from === undefined ? sql`` : sql` and lesson_date >= ${filter.from}`
        }${filter.to === undefined ? sql`` : sql` and lesson_date <= ${filter.to}`})`,
      ];

      return executor
        .select({ sign: gradeEntry.sign })
        .from(gradeEntry)
        .where(and(...conditions));
    },

    async listSignsForGroup(filter, executor: Executor = db.orm) {
      const rows = await executor.execute(sql`
        select g.student_id, l.subject_id, g.sign
        from grade_entry g
        join lesson l on l.id = g.lesson_id
        join student_enrollment e on e.student_id = g.student_id and e.study_group_id = l.study_group_id
        where g.deleted_at is null
          and g.sign is not null
          and l.study_group_id = ${filter.studyGroupId}
          and e.joined_on <= l.lesson_date
          and (e.left_on is null or e.left_on >= l.lesson_date)
          ${filter.from === undefined ? sql`` : sql`and l.lesson_date >= ${filter.from}`}
          ${filter.to === undefined ? sql`` : sql`and l.lesson_date <= ${filter.to}`}
      `);

      return (rows as unknown as { student_id: string; subject_id: string; sign: string }[]).map(
        (row) => ({
          studentId: row.student_id,
          subjectId: row.subject_id,
          sign: row.sign,
        }),
      );
    },

    async listGradesForStudentSubject(filter, executor: Executor = db.orm) {
      const conditions = [
        eq(gradeEntry.studentId, filter.studentId),
        isNull(gradeEntry.deletedAt),
        sql`${gradeEntry.lessonId} in (select id from lesson where subject_id = ${filter.subjectId}${
          filter.from === undefined ? sql`` : sql` and lesson_date >= ${filter.from}`
        }${filter.to === undefined ? sql`` : sql` and lesson_date <= ${filter.to}`})`,
      ];

      return queryGrades(executor).where(and(...conditions));
    },

    async listGradesForStudents(filter, executor: Executor = db.orm) {
      if (filter.studentIds.length === 0) return [];

      const conditions = [
        inArray(gradeEntry.studentId, filter.studentIds),
        isNull(gradeEntry.deletedAt),
        sql`${gradeEntry.lessonId} in (select id from lesson where 1 = 1${
          filter.subjectId === undefined ? sql`` : sql` and subject_id = ${filter.subjectId}`
        }${filter.from === undefined ? sql`` : sql` and lesson_date >= ${filter.from}`}${
          filter.to === undefined ? sql`` : sql` and lesson_date <= ${filter.to}`
        })`,
      ];

      return queryGrades(executor).where(and(...conditions));
    },

    async listAttendanceForStudents(filter, executor: Executor = db.orm) {
      if (filter.studentIds.length === 0) return [];

      const conditions = [
        inArray(attendanceEntry.studentId, filter.studentIds),
        isNull(attendanceEntry.deletedAt),
        sql`${attendanceEntry.lessonId} in (select id from lesson where 1 = 1${
          filter.from === undefined ? sql`` : sql` and lesson_date >= ${filter.from}`
        }${filter.to === undefined ? sql`` : sql` and lesson_date <= ${filter.to}`})`,
      ];

      return executor
        .select({
          id: attendanceEntry.id,
          lessonId: attendanceEntry.lessonId,
          studentId: attendanceEntry.studentId,
          status: attendanceEntry.status,
          reason: attendanceEntry.reason,
          createdAt: attendanceEntry.createdAt,
        })
        .from(attendanceEntry)
        .where(and(...conditions));
    },

    async findGrade(id, executor: Executor = db.orm) {
      const rows = await queryGrades(executor).where(eq(gradeEntry.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findGradeForSlot(lessonId, studentId, executor: Executor = db.orm) {
      const rows = await queryGrades(executor)
        .where(
          and(
            eq(gradeEntry.lessonId, lessonId),
            eq(gradeEntry.studentId, studentId),
            isNull(gradeEntry.deletedAt),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async insertGrade(input, executor: Executor = db.orm) {
      const rows = await executor.insert(gradeEntry).values(input).returning({ id: gradeEntry.id });
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось сохранить оценку');

      const saved = await this.findGrade(created.id, executor);
      if (saved === null) throw new Error('Оценка не найдена после создания');
      return saved;
    },

    async updateGrade(id, input, executor: Executor = db.orm) {
      const rows = await executor
        .update(gradeEntry)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(gradeEntry.id, id))
        .returning({ id: gradeEntry.id });

      if (rows.length === 0) return null;
      return this.findGrade(id, executor);
    },

    async softDeleteGrade(id, input, executor: Executor = db.orm) {
      const rows = await executor
        .update(gradeEntry)
        .set({
          deletedAt: new Date(),
          deletedBy: input.actorId,
          deletedReason: input.reason,
          updatedAt: new Date(),
        })
        .where(and(eq(gradeEntry.id, id), isNull(gradeEntry.deletedAt)))
        .returning({ id: gradeEntry.id });

      return rows.length > 0;
    },

    async restoreGrade(id, executor: Executor = db.orm) {
      const rows = await executor
        .update(gradeEntry)
        .set({ deletedAt: null, deletedBy: null, deletedReason: null, updatedAt: new Date() })
        .where(eq(gradeEntry.id, id))
        .returning({ id: gradeEntry.id });

      return rows.length > 0;
    },

    async recordGradeRevision(input, executor: Executor = db.orm) {
      await executor.insert(gradeRevision).values(input);
    },

    async listGradeRevisions(gradeEntryId, executor: Executor = db.orm) {
      const rows = await executor.execute(sql`
        select r.id, r.action, r.before, r.after, r.reason, r.actor_id, r.created_at, u.full_name as actor_name
        from grade_revision r
        left join app_user u on u.id = r.actor_id
        where r.grade_entry_id = ${gradeEntryId}
        order by r.created_at desc
      `);

      return (
        rows as unknown as {
          id: string;
          action: string;
          before: string | null;
          after: string | null;
          reason: string | null;
          actor_id: string | null;
          created_at: Date;
          actor_name: string | null;
        }[]
      ).map((row) => ({
        revision: {
          id: row.id,
          action: row.action,
          before: row.before,
          after: row.after,
          reason: row.reason,
          actorId: row.actor_id,
          createdAt: row.created_at,
        },
        actorName: row.actor_name,
      }));
    },

    async findAttendanceForSlot(lessonId, studentId, executor: Executor = db.orm) {
      const rows = await executor
        .select({
          id: attendanceEntry.id,
          lessonId: attendanceEntry.lessonId,
          studentId: attendanceEntry.studentId,
          status: attendanceEntry.status,
          reason: attendanceEntry.reason,
          createdAt: attendanceEntry.createdAt,
        })
        .from(attendanceEntry)
        .where(
          and(
            eq(attendanceEntry.lessonId, lessonId),
            eq(attendanceEntry.studentId, studentId),
            isNull(attendanceEntry.deletedAt),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async insertAttendance(input, executor: Executor = db.orm) {
      const rows = await executor
        .insert(attendanceEntry)
        .values(input)
        .returning({ id: attendanceEntry.id });
      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось сохранить посещаемость');

      const saved = await this.findAttendanceForSlot(input.lessonId, input.studentId, executor);
      if (saved === null) throw new Error('Посещаемость не найдена после создания');
      return saved;
    },

    async updateAttendance(id, input, executor: Executor = db.orm) {
      const rows = await executor
        .update(attendanceEntry)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(attendanceEntry.id, id))
        .returning({ id: attendanceEntry.id });

      if (rows.length === 0) return null;

      const updated = await executor
        .select({
          id: attendanceEntry.id,
          lessonId: attendanceEntry.lessonId,
          studentId: attendanceEntry.studentId,
          status: attendanceEntry.status,
          reason: attendanceEntry.reason,
          createdAt: attendanceEntry.createdAt,
        })
        .from(attendanceEntry)
        .where(eq(attendanceEntry.id, id))
        .limit(1);

      return updated[0] ?? null;
    },

    async recordAttendanceRevision(input, executor: Executor = db.orm) {
      await executor.insert(attendanceRevision).values({
        attendanceEntryId: input.attendanceEntryId,
        action: input.action,
        before: input.before,
        after: input.after,
        reason: input.reason,
        actorId: input.actorId,
      });
    },

    async listRulesForSubject(subjectId, executor: Executor = db.orm) {
      return executor
        .select()
        .from(gradeRule)
        .where(
          and(
            eq(gradeRule.isActive, true),
            sql`(${gradeRule.subjectId} is null or ${gradeRule.subjectId} = ${subjectId})`,
          ),
        )
        .orderBy(asc(gradeRule.sign));
    },

    async listRules(executor: Executor = db.orm) {
      return executor.select().from(gradeRule).orderBy(asc(gradeRule.sign));
    },

    async countApplications(filter, executor: Executor = db.orm) {
      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(gradeRuleApplication)
        .where(
          and(
            eq(gradeRuleApplication.ruleId, filter.ruleId),
            eq(gradeRuleApplication.studentId, filter.studentId),
            eq(gradeRuleApplication.subjectId, filter.subjectId),
            filter.periodId === null
              ? isNull(gradeRuleApplication.periodId)
              : eq(gradeRuleApplication.periodId, filter.periodId),
          ),
        );

      return rows[0]?.count ?? 0;
    },

    async insertApplication(input, executor: Executor = db.orm) {
      // `onConflictDoNothing` — вторая половина идемпотентности: даже при
      // одновременных пересчётах вторая запись не появится (ADR-010).
      await executor.insert(gradeRuleApplication).values(input).onConflictDoNothing();
    },

    async findPeriodForDate(date, executor: Executor = db.orm) {
      const rows = await executor.execute(sql`
        select id, title, starts_on, ends_on from period
        where starts_on <= ${date} and ends_on >= ${date}
        order by starts_on desc
        limit 1
      `);

      const row = (
        rows as unknown as { id: string; title: string; starts_on: string; ends_on: string }[]
      )[0];
      return row === undefined
        ? null
        : { id: row.id, title: row.title, startsOn: row.starts_on, endsOn: row.ends_on };
    },
  };
}
