import {
  compareISODates,
  describeRange,
  isValidDateRange,
  rangesOverlap,
  todayISODate,
  type DateRange,
} from '@edu-diary/domain';

import type { AuditActor } from '../../shared/actor';
import type { Database, Executor } from '../../shared/db/client';
import { withDatabaseErrors } from '../../shared/db/errors';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { AuditService } from '../audit';
import type {
  AssignmentListFilters,
  AssignmentRow,
  StaffingRepository,
} from './staffing.repository';

/**
 * Назначения «преподаватель ↔ предмет ↔ группа» (Этап 2).
 *
 * Назначение — это период, в котором преподаватель ведёт предмет в группе.
 * Правила подобраны так, чтобы данные оставались историей: закрытие периода
 * вместо удаления, запрет переписывать то, что уже началось, запрет пересечений
 * у одного преподавателя и у одной пары «группа + предмет».
 */

export interface MutationOptions {
  actor: AuditActor;
  executor?: Executor | undefined;
}

/** Порт проверки преподавателя: реализует модуль `iam`. */
export interface TeacherLookupPort {
  /** Действующий пользователь с ролью преподавателя или `null`. */
  findActiveTeacher(userId: string): Promise<{ id: string; fullName: string } | null>;
}

/**
 * Порт справочников: реализует модуль `academics`.
 *
 * Нужен, чтобы назначение ссылалось на существующие предмет и группу, а группа
 * не удалялась, пока на неё есть назначения.
 */
export interface CatalogLookupPort {
  findGroup(id: string): Promise<{ id: string; name: string; academicYearId: string } | null>;
  findSubject(id: string): Promise<{ id: string; name: string } | null>;
}

export interface TeacherViewer {
  userId: string;
  /** Право `academics:read` шире `assigned`: администратор видит все назначения. */
  canReadAll: boolean;
}

export interface CreateAssignmentInput {
  teacherUserId: string;
  subjectId: string;
  studyGroupId: string;
  startsOn: string;
  endsOn?: string | null | undefined;
  hoursPlanned?: number | null | undefined;
  note?: string | null | undefined;
}

export interface UpdateAssignmentInput {
  startsOn?: string | undefined;
  endsOn?: string | null | undefined;
  hoursPlanned?: number | null | undefined;
  note?: string | null | undefined;
}

export interface StaffingService {
  list(filters: AssignmentListFilters): Promise<{ items: AssignmentRow[]; total: number }>;
  /** Назначения преподавателя; администратор получает все. */
  listForViewer(
    viewer: TeacherViewer,
    filters: AssignmentListFilters,
  ): Promise<{ items: AssignmentRow[]; total: number }>;
  get(id: string): Promise<AssignmentRow>;
  create(input: CreateAssignmentInput, options: MutationOptions): Promise<AssignmentRow>;
  update(
    id: string,
    input: UpdateAssignmentInput,
    options: MutationOptions,
  ): Promise<AssignmentRow>;
  /** Закрытие периода: дата окончания вместо удаления записи. */
  close(id: string, endsOn: string, options: MutationOptions): Promise<AssignmentRow>;
  /** Закрывает все действующие назначения преподавателя указанной датой. */
  closeAllForTeacher(
    teacherUserId: string,
    endsOn: string,
    options: MutationOptions,
  ): Promise<number>;
  remove(id: string, options: MutationOptions): Promise<void>;
}

export interface StaffingServiceDependencies {
  db: Database;
  staffing: StaffingRepository;
  audit: AuditService;
  teachers: TeacherLookupPort;
  catalog: CatalogLookupPort;
  /** Дата «сегодня»: вынесена, чтобы тесты не зависели от календаря. */
  today?: (() => string) | undefined;
}

function assertRange(range: DateRange): void {
  if (!isValidDateRange(range)) {
    throw new AppError('VALIDATION_FAILED', 'Дата начала позже даты окончания', {
      details: { startsOn: range.startsOn, endsOn: range.endsOn },
    });
  }
}

