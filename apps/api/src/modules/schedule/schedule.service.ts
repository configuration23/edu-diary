import {
  dayOfWeekOf,
  defaultPairTime,
  isDayOfWeek,
  isPairNumber,
  isValidPairTime,
  weekdayName,
} from '@edu-diary/domain';

import type { Database, Executor } from '../../shared/db/client';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import { withDatabaseErrors } from '../../shared/db/errors';
import type { MutationOptions } from '../academics';
import type { AuditService } from '../audit';
import type {
  LessonRecord,
  ScheduleEntryInput,
  ScheduleEntryRecord,
  ScheduleExceptionRecord,
  ScheduleRepository,
  SubstitutionRecord,
} from './schedule.repository';

/**
 * Расписание и уроки.
 *
 * Правила этапа:
 *  • шаблон ссылается на назначение — предмет, группа и преподаватель берутся из
 *    него, поэтому «чужой» предмет или группа в шаблоне невозможны;
 *  • в группе на одну пару одного дня недели — один шаблон (уникальность в базе);
 *  • преподаватель не может вести две группы в одну пару, аудитория не может быть
 *    занята дважды — проверяется по существующим шаблонам (`ADR-030` закрыт здесь);
 *  • урок порождается из шаблона на дату; повторная генерация не перезаписывает
 *    урок, который правили вручную;
 *  • замена — отдельная сущность (`ADR-009`): на один урок или на диапазон дат.
 */

export interface AssignmentLookup {
  id: string;
  teacherUserId: string;
  subjectId: string;
  studyGroupId: string;
  startsOn: string;
  endsOn: string | null;
  subjectName: string;
  groupName: string;
}

export interface UserLookupPort {
  /** Существование активного пользователя: замена и преподаватель. */
  findActiveUser(userId: string): Promise<{ id: string; fullName: string } | null>;
  /** Пользователь с ролью преподавателя: только он может вести занятие. */
  findActiveTeacher(userId: string): Promise<{ id: string; fullName: string } | null>;
  /** Имена для выдачи: в уроке видно и фактического преподавателя, и заменённого. */
  findUsers(userIds: readonly string[]): Promise<Map<string, string>>;
}

export interface CatalogLookupPort {
  findAssignment(id: string): Promise<AssignmentLookup | null>;
  findRoom(id: string): Promise<{ id: string; name: string } | null>;
  findGroup(id: string): Promise<{ id: string; name: string } | null>;
  /**
   * Группы по идентификаторам; пустой список — «все группы»: так порт
   * используется, когда смотрящий видит всё.
   */
  findGroups(ids: readonly string[]): Promise<{ id: string; name: string }[]>;
  /**
   * Группы, доступные смотрящему: ученику — где он учится, родителю — где
   * учатся его подопечные. Связь «представитель ↔ ученик» живёт в `iam`, поэтому
   * её разрешает порт, а не модуль расписания.
   */
  groupsOfViewer(userId: string): Promise<{ id: string; name: string }[]>;
}

export interface ScheduleService {
  /** Звонки: сетка времени по номеру пары (справочник заведения). */
  listBells(): Promise<
    {
      id: string;
      pairNumber: number;
      timeStart: string;
      timeEnd: string;
      breakMinutes: number | null;
    }[]
  >;
  saveBell(
    input: { pairNumber: number; timeStart: string; timeEnd: string; breakMinutes?: number | null },
    options: MutationOptions,
  ): Promise<{
    id: string;
    pairNumber: number;
    timeStart: string;
    timeEnd: string;
    breakMinutes: number | null;
  }>;
  deleteBell(pairNumber: number, options: MutationOptions): Promise<void>;
  /**
   * Группы, расписание которых доступно смотрящему: администратору и
   * преподавателю — все, ученику и родителю — только свои. Нужно интерфейсу:
   * иначе у роли без права `academics:read@all` список групп пуст, и выбрать
   * расписание нечем.
   */
  listVisibleGroups(viewer: {
    userId: string;
    seesAll: boolean;
  }): Promise<{ id: string; name: string }[]>;

