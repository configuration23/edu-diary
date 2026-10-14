import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { gradeCategory } from '../academics';
import { attendanceEntry, attendanceRevision, gradeEntry, gradeRevision } from './journal.schema';

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
  categoryCode: string | null;
  categoryTitle: string | null;
  categoryWeight: number | null;
  comment: string | null;
  /** Оценка, оплатившая этот знак пересчётом. 
ull — знак свободен. */
  consumedByGradeId: string | null;
  createdAt: Date;
}

export interface AttendanceRecord {
  id: string;
  lessonId: string;
  studentId: string;
  status: string;
  isExcused: boolean;
  reason: string | null;
  /**
   * Когда отметку убрали. `null` — отметка действует.
   *
   * Поле нужно восстановлению: без него не отличить действующую отметку от
   * удалённой, и можно вернуть вторую на того же ученика.
   */
  deletedAt: Date | null;
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

/**
 * Удалённая отметка: видно, что убрали, кто и почему.
 *
 * Такие строки остаются в базе (ADR-011), но в журнал не попадают: их место — в
 * списке удалённого, откуда администратор может вернуть отметку.
 */
export interface DeletedGradeRecord {
  id: string;
  studentId: string;
  studentName: string;
  value: string | null;
  sign: string | null;
  categoryTitle: string | null;
  deletedAt: Date;
  deletedReason: string | null;
  deletedByName: string | null;
}

export interface DeletedAttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  status: string;
  isExcused: boolean;
  reason: string | null;
  deletedAt: Date;
  deletedReason: string | null;
  deletedByName: string | null;
}

/** Накопленный знак: пересчёт съедает знаки и помечает их оплатившей оценкой. */
export interface SignRecord {
  id: string;
  studentId: string;
  subjectId: string;
  sign: string;
  /** Дата урока, на котором поставлен знак: по ней идёт порядок и дата оценки. */
  lessonDate: string;
  lessonId: string;
  /** Причина знака: она попадает в аудит при съедании. */
  categoryTitle: string | null;
  /** Оценка, которая уже оплатила этот знак. `null` — знак свободен. */
  consumedByGradeId: string | null;
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
  /** Имя ученика: отчёту аналитики нужен читаемый заголовок строки. */
  findStudentName(studentId: string, executor?: Executor): Promise<string | null>;