export function createStaffingService(dependencies: StaffingServiceDependencies): StaffingService {
  const { db, staffing, audit, teachers, catalog } = dependencies;
  const today = dependencies.today ?? todayISODate;

  const requireAssignment = async (id: string, executor?: Executor): Promise<AssignmentRow> => {
    const assignment = await staffing.find(id, executor);
    if (assignment === null) {
      throw new AppError('NOT_FOUND', 'Назначение не найдено');
    }
    return assignment;
  };

  const requireTeacher = async (userId: string): Promise<{ id: string; fullName: string }> => {
    const teacher = await teachers.findActiveTeacher(userId);
    if (teacher === null) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Преподаватель не найден, отключён или не имеет роли преподавателя',
        { details: { teacherUserId: userId } },
      );
    }
    return teacher;
  };

  const requireGroup = async (id: string) => {
    const group = await catalog.findGroup(id);
    if (group === null) {
      throw new AppError('NOT_FOUND', 'Группа не найдена', { details: { studyGroupId: id } });
    }
    return group;
  };

  const requireSubject = async (id: string) => {
    const subject = await catalog.findSubject(id);
    if (subject === null) {
      throw new AppError('NOT_FOUND', 'Предмет не найден', { details: { subjectId: id } });
    }
    return subject;
  };

  /**
   * Пересечения периодов.
   *
   * Один преподаватель не ведёт две пары одновременно — это ошибка ввода.
   * Один предмет в одной группе ведёт один преподаватель: иначе непонятно, чей
   * журнал заполнять. Проверки идут раздельно, чтобы сообщение объясняло причину.
   */
  const assertNoOverlap = async (
    candidate: AssignmentRow | { id?: string },
    input: {
      teacherUserId: string;
      subjectId: string;
      studyGroupId: string;
      range: DateRange;
    },
    executor?: Executor,
  ): Promise<void> => {
    const currentId = 'id' in candidate ? candidate.id : undefined;

    const sameTeacher = await staffing.listByTeacher(input.teacherUserId, executor);
    const teacherConflict = sameTeacher.find(
      (item) =>
        item.id !== currentId &&
        rangesOverlap(input.range, { startsOn: item.startsOn, endsOn: item.endsOn }),
    );

    if (teacherConflict !== undefined) {
      throw new AppError(
        'CONFLICT',
        `У преподавателя уже есть назначение в этот период: «${teacherConflict.groupName}», «${teacherConflict.subjectName}» (${describeRange(
          { startsOn: teacherConflict.startsOn, endsOn: teacherConflict.endsOn },
        )})`,
        {
          details: {
            reason: 'teacher_overlap',
            conflictId: teacherConflict.id,
            studyGroupId: teacherConflict.studyGroupId,
            subjectId: teacherConflict.subjectId,
          },
        },
      );
    }

    const sameGroup = await staffing.listByGroup(input.studyGroupId, executor);
    const subjectConflict = sameGroup.find(
      (item) =>
        item.id !== currentId &&
        item.subjectId === input.subjectId &&
        rangesOverlap(input.range, { startsOn: item.startsOn, endsOn: item.endsOn }),
    );

    if (subjectConflict !== undefined) {
      throw new AppError(
        'CONFLICT',
        `Предмет «${subjectConflict.subjectName}» в этой группе уже ведёт ${subjectConflict.teacherName} (${describeRange(
          { startsOn: subjectConflict.startsOn, endsOn: subjectConflict.endsOn },
        )})`,
        {
          details: {
            reason: 'subject_overlap',
            conflictId: subjectConflict.id,
            teacherUserId: subjectConflict.teacherUserId,
          },
        },
      );
    }
  };

  const assignmentSnapshot = (assignment: AssignmentRow) => ({
    teacherUserId: assignment.teacherUserId,
    subjectId: assignment.subjectId,
    studyGroupId: assignment.studyGroupId,
    startsOn: assignment.startsOn,
    endsOn: assignment.endsOn,
    hoursPlanned: assignment.hoursPlanned,
  });

  return {
    list(filters) {
      return staffing.list(filters);
    },

    async listForViewer(viewer, filters) {
      // Инвариант: преподаватель видит только свои назначения. Администратор
      // получает весь список — он управляет нагрузкой.
      if (viewer.canReadAll) return staffing.list(filters);

      return staffing.list({ ...filters, teacherUserId: viewer.userId });
    },

    get(id) {
      return requireAssignment(id);
    },

    async create(input, options): Promise<AssignmentRow> {
      const range: DateRange = { startsOn: input.startsOn, endsOn: input.endsOn ?? null };
      assertRange(range);
      await requireTeacher(input.teacherUserId);
      await requireSubject(input.subjectId);
      await requireGroup(input.studyGroupId);

      return withTransaction(db, options.executor, async (tx) => {
        await assertNoOverlap(
          {},
          {
            teacherUserId: input.teacherUserId,
            subjectId: input.subjectId,
            studyGroupId: input.studyGroupId,
            range,
          },
          tx,
        );

        const created = await withDatabaseErrors(
          () =>
            staffing.insert(
              {
                teacherUserId: input.teacherUserId,
                subjectId: input.subjectId,
                studyGroupId: input.studyGroupId,
                startsOn: input.startsOn,
                endsOn: input.endsOn ?? null,
                hoursPlanned: input.hoursPlanned ?? null,
                note: input.note ?? null,
              },
              tx,
            ),
          { foreignKey: 'Предмет или группа не найдены' },
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'teaching_assignment',
            entityId: created.id,
            after: assignmentSnapshot(created),
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async update(id, input, options): Promise<AssignmentRow> {
      const current = await requireAssignment(id);

      const range: DateRange = {
        startsOn: input.startsOn ?? current.startsOn,
        endsOn: input.endsOn === undefined ? current.endsOn : input.endsOn,
      };
      assertRange(range);

      // Назначение, которое уже началось, не переписываем: на него ссылаются
      // уроки и журнал (Этап 3). Изменение оформляется закрытием и новым
      // назначением — так история «кто вёл» остаётся достоверной.
      const started = compareISODates(current.startsOn, today()) <= 0;
      const changesStart = input.startsOn !== undefined && input.startsOn !== current.startsOn;

      if (started && changesStart) {
        throw new AppError(
          'CONFLICT',
          'Назначение уже началось: закройте его датой и создайте новое вместо правки начала',
          {
            details: {
              reason: 'assignment_started',
              assignmentId: id,
              startsOn: current.startsOn,
              today: today(),
            },
          },
        );
      }

      return withTransaction(db, options.executor, async (tx) => {
        await assertNoOverlap(
          current,
          {
            teacherUserId: current.teacherUserId,
            subjectId: current.subjectId,
            studyGroupId: current.studyGroupId,
            range,
          },
          tx,
        );

        const updated = await withDatabaseErrors(
          () =>
            staffing.update(
              id,
              {
                startsOn: input.startsOn,
                endsOn: input.endsOn,
                hoursPlanned: input.hoursPlanned,
                note: input.note,
              },
              tx,
            ),
          { foreignKey: 'Не удалось изменить назначение' },
        );

        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Назначение не найдено');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'teaching_assignment',
            entityId: id,
            before: assignmentSnapshot(current),
            after: assignmentSnapshot(updated),
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async close(id, endsOn, options): Promise<AssignmentRow> {
      const current = await requireAssignment(id);

      if (current.endsOn !== null && compareISODates(endsOn, current.endsOn) >= 0) {
        throw new AppError('CONFLICT', 'Назначение уже закрыто не раньше указанной даты', {
          details: { assignmentId: id, endsOn: current.endsOn, requested: endsOn },
        });
      }

      if (compareISODates(endsOn, current.startsOn) < 0) {
        throw new AppError('VALIDATION_FAILED', 'Дата окончания раньше даты начала', {
          details: { startsOn: current.startsOn, endsOn },
        });
      }

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await staffing.update(id, { endsOn }, tx);
        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Назначение не найдено');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'teaching_assignment',
            entityId: id,
            before: { endsOn: current.endsOn },
            after: { endsOn },
            context: { closed: true },
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async closeAllForTeacher(teacherUserId, endsOn, options): Promise<number> {
      await requireTeacher(teacherUserId);

      return withTransaction(db, options.executor, async (tx) => {
        const assignments = await staffing.listByTeacher(teacherUserId, tx);
        const open = assignments.filter(
          (assignment) =>
            assignment.endsOn === null && compareISODates(endsOn, assignment.startsOn) >= 0,
        );

        if (open.length === 0) return 0;

        const updated = await staffing.updateMany(
          open.map((assignment) => assignment.id),
          { endsOn },
          tx,
        );

        await audit.record(
          {
            action: 'update',
            entityKind: 'teaching_assignment',
            entityId: null,
            before: { open: open.length },
            after: { closed: updated, endsOn },
            context: { teacherUserId, closedAll: true },
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async remove(id, options): Promise<void> {
      const current = await requireAssignment(id);

      // Удалять можно только назначение, которое ещё не началось (или уже
      // закрытое): на начавшееся ссылаются уроки, и его история должна остаться.
      const started = compareISODates(current.startsOn, today()) <= 0;
      if (current.endsOn === null && started) {
        throw new AppError('CONFLICT', 'Действующее назначение не удаляется: закройте его датой', {
          details: { assignmentId: id, reason: 'active' },
        });
      }

      return withTransaction(db, options.executor, async (tx) => {
        const removed = await withDatabaseErrors(() => staffing.remove(id, tx), {
          foreignKey: 'На назначение ссылаются уроки: удаление запрещено',
        });

        if (!removed) {
          throw new AppError('NOT_FOUND', 'Назначение не найдено');
        }

        await audit.record(
          {
            action: 'delete',
            entityKind: 'teaching_assignment',
            entityId: id,
            before: assignmentSnapshot(current),
          },
          options.actor,
          tx,
        );
      });
    },
  };
}