  listEntries(filter: {
    studyGroupId?: string | undefined;
    teacherUserId?: string | undefined;
    studyGroupIds?: readonly string[] | undefined;
  }): Promise<ScheduleEntryRecord[]>;
  getEntry(id: string): Promise<ScheduleEntryRecord>;
  createEntry(
    input: {
      assignmentId: string;
      roomId?: string | null | undefined;
      dayOfWeek: number;
      pairNumber: number;
      /** Если не указано — берётся из звонков по номеру пары. */
      timeStart?: string | undefined;
      timeEnd?: string | undefined;
      validFrom: string;
      validTo?: string | null | undefined;
    },
    options: MutationOptions,
  ): Promise<ScheduleEntryRecord>;
  updateEntry(
    id: string,
    input: {
      roomId?: string | null | undefined;
      dayOfWeek?: number | undefined;
      pairNumber?: number | undefined;
      timeStart?: string | undefined;
      timeEnd?: string | undefined;
      validFrom?: string | undefined;
      validTo?: string | null | undefined;
    },
    options: MutationOptions,
  ): Promise<ScheduleEntryRecord>;
  deleteEntry(id: string, options: MutationOptions): Promise<void>;

  listExceptions(filter: {
    studyGroupId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }): Promise<ScheduleExceptionRecord[]>;
  createException(
    input: {
      scheduleEntryId: string;
      exceptionDate: string;
      action: 'cancel' | 'move' | 'replace';
      payload: Record<string, unknown>;
      reason?: string | undefined;
    },
    options: MutationOptions,
  ): Promise<ScheduleExceptionRecord>;
  deleteException(id: string, options: MutationOptions): Promise<void>;

  listLessons(filter: {
    studyGroupId?: string | undefined;
    teacherUserId?: string | undefined;
    studyGroupIds?: readonly string[] | undefined;
    from?: string | undefined;
    to?: string | undefined;
    status?: string | undefined;
    substitutedOnly?: boolean | undefined;
    limit: number;
    offset: number;
  }): Promise<{ items: LessonRecord[]; total: number }>;
  getLesson(id: string): Promise<LessonRecord>;
  updateLesson(
    id: string,
    input: {
      topic?: string | null | undefined;
      lessonType?: string | null | undefined;
      roomId?: string | null | undefined;
      lessonDate?: string | undefined;
      pairNumber?: number | undefined;
      timeStart?: string | undefined;
      timeEnd?: string | undefined;
      status?: string | undefined;
    },
    options: MutationOptions,
  ): Promise<LessonRecord>;
  deleteLesson(id: string, options: MutationOptions): Promise<void>;
  generateLessons(
    input: { studyGroupId?: string | undefined; from: string; to: string },
    options: MutationOptions,
  ): Promise<{
    created: number;
    updated: number;
    skippedManual: number;
    cancelled: number;
    from: string;
    to: string;
  }>;

  listSubstitutions(filter: {
    lessonId?: string | undefined;
    assignmentId?: string | undefined;
    substituteUserId?: string | undefined;
  }): Promise<SubstitutionRecord[]>;
  createSubstitution(
    input: {
      lessonId?: string | undefined;
      assignmentId?: string | undefined;
      substituteUserId: string;
      startsOn?: string | undefined;
      endsOn?: string | null | undefined;
      reason: string;
    },
    options: MutationOptions,
  ): Promise<SubstitutionRecord>;
  deleteSubstitution(id: string, options: MutationOptions): Promise<void>;
}

export interface ScheduleServiceDependencies {
  db: Database;
  schedule: ScheduleRepository;
  audit: AuditService;
  catalog: CatalogLookupPort;
  users: UserLookupPort;
  /** Сегодняшняя дата: вынесена, чтобы тесты были детерминированными. */
  today?: (() => string) | undefined;
}

