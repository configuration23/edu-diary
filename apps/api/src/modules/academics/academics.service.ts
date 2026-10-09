import { compareISODates, isISODate } from '@edu-diary/domain';

import type { AuditActor } from '../../shared/actor';
import type { Database, Executor } from '../../shared/db/client';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { AuditService } from '../audit';
import type { SecurityService } from '../security';
import type {
  AcademicsRepository,
  AcademicYearRecord,
  PeriodRecord,
  StudentListFilters,
  StudentRecord,
} from './academics.repository';

/** Ученики, учебные годы и периоды (Этап 1: то, что нужно мастеру и согласиям). */

export interface MutationOptions {
  actor: AuditActor;
  executor?: Executor | undefined;
}

/** Кто смотрит карточку ученика: от этого зависит ответ. */
export interface StudentViewer {
  userId: string;
  /** Сотрудник с правом `students:read` шире `own` (администратор, преподаватель). */
  canReadAnyStudent: boolean;
  actor: AuditActor;
}

/**
 * Порт доступа к привязкам «родитель ↔ ученик».
 *
 * Реализацию предоставляет модуль `iam` при сборке приложения: так `academics`
 * не зависит от `iam` (иначе модули ссылались бы друг на друга).
 */
export interface GuardianLookupPort {
  studentIdsOfGuardian(guardianUserId: string): Promise<string[]>;
}

export interface CreateStudentInput {
  fullName: string;
  shortName?: string | undefined;
  birthDate?: string | null | undefined;
  note?: string | undefined;
  userId?: string | null | undefined;
}

export interface UpdateStudentInput {
  fullName?: string | undefined;
  shortName?: string | null | undefined;
  birthDate?: string | null | undefined;
  note?: string | null | undefined;
  userId?: string | null | undefined;
}

export interface CreateAcademicYearInput {
  title: string;
  startsOn: string;
  endsOn: string;
  isActive?: boolean | undefined;
}

export interface CreatePeriodInput {
  academicYearId: string;
  title: string;
  kind: 'term' | 'semester' | 'quarter';
  startsOn: string;
  endsOn: string;
}

export interface AcademicsService {
  listStudents(filters: StudentListFilters): Promise<{ items: StudentRecord[]; total: number }>;
  /** Карточка ученика с проверкой области действия и записью аудита доступа. */
  getStudentForViewer(studentId: string, viewer: StudentViewer): Promise<StudentRecord>;
  studentExists(id: string): Promise<boolean>;
  createStudent(input: CreateStudentInput, options: MutationOptions): Promise<StudentRecord>;
  updateStudent(
    id: string,
    input: UpdateStudentInput,
    options: MutationOptions,
  ): Promise<StudentRecord>;
  /** Выгрузка списка: создаёт запись аудита доступа (ADR-017). */
  exportStudentsCsv(actor: AuditActor): Promise<{ csv: string; rows: number }>;
  listAcademicYears(): Promise<AcademicYearRecord[]>;
  createAcademicYear(
    input: CreateAcademicYearInput,
    options: MutationOptions,
  ): Promise<AcademicYearRecord>;
  listPeriods(academicYearId?: string | undefined): Promise<PeriodRecord[]>;
  createPeriod(input: CreatePeriodInput, options: MutationOptions): Promise<PeriodRecord>;
}

export interface AcademicsServiceDependencies {
  db: Database;
  academics: AcademicsRepository;
  audit: AuditService;
  security: SecurityService;
  guardians: GuardianLookupPort;
}

function assertDateRange(startsOn: string, endsOn: string): void {
  if (!isISODate(startsOn) || !isISODate(endsOn)) {
    throw new AppError('VALIDATION_FAILED', 'Даты должны быть в формате YYYY-MM-DD');
  }
  if (compareISODates(startsOn, endsOn) > 0) {
    throw new AppError('VALIDATION_FAILED', 'Дата начала позже даты окончания');
  }
}

