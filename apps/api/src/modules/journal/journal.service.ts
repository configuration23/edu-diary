import {
  attendanceBreakdown,
  countSigns,
  escalationState,
  isAttendanceStatus,
  isMarkSign,
  isMarkValue,
  weightedAverage,
  type AttendanceStatus,
  type EscalationRule,
  type MarkSign,
} from '@edu-diary/domain';

import type { AuditActor } from '../../shared/actor';
import type { Database, Executor } from '../../shared/db/client';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { AuditService } from '../audit';
import type {
  AttendanceRecord,
  GradeRecord,
  JournalRepository,
  RuleRecord,
} from './journal.repository';

/**
 * Журнал: оценки, знаки и посещаемость (Этап 4).
 *
 * Правила, за которыми следит сервис:
 * - отметки ставятся только на существующий урок и в рамках своего назначения —
 *   иначе оценку можно «повесить» на чужой предмет (ADR-006);
 * - на отменённом уроке отметок нет;
 * - причина обязательна для прогула и уважительной, иначе журнал теряет смысл;
 * - правка и удаление оценки требуют причины и оставляют след в истории (ADR-011);
 * - правило «знаки → оценка» считается по предмету и периоду и не дублируется при
 *   повторном пересчёте (ADR-010).
 */

export interface MutationOptions {
  actor: AuditActor;
  executor?: Executor | undefined;
}

/** Урок, к которому применяется журнал: проверяется через порт расписания. */
export interface JournalLesson {
  id: string;
  lessonDate: string;
  pairNumber: number;
  timeStart: string;
  timeEnd: string;
  studyGroupId: string;
  groupName: string;
  subjectId: string;
  subjectName: string;
  teacherUserId: string;
  teacherName: string;
  topic: string | null;
  status: string;
}

export interface ScheduleLookupPort {
  findLesson(id: string): Promise<JournalLesson | null>;
  /** Группы, доступные смотрящему: ученику — где учится, родителю — его дети. */
  groupsOfViewer(userId: string): Promise<string[]>;
  /** Ученик по учётной записи: проверка «своих» данных. */
  studentIdOfUser(userId: string): Promise<string | null>;
  /** Ученики, доступные родителю. */
  studentIdsOfGuardian(userId: string): Promise<string[]>;
}

export interface JournalService {
  /** Экран урока: состав группы, отметки и накопление знаков. */
  lessonJournal(
    lessonId: string,
    viewer: { userId: string; seesAll: boolean },
  ): Promise<{
    lesson: JournalLesson;
    students: {
      studentId: string;
      fullName: string;
      grade: GradeRecord | null;
      attendance: AttendanceRecord | null;
      signs: { plus: number; dot: number; plusRemaining: number; dotRemaining: number };
    }[];
    rules: { sign: string; threshold: number; reward: string; applied: number }[];
  }>;
  saveGrade(
    lessonId: string,
    input: {
      studentId: string;
      value?: string | null;
      sign?: string | null;
      categoryId?: string | null;
      comment?: string | null;
    },
    options: MutationOptions,
  ): Promise<GradeRecord>;
  updateGrade(
    gradeId: string,
    input: {
      value?: string | null;
      sign?: string | null;
      categoryId?: string | null;
      comment?: string | null;
      reason: string;
    },
    options: MutationOptions,
  ): Promise<GradeRecord>;
  deleteGrade(gradeId: string, reason: string, options: MutationOptions): Promise<void>;
  restoreGrade(gradeId: string, options: MutationOptions): Promise<void>;
  listGradeRevisions(gradeId: string): Promise<
    {
      action: string;
      before: string | null;
      after: string | null;
      reason: string | null;
      actorName: string | null;
      createdAt: Date;
    }[]
  >;
  saveAttendance(
    lessonId: string,
    input: { studentId: string; status: string; reason?: string | null },
    options: MutationOptions,
  ): Promise<AttendanceRecord>;
  markAllPresent(
    lessonId: string,
    input: { exceptStudentIds?: string[] },
    options: MutationOptions,
  ): Promise<{ marked: number }>;
  /** Пересчёт правил: возвращает, сколько оценок выдано этим запуском. */
  applyRules(
    filter: { studyGroupId?: string; subjectId?: string; from?: string; to?: string },
    options: MutationOptions,
  ): Promise<{ awarded: number }>;
  stats(filter: {
    studentIds: string[];
    subjectId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }): Promise<
    {
      studentId: string;
      average: number | null;
      gradesCount: number;
      attendancePercent: number;
      attendance: ReturnType<typeof attendanceBreakdown>;
    }[]
  >;
}