export function createScheduleService(dependencies: ScheduleServiceDependencies): ScheduleService {
  const { db, schedule, audit, catalog, users } = dependencies;
  const today = dependencies.today ?? (() => new Date().toISOString().slice(0, 10));

  const requireAssignment = async (id: string): Promise<AssignmentLookup> => {
    const assignment = await catalog.findAssignment(id);
    if (assignment === null) {
      throw new AppError('NOT_FOUND', 'Назначение не найдено');
    }
    return assignment;
  };

  const requireEntry = async (id: string): Promise<ScheduleEntryRecord> => {
    const entry = await schedule.findEntry(id);
    if (entry === null) {
      throw new AppError('NOT_FOUND', 'Занятие расписания не найдено');
    }
    return entry;
  };

  const requireLesson = async (id: string): Promise<LessonRecord> => {
    const lesson = await schedule.findLesson(id);
    if (lesson === null) {
      throw new AppError('NOT_FOUND', 'Урок не найден');
    }
    return lesson;
  };

  /**
   * Проверяет время, день, пару и отсутствие наложений.
   *
   * Наложение — реальная ситуация, а не теория: преподаватель не может вести две
   * группы в одну пару. Проверяется по существующим шаблонам, потому что уроки
   * ещё не порождены.
   */
  const assertSlotFree = async (
    candidate: {
      teacherUserId: string;
      studyGroupId: string;
      roomId: string | null;
      dayOfWeek: number;
      pairNumber: number;
      validFrom: string;
      validTo: string | null;
    },
    exceptEntryId?: string,
  ): Promise<void> => {
    if (!isDayOfWeek(candidate.dayOfWeek)) {
      throw new AppError('VALIDATION_FAILED', 'День недели указан неверно (1–7)');
    }
    if (!isPairNumber(candidate.pairNumber)) {
      throw new AppError('VALIDATION_FAILED', 'Номер пары указан неверно (1–8)');
    }

    const existing = await schedule.listEntries({});

    /**
     * Наложение ищем по существующим шаблонам: у каждого своё место в сетке
     * (день недели и пара) и свой период действия. Совпадение только тогда
     * проблема, когда пересекаются и место, и период.
     */
    const conflictsFor = (resourceId: string, kind: 'teacher' | 'room'): ScheduleEntryRecord[] =>
      existing
        .filter((entry) => entry.id !== exceptEntryId)
        .filter(
          (entry) =>
            entry.dayOfWeek === candidate.dayOfWeek &&
            entry.pairNumber === candidate.pairNumber &&
            (kind === 'teacher' ? entry.teacherUserId : entry.roomId) === resourceId &&
            entry.validFrom <= (candidate.validTo ?? '9999-12-31') &&
            (entry.validTo === null || entry.validTo >= candidate.validFrom),
        );

    const teacherConflict = conflictsFor(candidate.teacherUserId, 'teacher')[0];
    if (teacherConflict !== undefined) {
      throw new AppError(
        'CONFLICT',
        `Преподаватель уже ведёт занятие в это время: «${teacherConflict.groupName}», ${teacherConflict.subjectName} (${weekdayName(candidate.dayOfWeek)}, ${candidate.pairNumber}-я пара)`,
        {
          details: {
            reason: 'teacher_overlap',
            conflictId: teacherConflict.id,
            studyGroupId: teacherConflict.studyGroupId,
          },
        },
      );
    }

    if (candidate.roomId !== null) {
      const roomConflict = conflictsFor(candidate.roomId, 'room')[0];
      if (roomConflict !== undefined) {
        throw new AppError(
          'CONFLICT',
          `Аудитория уже занята в это время: «${roomConflict.groupName}», ${roomConflict.subjectName} (${weekdayName(candidate.dayOfWeek)}, ${candidate.pairNumber}-я пара)`,
          {
            details: {
              reason: 'room_overlap',
              conflictId: roomConflict.id,
              roomId: candidate.roomId,
            },
          },
        );
      }
    }
  };

  const assertTimesValid = (timeStart: string, timeEnd: string): void => {
    if (!isValidPairTime(timeStart, timeEnd)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Время пары указано неверно: нужно ЧЧ:ММ, начало раньше окончания',
      );
    }
  };

  return {
    listBells() {
      return schedule.listBells();
    },

    async listVisibleGroups(viewer) {
      // Преподаватель и администратор видят сетку целиком, поэтому получают все
      // группы; ученик и родитель — только свои.
      if (viewer.seesAll) {
        return catalog.findGroups([]);
      }

      return catalog.groupsOfViewer(viewer.userId);
    },

    async saveBell(input, options) {
      assertTimesValid(input.timeStart, input.timeEnd);

      return withTransaction(db, options.executor, async (tx) => {
        const saved = await schedule.upsertBell(
          {
            pairNumber: input.pairNumber,
            timeStart: input.timeStart,
            timeEnd: input.timeEnd,
            breakMinutes: input.breakMinutes ?? null,
          },
          tx,
        );

        await audit.record(
          {
            action: 'update',
            entityKind: 'bell_schedule',
            entityId: saved.id,
            after: {
              pairNumber: saved.pairNumber,
              timeStart: saved.timeStart,
              timeEnd: saved.timeEnd,
              breakMinutes: saved.breakMinutes,
            },
          },
          options.actor,
          tx,
        );

        return saved;
      });
    },

    async deleteBell(pairNumber, options) {
      return withTransaction(db, options.executor, async (tx) => {
        const removed = await schedule.deleteBell(pairNumber, tx);
        if (!removed) {
          throw new AppError('NOT_FOUND', `Звонок для ${pairNumber}-й пары не найден`);
        }

        await audit.record(
          {
            action: 'delete',
            entityKind: 'bell_schedule',
            entityId: null,
            before: { pairNumber },
          },
          options.actor,
          tx,
        );
      });
    },

    listEntries(filter) {
      return schedule.listEntries(filter);
    },

    async getEntry(id) {
      return requireEntry(id);
    },

    async createEntry(input, options) {
      const assignment = await requireAssignment(input.assignmentId);

      // Время берётся из звонков, если в форме его не задали: сетка заведения —
      // источник истины для «который час идёт пара».
      let { timeStart, timeEnd } = input;
      if (timeStart === undefined || timeEnd === undefined) {
        const bells = await schedule.listBells();
        const bell = bells.find((item) => item.pairNumber === input.pairNumber);

        if (bell === undefined) {
          throw new AppError(
            'VALIDATION_FAILED',
            `Для ${input.pairNumber}-й пары не заданы звонки — укажите время вручную или заполните справочник «Звонки»`,
            { details: { pairNumber: input.pairNumber } },
          );
        }

        timeStart = bell.timeStart;
        timeEnd = bell.timeEnd;
      }

      assertTimesValid(timeStart, timeEnd);

      if (input.validFrom < assignment.startsOn) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Расписание начинается раньше назначения (назначение с ${assignment.startsOn})`,
          { details: { assignmentStartsOn: assignment.startsOn, validFrom: input.validFrom } },
        );
      }

      const validTo = input.validTo ?? null;

      if (assignment.endsOn !== null && validTo !== null && validTo > assignment.endsOn) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Расписание заканчивается позже назначения (назначение до ${assignment.endsOn})`,
          { details: { assignmentEndsOn: assignment.endsOn, validTo } },
        );
      }

      if (input.roomId !== undefined && input.roomId !== null) {
        const room = await catalog.findRoom(input.roomId);
        if (room === null) throw new AppError('NOT_FOUND', 'Аудитория не найдена');
      }

      await assertSlotFree({
        teacherUserId: assignment.teacherUserId,
        studyGroupId: assignment.studyGroupId,
        roomId: input.roomId ?? null,
        dayOfWeek: input.dayOfWeek,
        pairNumber: input.pairNumber,
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
      });

      const entryInput: ScheduleEntryInput = {
        assignmentId: assignment.id,
        studyGroupId: assignment.studyGroupId,
        roomId: input.roomId ?? null,
        dayOfWeek: input.dayOfWeek,
        pairNumber: input.pairNumber,
        // Время уже развёрнуто выше: либо из формы, либо из звонков.
        timeStart,
        timeEnd,
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
      };

      return withTransaction(db, options.executor, async (tx) => {
        const created = await withDatabaseErrors(() => schedule.insertEntry(entryInput, tx), {
          unique: `В группе «${assignment.groupName}» на ${weekdayName(input.dayOfWeek)}, ${input.pairNumber}-ю пару уже есть занятие`,
        });

        await audit.record(
          {
            action: 'create',
            entityKind: 'schedule_entry',
            entityId: created.id,
            after: {
              assignmentId: created.assignmentId,
              groupName: created.groupName,
              subjectName: created.subjectName,
              dayOfWeek: created.dayOfWeek,
              pairNumber: created.pairNumber,
              timeStart: created.timeStart,
              timeEnd: created.timeEnd,
              validFrom: created.validFrom,
              validTo: created.validTo,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async updateEntry(id, input, options) {
      const current = await requireEntry(id);

      const next = {
        dayOfWeek: input.dayOfWeek ?? current.dayOfWeek,
        pairNumber: input.pairNumber ?? current.pairNumber,
        timeStart: input.timeStart ?? current.timeStart,
        timeEnd: input.timeEnd ?? current.timeEnd,
        validFrom: input.validFrom ?? current.validFrom,
        validTo: input.validTo === undefined ? current.validTo : input.validTo,
        roomId: input.roomId === undefined ? current.roomId : input.roomId,
      };

      assertTimesValid(next.timeStart, next.timeEnd);

      if (next.validTo !== null && next.validFrom > next.validTo) {
        throw new AppError('VALIDATION_FAILED', 'Дата начала позже даты окончания');
      }

      const assignment = await requireAssignment(current.assignmentId);
      await assertSlotFree(
        {
          teacherUserId: assignment.teacherUserId,
          studyGroupId: current.studyGroupId,
          roomId: next.roomId,
          dayOfWeek: next.dayOfWeek,
          pairNumber: next.pairNumber,
          validFrom: next.validFrom,
          validTo: next.validTo,
        },
        id,
      );

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await withDatabaseErrors(() => schedule.updateEntry(id, next, tx), {
          unique: `В группе на ${weekdayName(next.dayOfWeek)}, ${next.pairNumber}-ю пару уже есть занятие`,
        });

        if (updated === null) throw new AppError('NOT_FOUND', 'Занятие расписания не найдено');

        await audit.record(
          {
            action: 'update',
            entityKind: 'schedule_entry',
            entityId: id,
            before: {
              dayOfWeek: current.dayOfWeek,
              pairNumber: current.pairNumber,
              timeStart: current.timeStart,
              timeEnd: current.timeEnd,
              validFrom: current.validFrom,
              validTo: current.validTo,
              roomId: current.roomId,
            },
            after: next,
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deleteEntry(id, options) {
      const current = await requireEntry(id);

      return withTransaction(db, options.executor, async (tx) => {
        const removed = await schedule.deleteEntry(id, tx);
        if (!removed) throw new AppError('NOT_FOUND', 'Занятие расписания не найдено');

        await audit.record(
          {
            action: 'delete',
            entityKind: 'schedule_entry',
            entityId: id,
            before: {
              assignmentId: current.assignmentId,
              groupName: current.groupName,
              dayOfWeek: current.dayOfWeek,
              pairNumber: current.pairNumber,
              validFrom: current.validFrom,
              validTo: current.validTo,
            },
          },
          options.actor,
          tx,
        );
      });
    },

    listExceptions(filter) {
      return schedule.listExceptions(filter);
    },

    async createException(input, options) {
      const entry = await requireEntry(input.scheduleEntryId);
      const weekday = dayOfWeekOf(input.exceptionDate);

      if (weekday === null) {
        throw new AppError('VALIDATION_FAILED', 'Дата исключения указана неверно');
      }
      if (weekday !== entry.dayOfWeek) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Исключение можно поставить только на ${weekdayName(entry.dayOfWeek)}: занятие стоит на этот день недели`,
          { details: { entryDayOfWeek: entry.dayOfWeek, dateDayOfWeek: weekday } },
        );
      }
      if (
        input.exceptionDate < entry.validFrom ||
        (entry.validTo !== null && input.exceptionDate > entry.validTo)
      ) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Дата вне периода действия расписания (${entry.validFrom} — ${entry.validTo ?? 'бессрочно'})`,
          { details: { validFrom: entry.validFrom, validTo: entry.validTo } },
        );
      }

      if (input.action === 'replace') {
        const substituteId = input.payload.substituteUserId;
        if (typeof substituteId !== 'string') {
          throw new AppError(
            'VALIDATION_FAILED',
            'Для замены нужно указать заменяющего преподавателя',
          );
        }
        const teacher = await users.findActiveTeacher(substituteId);
        if (teacher === null) {
          throw new AppError(
            'NOT_FOUND',
            'Заменяющий преподаватель не найден или не имеет роли преподавателя',
          );
        }
      }

      if (input.action === 'move') {
        const { timeStart, timeEnd } = input.payload;
        if (typeof timeStart !== 'string' || typeof timeEnd !== 'string') {
          throw new AppError(
            'VALIDATION_FAILED',
            'Для переноса нужно указать новое время начала и окончания',
          );
        }
        assertTimesValid(timeStart, timeEnd);
      }

      const existing = await schedule.findExceptionForSlot(
        input.scheduleEntryId,
        input.exceptionDate,
        entry.pairNumber,
        options.executor,
      );
      if (existing !== null) {
        throw new AppError('CONFLICT', 'На эту дату и пару уже есть исключение', {
          details: { exceptionId: existing.id, action: existing.action },
        });
      }

      return withTransaction(db, options.executor, async (tx) => {
        const created = await schedule.insertException(
          {
            scheduleEntryId: entry.id,
            studyGroupId: entry.studyGroupId,
            exceptionDate: input.exceptionDate,
            pairNumber: entry.pairNumber,
            action: input.action,
            payload: input.payload,
            reason: input.reason ?? null,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'schedule_exception',
            entityId: created.id,
            after: {
              scheduleEntryId: created.scheduleEntryId,
              groupName: created.groupName,
              exceptionDate: created.exceptionDate,
              pairNumber: created.pairNumber,
              action: created.action,
              reason: created.reason,
            },
          },
          options.actor,
          tx,
        );

        // Если урок на эту дату уже порождён — исключение применяется сразу.
        await applyExceptionToLesson(created, tx);

        return created;
      });
    },

    async deleteException(id, options) {
      const current = await schedule.findException(id);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Исключение не найдено');
      }

      return withTransaction(db, options.executor, async (tx) => {
        await schedule.deleteException(id, tx);

        await audit.record(
          {
            action: 'delete',
            entityKind: 'schedule_exception',
            entityId: id,
            before: {
              scheduleEntryId: current.scheduleEntryId,
              groupName: current.groupName,
              exceptionDate: current.exceptionDate,
              action: current.action,
            },
          },
          options.actor,
          tx,
        );
      });
    },

    listLessons(filter) {
      return schedule.listLessons(filter);
    },

    async getLesson(id) {
      return requireLesson(id);
    },

    async updateLesson(id, input, options) {
      const current = await requireLesson(id);

      const lessonDate = input.lessonDate ?? current.lessonDate;
      const pairNumber = input.pairNumber ?? current.pairNumber;
      const timeStart = input.timeStart ?? current.timeStart;
      const timeEnd = input.timeEnd ?? current.timeEnd;

      if (input.timeStart !== undefined || input.timeEnd !== undefined) {
        assertTimesValid(timeStart, timeEnd);
      }

      // Перенос проверяет пару по дате: в группе на одну пару — один урок
      // (ADR-006). Берём состав группы на дату тем же чтением, что и списки
      // уроков, и ищем нужную пару: так проверка не зависит от отдельного
      // запроса по слоту.
      if (lessonDate !== current.lessonDate || pairNumber !== current.pairNumber) {
        const day = await schedule.listLessonsForGroup(
          current.studyGroupId,
          lessonDate,
          lessonDate,
          options.executor,
        );
        const busy = day.find(
          (item) => item.pairNumber === pairNumber && item.status !== 'cancelled',
        );

        if (busy !== undefined && busy.id !== id) {
          throw new AppError(
            'CONFLICT',
            `На ${lessonDate}, ${pairNumber}-ю пару в группе «${current.groupName}» уже стоит «${busy.subjectName}»`,
            { details: { reason: 'group_overlap', conflictId: busy.id } },
          );
        }
      }

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await withDatabaseErrors(
          () =>
            schedule.updateLesson(
              id,
              {
                ...input,
                // Любая правка руками помечает урок: повторная генерация его не тронет.
                isManual: true,
              },
              tx,
            ),
          { unique: 'В группе на эту пару уже есть урок' },
        );

        if (updated === null) throw new AppError('NOT_FOUND', 'Урок не найден');

        await audit.record(
          {
            action: 'update',
            entityKind: 'lesson',
            entityId: id,
            before: {
              lessonDate: current.lessonDate,
              pairNumber: current.pairNumber,
              timeStart: current.timeStart,
              timeEnd: current.timeEnd,
              topic: current.topic,
              status: current.status,
              roomId: current.roomId,
            },
            after: {
              lessonDate: updated.lessonDate,
              pairNumber: updated.pairNumber,
              timeStart: updated.timeStart,
              timeEnd: updated.timeEnd,
              topic: updated.topic,
              status: updated.status,
              roomId: updated.roomId,
            },
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deleteLesson(id, options) {
      const current = await requireLesson(id);

      return withTransaction(db, options.executor, async (tx) => {
        await schedule.deleteLesson(id, tx);

        await audit.record(
          {
            action: 'delete',
            entityKind: 'lesson',
            entityId: id,
            before: {
              lessonDate: current.lessonDate,
              pairNumber: current.pairNumber,
              groupName: current.groupName,
              subjectName: current.subjectName,
            },
          },
          options.actor,
          tx,
        );
      });
    },

    async generateLessons(input, options) {
      if (input.from > input.to) {
        throw new AppError('VALIDATION_FAILED', 'Дата начала позже даты окончания');
      }

      if (input.studyGroupId !== undefined) {
        const group = await catalog.findGroup(input.studyGroupId);
        if (group === null) throw new AppError('NOT_FOUND', 'Группа не найдена');
      }

      const entries = await schedule.listEntries(
        input.studyGroupId === undefined ? {} : { studyGroupId: input.studyGroupId },
      );

      const result = { created: 0, updated: 0, skippedManual: 0, cancelled: 0 };

      return withTransaction(db, options.executor, async (tx) => {
        for (const entry of entries) {
          // Даты, когда занятие действительно должно состояться: день недели
          // совпадает, дата внутри периода действия шаблона и внутри диапазона.
          for (const date of datesForEntry(entry, input.from, input.to)) {
            const exception = await schedule.findExceptionForSlot(entry.id, date, entry.pairNumber);
            const substituted = await schedule.findActiveForAssignment(
              entry.assignmentId,
              date,
              tx,
            );

            const teacherUserId = substituted?.substituteUserId ?? entry.teacherUserId;
            const status = exception?.action === 'cancel' ? 'cancelled' : 'planned';

            // Ищем урок на паре, включая отменённые: отменённый исключением урок
            // нужно вернуть в план, когда исключение сняли, а не создавать второй
            // урок на той же паре.
            const sameDay = await schedule.listLessonsForGroup(entry.studyGroupId, date, date, tx);
            const existing = sameDay.find((item) => item.pairNumber === entry.pairNumber) ?? null;

            if (existing !== null) {
              // Урок отменён исключением на дату: пока исключение действует,
              // статус не пересчитываем — иначе отмена терялась бы при каждом
              // повторном запуске генерации (ADR-006, ADR-009).
              if (exception?.action === 'cancel' && existing.status === 'cancelled') {
                continue;
              }

              // Исключение сняли — урок возвращается в план. Пустая тема отличает
              // отмену исключением от ручной отмены: её ставит администратор уже
              // с темой занятия.
              if (existing.status === 'cancelled' && existing.topic === null) {
                await schedule.updateLesson(
                  existing.id,
                  {
                    status,
                    teacherUserId,
                    plannedTeacherUserId: substituted === null ? null : entry.teacherUserId,
                    isManual: false,
                  },
                  tx,
                );
                result.updated += 1;
                continue;
              }

              if (existing.isManual) {
                result.skippedManual += 1;
                continue;
              }

              if (existing.status !== status || existing.teacherUserId !== teacherUserId) {
                await schedule.updateLesson(
                  existing.id,
                  {
                    status,
                    teacherUserId,
                    plannedTeacherUserId: substituted === null ? null : entry.teacherUserId,
                  },
                  tx,
                );
                result.updated += 1;
              }
              continue;
            }

            await schedule.insertLesson(
              {
                scheduleEntryId: entry.id,
                assignmentId: entry.assignmentId,
                studyGroupId: entry.studyGroupId,
                subjectId: entry.subjectId,
                teacherUserId,
                roomId: entry.roomId,
                lessonDate: date,
                pairNumber: entry.pairNumber,
                timeStart: entry.timeStart,
                timeEnd: entry.timeEnd,
                status,
                isManual: false,
              },
              tx,
            );

            if (status === 'cancelled') result.cancelled += 1;
            else result.created += 1;
          }
        }

        await audit.record(
          {
            action: 'create',
            entityKind: 'lesson_generation',
            entityId: null,
            after: {
              ...result,
              from: input.from,
              to: input.to,
              groupId: input.studyGroupId ?? null,
            },
          },
          options.actor,
          tx,
        );

        return { ...result, from: input.from, to: input.to };
      });
    },

    listSubstitutions(filter) {
      return schedule.listSubstitutions(filter);
    },

    async createSubstitution(input, options) {
      const substitute = await users.findActiveTeacher(input.substituteUserId);
      if (substitute === null) {
        throw new AppError(
          'NOT_FOUND',
          'Заменяющий преподаватель не найден или не имеет роли преподавателя',
        );
      }

      if (input.lessonId !== undefined) {
        const target = await requireLesson(input.lessonId);
        const assignment = await requireAssignment(target.assignmentId);

        if (substitute.id === target.teacherUserId) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Заменяющий совпадает с текущим преподавателем урока',
          );
        }

        return withTransaction(db, options.executor, async (tx) => {
          const created = await schedule.insertSubstitution(
            {
              assignmentId: target.assignmentId,
              lessonId: target.id,
              substituteUserId: substitute.id,
              replacedUserId: target.teacherUserId,
              startsOn: target.lessonDate,
              endsOn: target.lessonDate,
              reason: input.reason,
              createdBy: options.actor.userId,
            },
            tx,
          );

          // Урок сразу показывает фактического преподавателя и статус замены.
          await schedule.updateLesson(
            target.id,
            {
              teacherUserId: substitute.id,
              plannedTeacherUserId: target.teacherUserId,
              status: 'replaced',
              isManual: true,
            },
            tx,
          );

          await audit.record(
            {
              action: 'create',
              entityKind: 'substitution',
              entityId: created.id,
              after: {
                lessonId: target.id,
                assignmentId: assignment.id,
                substituteUserId: substitute.id,
                replacedUserId: target.teacherUserId,
                startsOn: created.startsOn,
                reason: created.reason,
              },
            },
            options.actor,
            tx,
          );

          return created;
        });
      }

      const assignment = await requireAssignment(input.assignmentId ?? '');
      const startsOn = input.startsOn ?? today();
      const endsOn = input.endsOn ?? null;

      if (endsOn !== null && startsOn > endsOn) {
        throw new AppError('VALIDATION_FAILED', 'Дата начала позже даты окончания');
      }
      if (startsOn < assignment.startsOn) {
        throw new AppError('VALIDATION_FAILED', 'Замена начинается раньше назначения');
      }
      if (substitute.id === assignment.teacherUserId) {
        throw new AppError('VALIDATION_FAILED', 'Заменяющий совпадает с преподавателем назначения');
      }

      return withTransaction(db, options.executor, async (tx) => {
        const created = await schedule.insertSubstitution(
          {
            assignmentId: assignment.id,
            lessonId: null,
            substituteUserId: substitute.id,
            replacedUserId: assignment.teacherUserId,
            startsOn,
            endsOn,
            reason: input.reason,
            createdBy: options.actor.userId,
          },
          tx,
        );

        // Уже порождённые уроки в периоде замены обновляются: иначе заменяющий
        // не увидит занятие в своём расписании, и замена теряет смысл (ADR-032).
        const lessons = await schedule.listLessonsForGroup(
          assignment.studyGroupId,
          startsOn,
          endsOn ?? '9999-12-31',
          tx,
        );

        for (const lesson of lessons) {
          if (lesson.assignmentId !== assignment.id || lesson.status === 'cancelled') continue;

          await schedule.updateLesson(
            lesson.id,
            {
              teacherUserId: substitute.id,
              plannedTeacherUserId: lesson.plannedTeacherUserId ?? lesson.teacherUserId,
              status: 'replaced',
              isManual: true,
            },
            tx,
          );
        }

        await audit.record(
          {
            action: 'create',
            entityKind: 'substitution',
            entityId: created.id,
            after: {
              assignmentId: assignment.id,
              substituteUserId: substitute.id,
              replacedUserId: assignment.teacherUserId,
              startsOn,
              endsOn,
              reason: created.reason,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async deleteSubstitution(id, options) {
      const current = await schedule.findSubstitution(id);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Замена не найдена');
      }

      return withTransaction(db, options.executor, async (tx) => {
        await schedule.deleteSubstitution(id, tx);

        await audit.record(
          {
            action: 'delete',
            entityKind: 'substitution',
            entityId: id,
            before: {
              assignmentId: current.assignmentId,
              lessonId: current.lessonId,
              substituteUserId: current.substituteUserId,
              replacedUserId: current.replacedUserId,
              startsOn: current.startsOn,
              endsOn: current.endsOn,
              reason: current.reason,
            },
          },
          options.actor,
          tx,
        );
      });
    },
  };

  /**
   * Применяет исключение к уже порождённому уроку.
   *
   * Генерация может пройти до появления исключения — тогда урок нужно привести в
   * соответствие: отменить, перенести или подменить преподавателя.
   *
   * Правки помечаются ручными (`isManual`): так повторная генерация не вернёт
   * статус «по плану» и не перезапишет перенос. Обратная сторона — снятое
   * исключение само урок не восстановит: восстановление делает генерация, если
   * исключения на дату уже нет (см. `generateLessons`).
   */
  async function applyExceptionToLesson(
    exception: ScheduleExceptionRecord,
    tx: Executor,
  ): Promise<void> {
    const found = await schedule.findLessonForSlot(
      exception.studyGroupId,
      exception.exceptionDate,
      exception.pairNumber,
      tx,
    );

    if (found === null) return;

    if (exception.action === 'cancel') {
      await schedule.updateLesson(found.id, { status: 'cancelled', isManual: true }, tx);
      return;
    }

    if (exception.action === 'move') {
      const { timeStart, timeEnd } = exception.payload;
      if (typeof timeStart === 'string' && typeof timeEnd === 'string') {
        await schedule.updateLesson(found.id, { timeStart, timeEnd, isManual: true }, tx);
      }
      return;
    }

    const substituteUserId = exception.payload.substituteUserId;
    if (typeof substituteUserId === 'string') {
      await schedule.updateLesson(
        found.id,
        {
          teacherUserId: substituteUserId,
          plannedTeacherUserId: found.plannedTeacherUserId ?? found.teacherUserId,
          status: 'replaced',
          isManual: true,
        },
        tx,
      );
    }
  }

  /**
   * Даты, когда занятие по шаблону действительно проходит.
   *
   * Учитываются день недели, период действия шаблона и запрошенный диапазон.
   */
  function datesForEntry(entry: ScheduleEntryRecord, from: string, to: string): string[] {
    const dates: string[] = [];
    const start = from > entry.validFrom ? from : entry.validFrom;
    const end = entry.validTo !== null && entry.validTo < to ? entry.validTo : to;

    if (start > end) return dates;

    const cursor = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);

    while (cursor.getTime() <= last.getTime()) {
      const iso = cursor.toISOString().slice(0, 10);
      if (dayOfWeekOf(iso) === entry.dayOfWeek) dates.push(iso);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
  }
}

/** Типовое время пары для подсказки в интерфейсе. */
export function pairTimeHint(pairNumber: number): { timeStart: string; timeEnd: string } | null {
  return defaultPairTime(pairNumber);
}