function csvCell(value: string): string {
  return /[",;\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function createAcademicsService(
  dependencies: AcademicsServiceDependencies,
): AcademicsService {
  const { db, academics, audit, security, guardians } = dependencies;

  /** Инвариант приватности: ученик видит себя, родитель — своих детей (ADR-005). */
  const isAllowedToView = async (
    student: StudentRecord,
    viewer: StudentViewer,
  ): Promise<boolean> => {
    if (viewer.canReadAnyStudent) return true;
    if (student.userId !== null && student.userId === viewer.userId) return true;

    const children = await guardians.studentIdsOfGuardian(viewer.userId);
    return children.includes(student.id);
  };

  return {
    listStudents(filters) {
      return academics.listStudents(filters);
    },

    async getStudentForViewer(studentId, viewer): Promise<StudentRecord> {
      const student = await academics.findStudent(studentId);
      if (student === null) {
        throw new AppError('NOT_FOUND', 'Ученик не найден');
      }

      if (!(await isAllowedToView(student, viewer))) {
        await security.onAccessDenied(
          {
            reason: 'student_out_of_scope',
            actor: viewer.actor,
            details: { studentId, viewerUserId: viewer.userId },
          },
          undefined,
        );

        // Наружу — «не найдено»: существование чужого ученика не подтверждаем.
        throw new AppError('NOT_FOUND', 'Ученик не найден');
      }

      await audit.record(
        {
          action: 'access',
          entityKind: 'student',
          entityId: student.id,
          isAccess: true,
          context: { viewerUserId: viewer.userId },
        },
        viewer.actor,
      );

      return student;
    },

    async studentExists(id): Promise<boolean> {
      return (await academics.findStudent(id)) !== null;
    },

    async createStudent(input, options): Promise<StudentRecord> {
      return withTransaction(db, options.executor, async (tx) => {
        const created = await academics.insertStudent(
          {
            userId: input.userId ?? null,
            fullName: input.fullName,
            shortName: input.shortName ?? null,
            birthDate: input.birthDate ?? null,
            note: input.note ?? null,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'student',
            entityId: created.id,
            after: {
              fullName: created.fullName,
              shortName: created.shortName,
              birthDate: created.birthDate,
              userId: created.userId,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async updateStudent(id, input, options): Promise<StudentRecord> {
      const current = await academics.findStudent(id);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Ученик не найден');
      }

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await academics.updateStudent(id, input, tx);
        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Ученик не найден');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'student',
            entityId: id,
            before: {
              fullName: current.fullName,
              shortName: current.shortName,
              birthDate: current.birthDate,
              note: current.note,
              userId: current.userId,
            },
            after: input,
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async exportStudentsCsv(actor): Promise<{ csv: string; rows: number }> {
      const { items, total } = await academics.listStudents({ limit: 1000, offset: 0 });

      const lines = [
        ['ФИО', 'Краткое имя', 'Дата рождения', 'Примечание'].join(';'),
        ...items.map((student) =>
          [
            csvCell(student.fullName),
            csvCell(student.shortName ?? ''),
            csvCell(student.birthDate ?? ''),
            csvCell(student.note ?? ''),
          ].join(';'),
        ),
      ];

      // Выгрузка персональных данных — событие доступа (ADR-017).
      await audit.record(
        {
          action: 'export',
          entityKind: 'student',
          isAccess: true,
          context: { rows: total, format: 'csv' },
        },
        actor,
      );

      return { csv: `\uFEFF${lines.join('\n')}\n`, rows: total };
    },

    listAcademicYears() {
      return academics.listAcademicYears();
    },

    async createAcademicYear(input, options): Promise<AcademicYearRecord> {
      assertDateRange(input.startsOn, input.endsOn);

      return withTransaction(db, options.executor, async (tx) => {
        const created = await academics.insertAcademicYear(
          {
            title: input.title,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            isActive: input.isActive ?? true,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'academic_year',
            entityId: created.id,
            after: {
              title: created.title,
              startsOn: created.startsOn,
              endsOn: created.endsOn,
              isActive: created.isActive,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    listPeriods(academicYearId) {
      return academics.listPeriods(academicYearId);
    },

    async createPeriod(input, options): Promise<PeriodRecord> {
      assertDateRange(input.startsOn, input.endsOn);

      return withTransaction(db, options.executor, async (tx) => {
        // Проверки внутри транзакции читают через тот же исполнитель: иначе
        // созданный в этой же транзакции год был бы «не найден».
        const year = await academics.findAcademicYear(input.academicYearId, tx);
        if (year === null) {
          throw new AppError('NOT_FOUND', 'Учебный год не найден');
        }

        const sort = await academics.countPeriods(input.academicYearId, tx);

        const created = await academics.insertPeriod(
          {
            academicYearId: input.academicYearId,
            title: input.title,
            kind: input.kind,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            sort,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'period',
            entityId: created.id,
            after: {
              academicYearId: created.academicYearId,
              title: created.title,
              kind: created.kind,
              startsOn: created.startsOn,
              endsOn: created.endsOn,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },
  };
}