export interface JournalServiceDependencies {
  db: Database;
  journal: JournalRepository;
  audit: AuditService;
  schedule: ScheduleLookupPort;
}

/** Подпись отметки для истории правок: «5», «+», «.» или «—». */
function describeMark(value: string | null, sign: string | null): string {
  if (value !== null) return value;
  if (sign === 'plus') return '+';
  if (sign === 'dot') return '.';
  return '—';
}

export function createJournalService(dependencies: JournalServiceDependencies): JournalService {
  const { db, journal, audit, schedule } = dependencies;

  /** Урок с проверкой области действия: чужая группа отвечает `404`. */
  const requireLessonForViewer = async (
    lessonId: string,
    viewer: { userId: string; seesAll: boolean },
  ) => {
    const lesson = await schedule.findLesson(lessonId);
    if (lesson === null) throw new AppError('NOT_FOUND', 'Урок не найден');

    // Сотрудник видит любой урок: его доступ ограничен правами, а не составом
    // группы. Ученику и родителю остаётся проверка «свой ли это урок».
    if (viewer.seesAll) return lesson;

    const ownGroups = await schedule.groupsOfViewer(viewer.userId);
    if (!ownGroups.includes(lesson.studyGroupId)) {
      throw new AppError('NOT_FOUND', 'Урок не найден');
    }

    return lesson;
  };

  const requireLesson = async (lessonId: string): Promise<JournalLesson> => {
    const lesson = await schedule.findLesson(lessonId);
    if (lesson === null) throw new AppError('NOT_FOUND', 'Урок не найден');
    return lesson;
  };

  /** Отметки на отменённом уроке не ставим: занятие не состоялось. */
  const assertLessonActive = (lesson: JournalLesson): void => {
    if (lesson.status === 'cancelled') {
      throw new AppError('CONFLICT', 'Урок отменён: ставить отметки нельзя', {
        details: { reason: 'lesson_cancelled' },
      });
    }
  };

  const assertSignOrValue = (value: string | null, sign: string | null): void => {
    if (value !== null && sign !== null) {
      throw new AppError('VALIDATION_FAILED', 'Одновременно оценка и знак не ставятся');
    }
    if (value === null && sign === null) {
      throw new AppError('VALIDATION_FAILED', 'Нужна оценка или знак');
    }
    if (value !== null && !isMarkValue(value)) {
      throw new AppError('VALIDATION_FAILED', 'Оценка должна быть числом от 2 до 5');
    }
    if (sign !== null && !isMarkSign(sign)) {
      throw new AppError('VALIDATION_FAILED', 'Знак может быть «плюсом» или «точкой»');
    }
  };

  /** Причина обязательна для отсутствия: «прогул» без причины — не запись. */
  const assertReason = (status: AttendanceStatus, reason: string | null): void => {
    if (
      (status === 'absent' || status === 'excused') &&
      (reason === null || reason.trim() === '')
    ) {
      throw new AppError('VALIDATION_FAILED', 'Для прогула и уважительной причины нужна причина', {
        details: { reason: 'reason_required' },
      });
    }
  };

  const ruleOf = (rule: RuleRecord): EscalationRule => ({
    sign: rule.sign as MarkSign,
    threshold: rule.threshold,
    reward: rule.reward as EscalationRule['reward'],
  });

  return {
    async lessonJournal(lessonId, viewer) {
      const lesson = await requireLessonForViewer(lessonId, viewer);

      const [students, grades, attendance, rules] = await Promise.all([
        journal.listStudentsForGroup(lesson.studyGroupId, lesson.lessonDate),
        journal.listGradesForLesson(lessonId),
        journal.listAttendanceForLesson(lessonId),
        journal.listRulesForSubject(lesson.subjectId),
      ]);

      const period = await journal.findPeriodForDate(lesson.lessonDate);
      const gradeByStudent = new Map(grades.map((grade) => [grade.studentId, grade]));
      const attendanceByStudent = new Map(attendance.map((mark) => [mark.studentId, mark]));

      /**
       * Знаки считаем за учебный период (ADR-009): с новым периодом накопление
       * начинается заново, «4 плюса» не растягиваются на весь год.
       */
      const result = [];
      for (const student of students) {
        const signs = await journal.listSignsForStudentSubject({
          studentId: student.studentId,
          subjectId: lesson.subjectId,
          ...(period === null ? {} : { from: period.startsOn, to: period.endsOn }),
        });
        const counts = countSigns(signs as { sign: MarkSign | null }[]);

        const plusRule = rules.find((rule) => rule.sign === 'plus');
        const dotRule = rules.find((rule) => rule.sign === 'dot');

        result.push({
          studentId: student.studentId,
          fullName: student.fullName,
          grade: gradeByStudent.get(student.studentId) ?? null,
          attendance: attendanceByStudent.get(student.studentId) ?? null,
          signs: {
            plus: counts.plus,
            dot: counts.dot,
            plusRemaining:
              plusRule === undefined ? 0 : escalationState(counts, ruleOf(plusRule)).remaining,
            dotRemaining:
              dotRule === undefined ? 0 : escalationState(counts, ruleOf(dotRule)).remaining,
          },
        });
      }

      // Сколько раз правило уже сработало у каждого ученика: показываем в интерфейсе,
      // чтобы преподаватель видел, что оценка выдана именно правилом (ADR-010).
      const appliedRules = [];
      for (const rule of rules) {
        let applied = 0;
        for (const student of students) {
          applied += await journal.countApplications({
            ruleId: rule.id,
            studentId: student.studentId,
            subjectId: lesson.subjectId,
            periodId: period?.id ?? null,
          });
        }

        appliedRules.push({
          sign: rule.sign,
          threshold: rule.threshold,
          reward: rule.reward,
          applied,
        });
      }

      return { lesson, students: result, rules: appliedRules };
    },

    async saveGrade(lessonId, input, options) {
      const lesson = await requireLesson(lessonId);
      assertLessonActive(lesson);

      const value = input.value ?? null;
      const sign = input.sign ?? null;
      assertSignOrValue(value, sign);

      return withTransaction(db, options.executor, async (tx) => {
        const existing = await journal.findGradeForSlot(lessonId, input.studentId, tx);

        /**
         * Повторная запись в тот же слот заменяет прежнюю отметку: в журнале урока
         * у ученика должна быть одна оценка. Прежняя уходит в мягкое удаление, а в
         * историю пишется причина замены — иначе след теряется.
         */
        if (existing !== null) {
          await journal.softDeleteGrade(
            existing.id,
            { reason: 'Заменено новой отметкой', actorId: options.actor.userId },
            tx,
          );
          await journal.recordGradeRevision(
            {
              gradeEntryId: existing.id,
              action: 'delete',
              before: describeMark(existing.value, existing.sign),
              after: null,
              reason: 'Заменено новой отметкой',
              actorId: options.actor.userId,
            },
            tx,
          );
        }

        const created = await journal.insertGrade(
          {
            lessonId,
            studentId: input.studentId,
            value,
            sign,
            categoryId: input.categoryId ?? null,
            comment: input.comment ?? null,
            createdBy: options.actor.userId,
          },
          tx,
        );

        await journal.recordGradeRevision(
          {
            gradeEntryId: created.id,
            action: 'create',
            before: null,
            after: describeMark(value, sign),
            reason: null,
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'grade_entry',
            entityId: created.id,
            after: {
              lessonId,
              studentId: input.studentId,
              mark: describeMark(value, sign),
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async updateGrade(gradeId, input, options) {
      const current = await journal.findGrade(gradeId);
      if (current === null) throw new AppError('NOT_FOUND', 'Оценка не найдена');

      const value = input.value === undefined ? current.value : input.value;
      const sign = input.sign === undefined ? current.sign : input.sign;
      assertSignOrValue(value, sign);

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await journal.updateGrade(
          gradeId,
          {
            ...(input.value === undefined ? {} : { value: input.value }),
            ...(input.sign === undefined ? {} : { sign: input.sign }),
            ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
            ...(input.comment === undefined ? {} : { comment: input.comment }),
          },
          tx,
        );

        if (updated === null) throw new AppError('NOT_FOUND', 'Оценка не найдена');

        await journal.recordGradeRevision(
          {
            gradeEntryId: gradeId,
            action: 'update',
            before: describeMark(current.value, current.sign),
            after: describeMark(updated.value, updated.sign),
            reason: input.reason,
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'update',
            entityKind: 'grade_entry',
            entityId: gradeId,
            before: { mark: describeMark(current.value, current.sign) },
            after: { mark: describeMark(updated.value, updated.sign), reason: input.reason },
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deleteGrade(gradeId, reason, options) {
      const current = await journal.findGrade(gradeId);
      if (current === null) throw new AppError('NOT_FOUND', 'Оценка не найдена');

      await withTransaction(db, options.executor, async (tx) => {
        const removed = await journal.softDeleteGrade(
          gradeId,
          { reason, actorId: options.actor.userId },
          tx,
        );

        if (!removed) throw new AppError('NOT_FOUND', 'Оценка не найдена');

        await journal.recordGradeRevision(
          {
            gradeEntryId: gradeId,
            action: 'delete',
            before: describeMark(current.value, current.sign),
            after: null,
            reason,
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'delete',
            entityKind: 'grade_entry',
            entityId: gradeId,
            before: { mark: describeMark(current.value, current.sign), reason },
          },
          options.actor,
          tx,
        );
      });
    },

    async restoreGrade(gradeId, options) {
      const current = await journal.findGrade(gradeId);
      if (current === null) throw new AppError('NOT_FOUND', 'Оценка не найдена');

      await withTransaction(db, options.executor, async (tx) => {
        await journal.restoreGrade(gradeId, tx);
        await journal.recordGradeRevision(
          {
            gradeEntryId: gradeId,
            action: 'restore',
            before: null,
            after: describeMark(current.value, current.sign),
            reason: 'Восстановлено администратором',
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'restore',
            entityKind: 'grade_entry',
            entityId: gradeId,
            after: { mark: describeMark(current.value, current.sign) },
          },
          options.actor,
          tx,
        );
      });
    },

    async listGradeRevisions(gradeId) {
      const rows = await journal.listGradeRevisions(gradeId);
      return rows.map((row) => ({
        action: row.revision.action,
        before: row.revision.before,
        after: row.revision.after,
        reason: row.revision.reason,
        actorName: row.actorName,
        createdAt: row.revision.createdAt,
      }));
    },

    async saveAttendance(lessonId, input, options) {
      const lesson = await requireLesson(lessonId);
      assertLessonActive(lesson);

      if (!isAttendanceStatus(input.status)) {
        throw new AppError('VALIDATION_FAILED', 'Неизвестный статус посещаемости');
      }

      const reason = input.reason ?? null;
      assertReason(input.status, reason);

      return withTransaction(db, options.executor, async (tx) => {
        const existing = await journal.findAttendanceForSlot(lessonId, input.studentId, tx);

        if (existing !== null) {
          const updated = await journal.updateAttendance(
            existing.id,
            { status: input.status, reason },
            tx,
          );
          if (updated === null) throw new AppError('NOT_FOUND', 'Отметка не найдена');

          await journal.recordAttendanceRevision(
            {
              attendanceEntryId: existing.id,
              action: 'update',
              before: existing.status,
              after: input.status,
              reason,
              actorId: options.actor.userId,
            },
            tx,
          );

          await audit.record(
            {
              action: 'update',
              entityKind: 'attendance_entry',
              entityId: existing.id,
              before: { status: existing.status },
              after: { status: input.status, reason },
            },
            options.actor,
            tx,
          );

          return updated;
        }

        const created = await journal.insertAttendance(
          {
            lessonId,
            studentId: input.studentId,
            status: input.status,
            reason,
            createdBy: options.actor.userId,
          },
          tx,
        );

        await journal.recordAttendanceRevision(
          {
            attendanceEntryId: created.id,
            action: 'create',
            before: null,
            after: input.status,
            reason,
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'attendance_entry',
            entityId: created.id,
            after: { lessonId, studentId: input.studentId, status: input.status },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async markAllPresent(lessonId, input, options) {
      const lesson = await requireLesson(lessonId);
      assertLessonActive(lesson);

      const except = new Set(input.exceptStudentIds ?? []);
      const students = await journal.listStudentsForGroup(lesson.studyGroupId, lesson.lessonDate);

      let marked = 0;
      for (const student of students) {
        if (except.has(student.studentId)) continue;

        await this.saveAttendance(
          lessonId,
          { studentId: student.studentId, status: 'present' },
          options,
        );
        marked += 1;
      }

      return { marked };
    },

    async applyRules(filter, _options) {
      if (filter.studyGroupId === undefined) {
        throw new AppError('VALIDATION_FAILED', 'Пересчёт правил выполняется по группе');
      }

      const rules = await journal.listRules();
      if (rules.length === 0) return { awarded: 0 };

      /**
       * Считаем по группе: одним запросом собираем все знаки, дальше группируем по
       * ученику и предмету. Счётчик — внутри учебного периода (ADR-009), иначе
       * «4 плюса» тянулись бы через весь год.
       */
      const signs = await journal.listSignsForGroup({
        studyGroupId: filter.studyGroupId,
        ...(filter.from === undefined ? {} : { from: filter.from }),
        ...(filter.to === undefined ? {} : { to: filter.to }),
      });

      const grouped = new Map<
        string,
        { studentId: string; subjectId: string; plus: number; dot: number }
      >();
      for (const sign of signs) {
        const key = `${sign.studentId}:${sign.subjectId}`;
        const current = grouped.get(key) ?? {
          studentId: sign.studentId,
          subjectId: sign.subjectId,
          plus: 0,
          dot: 0,
        };

        if (sign.sign === 'plus') current.plus += 1;
        else current.dot += 1;

        grouped.set(key, current);
      }

      let awarded = 0;

      for (const group of grouped.values()) {
        if (filter.subjectId !== undefined && group.subjectId !== filter.subjectId) continue;

        for (const rule of rules) {
          if (rule.subjectId !== null && rule.subjectId !== group.subjectId) continue;
          if (rule.categoryId !== null) continue; // правило категории применяется своим шагом

          const period = await journal.findPeriodForDate(
            filter.from === undefined ? new Date().toISOString().slice(0, 10) : filter.from,
          );

          const state = escalationState({ plus: group.plus, dot: group.dot }, ruleOf(rule));
          const applied = await journal.countApplications({
            ruleId: rule.id,
            studentId: group.studentId,
            subjectId: group.subjectId,
            periodId: period?.id ?? null,
          });

          /**
           * Создаём только недостающие срабатывания. Номер срабатывания входит в
           * уникальный ключ, поэтому одновременный запуск не создаст дубль
           * (ADR-010): повторный пересчёт не меняет ничего.
           */
          for (let number = applied + 1; number <= state.applications; number += 1) {
            await journal.insertApplication({
              ruleId: rule.id,
              studentId: group.studentId,
              subjectId: group.subjectId,
              periodId: period?.id ?? null,
              applicationNumber: number,
              counterValue: group[rule.sign as 'plus' | 'dot'],
              gradeEntryId: null,
            });
            awarded += 1;
          }
        }
      }

      return { awarded };
    },

    async stats(filter) {
      if (filter.studentIds.length === 0) {
        return [];
      }

      const [grades, attendance] = await Promise.all([
        journal.listGradesForStudents({
          studentIds: filter.studentIds,
          ...(filter.subjectId === undefined ? {} : { subjectId: filter.subjectId }),
          ...(filter.from === undefined ? {} : { from: filter.from }),
          ...(filter.to === undefined ? {} : { to: filter.to }),
        }),
        journal.listAttendanceForStudents({
          studentIds: filter.studentIds,
          ...(filter.from === undefined ? {} : { from: filter.from }),
          ...(filter.to === undefined ? {} : { to: filter.to }),
        }),
      ]);

      return filter.studentIds.map((studentId) => {
        const own = grades.filter((grade) => grade.studentId === studentId);
        const marks = attendance.filter((mark) => mark.studentId === studentId);

        return {
          studentId,
          average: weightedAverage(
            own.map((grade) => ({
              value: grade.value ?? '',
              weight: grade.categoryWeight ?? 1,
            })),
          ),
          gradesCount: own.filter((grade) => grade.value !== null).length,
          attendancePercent: attendanceBreakdown(
            marks.map((mark) => ({ status: mark.status as AttendanceStatus })),
          ).percent,
          attendance: attendanceBreakdown(
            marks.map((mark) => ({ status: mark.status as AttendanceStatus })),
          ),
        };
      });
    },
  };
}