  /** Накопленные знаки ученика по предмету за период: накопление для правила. */
  listSignsForStudentSubject(
    filter: { studentId: string; subjectId: string; from?: string; to?: string },
    executor?: Executor,
  ): Promise<SignRecord[]>;
  /**
   * Все знаки группы за период: вход для пересчёта правил.
   *
   * Собираем одним запросом, а не по ученику: на большом заведении разница
   * заметна, а пересчёт запускается по группе целиком.
   */
  listSignsForGroup(
    filter: { studyGroupId: string; from?: string; to?: string },
    executor?: Executor,
  ): Promise<SignRecord[]>;
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
  /** Причина оценки: проверка существования и веса при выставлении. */
  findGradeCategory(
    id: string,
    executor?: Executor,
  ): Promise<{ id: string; code: string; title: string; weight: number } | null>;
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
  /** Отметка по идентификатору: нужна для правки, удаления и восстановления. */
  findAttendance(id: string, executor?: Executor): Promise<AttendanceRecord | null>;
  softDeleteAttendance(
    id: string,
    input: { reason: string; actorId: string | null },
    executor?: Executor,
  ): Promise<boolean>;
  restoreAttendance(id: string, executor?: Executor): Promise<boolean>;
  /**
   * Удалённые отметки урока: оценки и посещаемость.
   *
   * Без этой выборки восстановление недостижимо — удалённое исчезает из журнала, и
   * администратор не знает, что именно там было.
   */
  listDeletedForLesson(
    lessonId: string,
    executor?: Executor,
  ): Promise<{
    grades: DeletedGradeRecord[];
    attendance: DeletedAttendanceRecord[];
  }>;
  /** История правок отметки посещаемости: кто, когда, было и стало. */
  listAttendanceRevisions(
    attendanceEntryId: string,
    executor?: Executor,
  ): Promise<{ revision: RevisionRecord; actorName: string | null }[]>;
  /**
   * Все отметки посещаемости урока, включая удалённые.
   *
   * Нужны, чтобы при восстановлении не создать вторую отметку на того же ученика:
   * действующая и удалённая строки живут в одной таблице.
   */
  listAttendanceForLessonIncludingDeleted(
    lessonId: string,
    executor?: Executor,
  ): Promise<AttendanceRecord[]>;
  insertAttendance(
    input: {
      lessonId: string;
      studentId: string;
      status: string;
      isExcused: boolean;
      reason: string | null;
      createdBy: string | null;
    },
    executor?: Executor,
  ): Promise<AttendanceRecord>;
  updateAttendance(
    id: string,
    input: { status?: string; isExcused?: boolean; reason?: string | null },
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

  /**
   * Накопленные знаки ученика по предмету: из них собирается счётчик пересчёта.
   *
   * Возвращаем и идентификаторы: съеденный знак нужно пометить оплатившей оценкой.
   */
  listSignsForStudentSubject(
    filter: { studentId: string; subjectId: string; from?: string; to?: string },
    executor?: Executor,
  ): Promise<SignRecord[]>;
  listSignsForGroup(
    filter: { studyGroupId: string; from?: string; to?: string },
    executor?: Executor,
  ): Promise<SignRecord[]>;
  /** Ещё не съеденные знаки учеников группы: материал для пересчёта по правилам. */
  listPendingSignsForGroup(
    filter: { studyGroupId: string; subjectId?: string; from?: string; to?: string },
    executor?: Executor,
  ): Promise<SignRecord[]>;
  /** Пометить знаки съеденными: их оплатила оценка `gradeId`. */
  markSignsConsumed(
    input: { signIds: string[]; gradeId: string; actorId: string | null },
    executor?: Executor,
  ): Promise<number>;
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
  categoryCode: gradeCategory.code,
  categoryTitle: gradeCategory.title,
  categoryWeight: gradeCategory.weight,
  comment: gradeEntry.comment,
  consumedByGradeId: gradeEntry.consumedByGradeId,
  createdAt: gradeEntry.createdAt,
};

export function createJournalRepository(db: Database): JournalRepository {
  const queryGrades = (executor: Executor) =>
    executor
      .select(GRADE_SELECTION)
      .from(gradeEntry)
      .leftJoin(gradeCategory, eq(gradeCategory.id, gradeEntry.categoryId));

  /**
   * Выборка накопленных знаков.
   *
   * Порядок — по дате урока, затем по паре: пересчёт съедает знаки по порядку, и
   * «первый знак» должен быть тем, что поставлен раньше. Ученик и предмет задают
   * счётчик (знаки Пети и знаки Васи — разные), группа нужна пересчёту целиком.
   *
   * `pendingOnly` отсекает уже съеденные знаки: без этого повторный пересчёт
   * посчитал бы их снова.
   */
  const selectSigns = async (
    executor: Executor,
    filter: {
      studentId?: string;
      subjectId?: string;
      studyGroupId?: string;
      from?: string;
      to?: string;
    },
    pendingOnly = false,
  ): Promise<SignRecord[]> => {
    const rows = await executor.execute(sql`
      select
        g.id,
        g.student_id,
        l.subject_id,
        g.sign,
        l.id as lesson_id,
        l.lesson_date,
        c.title as category_title,
        g.consumed_by_grade_id
      from grade_entry g
      join lesson l on l.id = g.lesson_id
      left join grade_category c on c.id = g.category_id
      ${
        filter.studyGroupId === undefined
          ? sql``
          : sql`join student_enrollment e on e.student_id = g.student_id
                and e.study_group_id = l.study_group_id
                and e.joined_on <= l.lesson_date
                and (e.left_on is null or e.left_on >= l.lesson_date)`
      }
      where g.deleted_at is null
        and g.sign is not null
        ${pendingOnly ? sql`and g.consumed_by_grade_id is null` : sql``}
        ${filter.studentId === undefined ? sql`` : sql`and g.student_id = ${filter.studentId}`}
        ${filter.subjectId === undefined ? sql`` : sql`and l.subject_id = ${filter.subjectId}`}
        ${filter.studyGroupId === undefined ? sql`` : sql`and l.study_group_id = ${filter.studyGroupId}`}
        ${filter.from === undefined ? sql`` : sql`and l.lesson_date >= ${filter.from}`}
        ${filter.to === undefined ? sql`` : sql`and l.lesson_date <= ${filter.to}`}
      order by l.lesson_date, l.pair_number, g.created_at
    `);

    return (
      rows as unknown as {
        id: string;
        student_id: string;
        subject_id: string;
        sign: string;
        lesson_id: string;
        lesson_date: string | Date;
        category_title: string | null;
        consumed_by_grade_id: string | null;
      }[]
    ).map((row) => ({
      id: row.id,
      studentId: row.student_id,
      subjectId: row.subject_id,
      sign: row.sign,
      lessonId: row.lesson_id,
      lessonDate:
        row.lesson_date instanceof Date
          ? row.lesson_date.toISOString().slice(0, 10)
          : String(row.lesson_date).slice(0, 10),
      categoryTitle: row.category_title,
      consumedByGradeId: row.consumed_by_grade_id,
    }));
  };

  return {
    async listGradesForLesson(lessonId, executor: Executor = db.orm) {
      return queryGrades(executor)
        .where(
          and(
            eq(gradeEntry.lessonId, lessonId),
            isNull(gradeEntry.deletedAt),
            /**
             * Съеденные знаки в журнале не показываем: пересчёт «плюсы и точки →
             * оценка» уже превратил их в оценку, и рядом с ней они выглядели бы
             * как отметки, которых больше нет. Сами строки остаются в базе — по ним
             * видно, из чего сложилась оценка, и их можно восстановить.
             */
            isNull(gradeEntry.consumedByGradeId),
          ),
        )
        .orderBy(asc(gradeEntry.createdAt));
    },

    async listAttendanceForLesson(lessonId, executor: Executor = db.orm) {
      return executor
        .select({
          id: attendanceEntry.id,
          lessonId: attendanceEntry.lessonId,
          studentId: attendanceEntry.studentId,
          status: attendanceEntry.status,
          isExcused: attendanceEntry.isExcused,
          reason: attendanceEntry.reason,
          deletedAt: attendanceEntry.deletedAt,
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

    async findStudentName(studentId, executor: Executor = db.orm) {
      const rows = await executor.execute(
        sql`select full_name from student where id = ${studentId}`,
      );
      const row = (rows as unknown as { full_name: string }[])[0];
      return row?.full_name ?? null;
    },

    async listSignsForStudentSubject(filter, executor: Executor = db.orm) {
      const rows = await selectSigns(executor, {
        studentId: filter.studentId,
        subjectId: filter.subjectId,
        ...(filter.from === undefined ? {} : { from: filter.from }),
        ...(filter.to === undefined ? {} : { to: filter.to }),
      });

      return rows;
    },

    async listSignsForGroup(filter, executor: Executor = db.orm) {
      const rows = await selectSigns(executor, {
        studyGroupId: filter.studyGroupId,
        ...(filter.from === undefined ? {} : { from: filter.from }),
        ...(filter.to === undefined ? {} : { to: filter.to }),
      });

      return rows;
    },

    async listPendingSignsForGroup(filter, executor: Executor = db.orm) {
      return selectSigns(
        executor,
        {
          studyGroupId: filter.studyGroupId,
          ...(filter.subjectId === undefined ? {} : { subjectId: filter.subjectId }),
          ...(filter.from === undefined ? {} : { from: filter.from }),
          ...(filter.to === undefined ? {} : { to: filter.to }),
        },
        true,
      );
    },

    async markSignsConsumed(input, executor: Executor = db.orm) {
      if (input.signIds.length === 0) return 0;

      const updated = await executor
        .update(gradeEntry)
        .set({
          consumedByGradeId: input.gradeId,
          consumedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(gradeEntry.id, input.signIds))
        .returning({ id: gradeEntry.id });

      return updated.length;
    },

    async listGradesForStudentSubject(filter, executor: Executor = db.orm) {
      const conditions = [
        eq(gradeEntry.studentId, filter.studentId),
        isNull(gradeEntry.deletedAt),
        // Съеденные знаки уже стали оценкой: в аналитике они не отметки.
        isNull(gradeEntry.consumedByGradeId),
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
        // Съеденные знаки уже стали оценкой: в аналитике они не отметки.
        isNull(gradeEntry.consumedByGradeId),
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
          isExcused: attendanceEntry.isExcused,
          reason: attendanceEntry.reason,
          deletedAt: attendanceEntry.deletedAt,
          createdAt: attendanceEntry.createdAt,
        })
        .from(attendanceEntry)
        .where(and(...conditions));
    },

    async findGrade(id, executor: Executor = db.orm) {
      const rows = await queryGrades(executor).where(eq(gradeEntry.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findGradeCategory(id, executor: Executor = db.orm) {
      const rows = await executor
        .select({
          id: gradeCategory.id,
          code: gradeCategory.code,
          title: gradeCategory.title,
          weight: gradeCategory.weight,
        })
        .from(gradeCategory)
        .where(eq(gradeCategory.id, id))
        .limit(1);

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
          isExcused: attendanceEntry.isExcused,
          reason: attendanceEntry.reason,
          deletedAt: attendanceEntry.deletedAt,
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

    async findAttendance(id, executor: Executor = db.orm) {
      const rows = await executor
        .select({
          id: attendanceEntry.id,
          lessonId: attendanceEntry.lessonId,
          studentId: attendanceEntry.studentId,
          status: attendanceEntry.status,
          isExcused: attendanceEntry.isExcused,
          reason: attendanceEntry.reason,
          deletedAt: attendanceEntry.deletedAt,
          createdAt: attendanceEntry.createdAt,
        })
        .from(attendanceEntry)
        .where(eq(attendanceEntry.id, id))
        .limit(1);

      return rows[0] ?? null;
    },

    async softDeleteAttendance(id, input, executor: Executor = db.orm) {
      const rows = await executor
        .update(attendanceEntry)
        .set({
          deletedAt: new Date(),
          deletedBy: input.actorId,
          deletedReason: input.reason,
          updatedAt: new Date(),
        })
        .where(and(eq(attendanceEntry.id, id), isNull(attendanceEntry.deletedAt)))
        .returning({ id: attendanceEntry.id });

      return rows.length > 0;
    },

    async restoreAttendance(id, executor: Executor = db.orm) {
      const rows = await executor
        .update(attendanceEntry)
        .set({ deletedAt: null, deletedBy: null, deletedReason: null, updatedAt: new Date() })
        .where(eq(attendanceEntry.id, id))
        .returning({ id: attendanceEntry.id });

      return rows.length > 0;
    },

    async listDeletedForLesson(lessonId, executor: Executor = db.orm) {
      /**
       * Удалённые отметки урока: оценки и посещаемость вместе.
       *
       * Без этой выборки восстановление недостижимо: удалённое просто исчезает из
       * журнала, и администратор не знает, что там было. Показываем и причину
       * удаления, и кто удалил — иначе восстановление будет вслепую.
       */
      const grades = await executor.execute(sql`
        select
          g.id,
          'grade' as kind,
          g.student_id,
          s.full_name as student_name,
          g.value,
          g.sign,
          g.deleted_at,
          g.deleted_reason,
          u.full_name as deleted_by_name,
          c.title as category_title
        from grade_entry g
        join student s on s.id = g.student_id
        left join app_user u on u.id = g.deleted_by
        left join grade_category c on c.id = g.category_id
        where g.lesson_id = ${lessonId} and g.deleted_at is not null
      `);

      const attendance = await executor.execute(sql`
        select
          a.id,
          'attendance' as kind,
          a.student_id,
          s.full_name as student_name,
          a.status,
          a.is_excused,
          a.reason,
          a.deleted_at,
          a.deleted_reason,
          u.full_name as deleted_by_name
        from attendance_entry a
        join student s on s.id = a.student_id
        left join app_user u on u.id = a.deleted_by
        where a.lesson_id = ${lessonId} and a.deleted_at is not null
      `);

      return {
        grades: (
          grades as unknown as {
            id: string;
            student_id: string;
            student_name: string;
            value: string | null;
            sign: string | null;
            deleted_at: Date;
            deleted_reason: string | null;
            deleted_by_name: string | null;
            category_title: string | null;
          }[]
        ).map((row) => ({
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          value: row.value,
          sign: row.sign,
          categoryTitle: row.category_title,
          deletedAt: row.deleted_at,
          deletedReason: row.deleted_reason,
          deletedByName: row.deleted_by_name,
        })),
        attendance: (
          attendance as unknown as {
            id: string;
            student_id: string;
            student_name: string;
            status: string;
            is_excused: boolean;
            reason: string | null;
            deleted_at: Date;
            deleted_reason: string | null;
            deleted_by_name: string | null;
          }[]
        ).map((row) => ({
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          status: row.status,
          isExcused: row.is_excused,
          reason: row.reason,
          deletedAt: row.deleted_at,
          deletedReason: row.deleted_reason,
          deletedByName: row.deleted_by_name,
        })),
      };
    },

    async listAttendanceForLessonIncludingDeleted(lessonId, executor: Executor = db.orm) {
      const rows = await executor
        .select({
          id: attendanceEntry.id,
          lessonId: attendanceEntry.lessonId,
          studentId: attendanceEntry.studentId,
          status: attendanceEntry.status,
          isExcused: attendanceEntry.isExcused,
          reason: attendanceEntry.reason,
          deletedAt: attendanceEntry.deletedAt,
          createdAt: attendanceEntry.createdAt,
        })
        .from(attendanceEntry)
        .where(eq(attendanceEntry.lessonId, lessonId));

      return rows;
    },

    async listAttendanceRevisions(attendanceEntryId, executor: Executor = db.orm) {
      const rows = await executor.execute(sql`
        select
          r.id, r.action, r.before, r.after, r.reason, r.actor_id, r.created_at,
          u.full_name as actor_name
        from attendance_revision r
        left join app_user u on u.id = r.actor_id
        where r.attendance_entry_id = ${attendanceEntryId}
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
          isExcused: attendanceEntry.isExcused,
          reason: attendanceEntry.reason,
          deletedAt: attendanceEntry.deletedAt,
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
