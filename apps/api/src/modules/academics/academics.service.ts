import { DEFAULT_GRADE_CATEGORIES, SIGN_TITLES } from '@edu-diary/contracts';
import {
  compareISODates,
  describeRange,
  isValidDateRange,
  rangesOverlap,
  type DateRange,
} from '@edu-diary/domain';

import type { AuditActor } from '../../shared/actor';
import type { Database, Executor } from '../../shared/db/client';
import { withDatabaseErrors } from '../../shared/db/errors';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { AuditService } from '../audit';
import type { SecurityService } from '../security';
import type {
  AcademicsRepository,
  AcademicYearRecord,
  Dependencies,
  EnrollmentRecord,
  GradeCategoryRecord,
  SignRuleRecord,
  PeriodRecord,
  RoomRecord,
  StudentListFilters,
  StudentRecord,
  StudyGroupRecord,
  SubjectRecord,
} from './academics.repository';

/** Ученики, учебные годы и периоды, группы, зачисления и справочники. */

/** Порог знаков по умолчанию: пять знаков на одну оценку. */
const DEFAULT_SIGN_THRESHOLD = 5;

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

/**
 * Порт использования назначений: реализует модуль `staffing`.
 *
 * Нужен, чтобы не удалить предмет или группу, на которые ссылаются назначения:
 * сам `academics` о таблице назначений ничего не знает. Тип объявлен здесь, а не
 * взят из `staffing`: `staffing` уже зависит от `academics` (читает группы и
 * предметы), и обратная ссылка замкнула бы модули в кольцо.
 */
export interface AssignmentUsagePort {
  countUsages(filter: { subjectId?: string; studyGroupId?: string }): Promise<number>;
}

/**
 * Порт проверки и создания пользователя: реализует модуль `iam`.
 *
 * Нужен для куратора группы, преподавателя в назначениях и учётной записи
 * ученика: ссылки на `app_user` объявлены без внешнего ключа (ADR-027), поэтому
 * существование проверяет сервис. Создание учётной записи ученика идёт сюда же:
 * политика паролей и нормирование логина живут в одном месте.
 */
export interface UserLookupPort {
  findActiveUser(userId: string): Promise<{ id: string; fullName: string } | null>;
  /** Поиск по логину без учёта регистра: проверка занятости перед созданием. */
  findActiveUserByUsername(username: string): Promise<{ id: string } | null>;
  /** Логины по идентификаторам учётных записей: для списка учеников. */
  findUsernames(userIds: readonly string[]): Promise<Map<string, string>>;
  /** Создаёт учётную запись с указанными ролями; пароль временный. */
  createUser(
    input: {
      username: string;
      password: string;
      fullName: string;
      roles: readonly string[];
      /** Требовать смену пароля при первом входе (по умолчанию — да). */
      mustChangePassword?: boolean;
      email?: string;
      phone?: string;
    },
    executor?: Executor,
  ): Promise<{ id: string }>;
}

export interface CreateStudentInput {
  fullName: string;
  shortName?: string | null | undefined;
  birthDate?: string | null | undefined;
  /** `null` приходит из формы, когда поле оставили пустым. */
  note?: string | null | undefined;
  userId?: string | null | undefined;
  /** Новая учётная запись ученика: необязательна (создаётся по необходимости). */
  account?:
    | {
        username: string;
        password: string;
        email?: string;
        phone?: string;
        /** Требовать смену пароля при первом входе (по умолчанию — да). */
        mustChangePassword?: boolean;
      }
    | undefined;
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

export interface UpdateAcademicYearInput {
  title?: string | undefined;
  startsOn?: string | undefined;
  endsOn?: string | undefined;
}

export interface CreatePeriodInput {
  academicYearId: string;
  title: string;
  kind: 'term' | 'semester' | 'quarter';
  startsOn: string;
  endsOn: string;
}

export interface UpdatePeriodInput {
  title?: string | undefined;
  kind?: 'term' | 'semester' | 'quarter' | undefined;
  startsOn?: string | undefined;
  endsOn?: string | undefined;
}

export interface CreateGroupInput {
  academicYearId: string;
  name: string;
  course?: number | null | undefined;
  specialty?: string | null | undefined;
  curatorUserId?: string | null | undefined;
  startsOn: string;
  endsOn: string;
}

export interface UpdateGroupInput {
  name?: string | undefined;
  course?: number | null | undefined;
  specialty?: string | null | undefined;
  curatorUserId?: string | null | undefined;
  startsOn?: string | undefined;
  endsOn?: string | undefined;
}

export interface CreateSubjectInput {
  name: string;
  shortName?: string | null | undefined;
  kind: 'mandatory' | 'optional' | 'practice';
  color?: string | null | undefined;
}

export interface UpdateSubjectInput {
  name?: string | undefined;
  shortName?: string | null | undefined;
  kind?: 'mandatory' | 'optional' | 'practice' | undefined;
  color?: string | null | undefined;
}

export interface CreateRoomInput {
  name: string;
  capacity?: number | null | undefined;
  note?: string | null | undefined;
}

export interface UpdateRoomInput {
  name?: string | undefined;
  capacity?: number | null | undefined;
  note?: string | null | undefined;
}

export interface CreateGradeCategoryInput {
  code: string;
  title: string;
  weight: number;
  color?: string | null | undefined;
  isDefault: boolean;
  /** Накопительный знак: `plus` или `dot`. У обычных причин не задаётся. */
  sign?: string | undefined;
  signThreshold?: number | undefined;
  signRuleActive?: boolean | undefined;
}

export interface UpdateGradeCategoryInput {
  title?: string | undefined;
  weight?: number | undefined;
  color?: string | null | undefined;
  isDefault?: boolean | undefined;
}

export interface AcademicsService {
  listStudents(filters: StudentListFilters): Promise<{ items: StudentRecord[]; total: number }>;
  /** Карточка ученика с проверкой области действия и записью аудита доступа. */
  getStudentForViewer(studentId: string, viewer: StudentViewer): Promise<StudentRecord>;
  studentExists(id: string): Promise<boolean>;
  /** Ученик по идентификатору для служебных связок (имя, проверка существования). */
  findStudentForLookup(id: string): Promise<StudentRecord | null>;
  /** Имена учеников одним запросом: списки связей и составов групп. */
  namesOfStudents(ids: readonly string[]): Promise<Map<string, string>>;
  createStudent(input: CreateStudentInput, options: MutationOptions): Promise<StudentRecord>;
  /** Учётная запись ученику, созданному ранее (учётка — по необходимости). */
  createStudentAccount(
    studentId: string,
    input: { username: string; password: string; mustChangePassword?: boolean },
    options: MutationOptions,
  ): Promise<StudentRecord>;
  updateStudent(
    id: string,
    input: UpdateStudentInput,
    options: MutationOptions,
  ): Promise<StudentRecord>;
  /**
   * Удаление карточки ученика.
   *
   * Владелец: «удалить можно только ученика без УЗ и без Согласия; если есть УЗ или Согласие —
   * только отключить». Удаление стирает карточку безвозвратно, поэтому запрещено, пока на неё
   * что-то ссылается: учётная запись, согласие, зачисление.
   */
  deleteStudent(id: string, options: MutationOptions): Promise<void>;
  /** Выгрузка списка: создаёт запись аудита доступа (ADR-017). */
  exportStudentsCsv(actor: AuditActor): Promise<{ csv: string; rows: number }>;

  listAcademicYears(): Promise<AcademicYearRecord[]>;
  getAcademicYear(id: string): Promise<AcademicYearRecord>;
  createAcademicYear(
    input: CreateAcademicYearInput,
    options: MutationOptions,
  ): Promise<AcademicYearRecord>;
  updateAcademicYear(
    id: string,
    input: UpdateAcademicYearInput,
    options: MutationOptions,
  ): Promise<AcademicYearRecord>;
  /** Активный год ровно один: остальные выключаются в той же транзакции. */
  activateAcademicYear(id: string, options: MutationOptions): Promise<AcademicYearRecord>;
  deleteAcademicYear(id: string, options: MutationOptions): Promise<void>;

  listPeriods(academicYearId?: string | undefined): Promise<PeriodRecord[]>;
  createPeriod(input: CreatePeriodInput, options: MutationOptions): Promise<PeriodRecord>;
  updatePeriod(
    id: string,
    input: UpdatePeriodInput,
    options: MutationOptions,
  ): Promise<PeriodRecord>;
  deletePeriod(id: string, options: MutationOptions): Promise<void>;

  listGroups(filters: {
    academicYearId?: string | undefined;
    search?: string | undefined;
  }): Promise<StudyGroupRecord[]>;
  getGroup(id: string): Promise<StudyGroupRecord>;
  createGroup(input: CreateGroupInput, options: MutationOptions): Promise<StudyGroupRecord>;
  updateGroup(
    id: string,
    input: UpdateGroupInput,
    options: MutationOptions,
  ): Promise<StudyGroupRecord>;
  deleteGroup(id: string, options: MutationOptions): Promise<void>;

  listEnrollments(studyGroupId: string): Promise<EnrollmentRecord[]>;
  enrollStudent(
    studyGroupId: string,
    input: { studentId: string; joinedOn: string; note?: string | undefined },
    options: MutationOptions,
  ): Promise<EnrollmentRecord>;
  withdrawStudent(
    enrollmentId: string,
    leftOn: string,
    note: string | undefined,
    options: MutationOptions,
  ): Promise<EnrollmentRecord>;
  /** Перевод: закрыть текущее зачисление и открыть новое одной транзакцией. */
  transferStudent(
    studentId: string,
    input: { studyGroupId: string; transferOn: string; note?: string | undefined },
    options: MutationOptions,
  ): Promise<EnrollmentRecord>;

  listSubjects(): Promise<SubjectRecord[]>;
  createSubject(input: CreateSubjectInput, options: MutationOptions): Promise<SubjectRecord>;
  updateSubject(
    id: string,
    input: UpdateSubjectInput,
    options: MutationOptions,
  ): Promise<SubjectRecord>;
  deleteSubject(id: string, options: MutationOptions): Promise<void>;

  listRooms(): Promise<RoomRecord[]>;
  createRoom(input: CreateRoomInput, options: MutationOptions): Promise<RoomRecord>;
  updateRoom(id: string, input: UpdateRoomInput, options: MutationOptions): Promise<RoomRecord>;
  deleteRoom(id: string, options: MutationOptions): Promise<void>;

  listGradeCategories(): Promise<GradeCategoryRecord[]>;
  /**
   * Синхронизация причин оценок «из коробки»: недостающие добавляются,
   * существующие не перезаписываются — названия и веса правит заведение.
   */
  syncGradeCategories(): Promise<{ created: number; total: number }>;
  /** Накопительные знаки: пороги плюсов и точек. */
  listSignRules(): Promise<SignRuleRecord[]>;
  updateSignRule(
    sign: string,
    input: { threshold?: number | undefined; isActive?: boolean | undefined },
    options: MutationOptions,
  ): Promise<SignRuleRecord>;
  createGradeCategory(
    input: CreateGradeCategoryInput,
    options: MutationOptions,
  ): Promise<GradeCategoryRecord>;
  updateGradeCategory(
    id: string,
    input: UpdateGradeCategoryInput,
    options: MutationOptions,
  ): Promise<GradeCategoryRecord>;
  deleteGradeCategory(id: string, options: MutationOptions): Promise<void>;
}

/**
 * Порт согласий.
 *
 * Нужен при удалении ученика: согласие ссылается на ученика, и удалять того, у кого согласие
 * оформлено, нельзя — запись о согласии должна остаться. Порт, а не импорт модуля, потому что
 * модули не знают друг о друге (ARCHITECTURE.md §5).
 */
export interface ConsentLookupPort {
  hasAnyForStudent(studentId: string): Promise<boolean>;
}

export interface AcademicsServiceDependencies {
  db: Database;
  academics: AcademicsRepository;
  audit: AuditService;
  security: SecurityService;
  guardians: GuardianLookupPort;
  assignments: AssignmentUsagePort;
  users: UserLookupPort;
  consents: ConsentLookupPort;
}

/** Зависимости, из-за которых удаление запрещено (ARCHITECTURE.md §5). */
function describeDependencies(dependencies: Dependencies): string[] {
  const used: string[] = [];
  if (dependencies.assignments > 0) used.push('assignments');
  if (dependencies.enrollments > 0) used.push('enrollments');
  return used;
}

/** Период или группа не должны выходить за границы: одна проверка на всех. */
function isRangeInside(inner: DateRange, outer: DateRange): boolean {
  if (compareISODates(inner.startsOn, outer.startsOn) < 0) return false;
  if (inner.endsOn === null) return outer.endsOn === null;
  if (outer.endsOn === null) return true;
  return compareISODates(inner.endsOn, outer.endsOn) <= 0;
}

function assertDateRange(startsOn: string, endsOn: string | null): void {
  if (!isValidDateRange({ startsOn, endsOn })) {
    throw new AppError('VALIDATION_FAILED', 'Дата начала позже даты окончания', {
      details: { startsOn, endsOn },
    });
  }
}

function csvCell(value: string): string {
  return /[",;\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function createAcademicsService(
  dependencies: AcademicsServiceDependencies,
): AcademicsService {
  const { db, academics, audit, security, guardians, assignments, users, consents } = dependencies;

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

  const requireYear = async (id: string, executor?: Executor): Promise<AcademicYearRecord> => {
    const year = await academics.findAcademicYear(id, executor);
    if (year === null) {
      throw new AppError('NOT_FOUND', 'Учебный год не найден');
    }
    return year;
  };

  const requireGroup = async (id: string, executor?: Executor): Promise<StudyGroupRecord> => {
    const group = await academics.findGroup(id, executor);
    if (group === null) {
      throw new AppError('NOT_FOUND', 'Группа не найдена');
    }
    return group;
  };

  const requireStudent = async (id: string, executor?: Executor): Promise<StudentRecord> => {
    const student = await academics.findStudent(id, executor);
    if (student === null) {
      throw new AppError('NOT_FOUND', 'Ученик не найден');
    }
    return student;
  };

  /** Куратор должен быть действующим пользователем: внешнего ключа здесь нет. */
  const assertCurator = async (curatorUserId: string | null | undefined): Promise<void> => {
    if (curatorUserId === null || curatorUserId === undefined) return;

    const user = await users.findActiveUser(curatorUserId);
    if (user === null) {
      throw new AppError('VALIDATION_FAILED', 'Куратор не найден или учётная запись отключена', {
        details: { curatorUserId },
      });
    }
  };

  /** Период обязан помещаться в свой год и не пересекаться с соседями. */
  const assertPeriodFits = async (
    input: { academicYearId: string; startsOn: string; endsOn: string; id?: string },
    executor?: Executor,
  ): Promise<AcademicYearRecord> => {
    const year = await requireYear(input.academicYearId, executor);
    const requested: DateRange = { startsOn: input.startsOn, endsOn: input.endsOn };

    if (!isValidDateRange(requested)) {
      throw new AppError('VALIDATION_FAILED', 'Дата начала периода позже даты окончания');
    }

    const yearRange: DateRange = { startsOn: year.startsOn, endsOn: year.endsOn };
    if (!isRangeInside(requested, yearRange)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Период выходит за границы учебного года (${describeRange(yearRange)})`,
        { details: { period: describeRange(requested), year: describeRange(yearRange) } },
      );
    }

    const periods = await academics.listPeriods(input.academicYearId);
    const conflict = periods.find(
      (period) =>
        period.id !== input.id &&
        rangesOverlap(requested, { startsOn: period.startsOn, endsOn: period.endsOn }),
    );

    if (conflict !== undefined) {
      throw new AppError(
        'CONFLICT',
        `Период пересекается с «${conflict.title}» (${describeRange({
          startsOn: conflict.startsOn,
          endsOn: conflict.endsOn,
        })})`,
        {
          details: {
            conflictId: conflict.id,
            conflict: describeRange({ startsOn: conflict.startsOn, endsOn: conflict.endsOn }),
          },
        },
      );
    }

    return year;
  };

  /** Группа обязана помещаться в границы своего года. */
  const assertGroupFitsYear = async (
    academicYearId: string,
    range: DateRange,
    executor?: Executor,
  ): Promise<void> => {
    const year = await requireYear(academicYearId, executor);

    if (!isValidDateRange(range)) {
      throw new AppError('VALIDATION_FAILED', 'Дата начала позже даты окончания');
    }

    const yearRange: DateRange = { startsOn: year.startsOn, endsOn: year.endsOn };
    if (!isRangeInside(range, yearRange)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Группа выходит за границы учебного года (${describeRange(yearRange)})`,
        { details: { group: describeRange(range), year: describeRange(yearRange) } },
      );
    }
  };

  /** Открытое зачисление: ученик не может числиться в двух группах сразу. */
  const findActiveEnrollment = async (
    studentId: string,
    executor?: Executor,
  ): Promise<EnrollmentRecord | undefined> => {
    const enrollments = await academics.listStudentEnrollments(studentId, executor);
    return enrollments.find((enrollment) => enrollment.leftOn === null);
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

    findStudentForLookup(id) {
      return academics.findStudent(id);
    },

    async namesOfStudents(ids) {
      const unique = [...new Set(ids.filter((id) => id !== ''))];
      const names = new Map<string, string>();

      for (const id of unique) {
        const student = await academics.findStudent(id);
        if (student !== null) names.set(id, student.fullName);
      }

      return names;
    },

    async createStudent(input, options): Promise<StudentRecord> {
      // Учётная запись — по необходимости: карточка ученика нужна всегда, вход в
      // систему не всем. Если учётка запрошена, обе записи создаются одной
      // транзакцией: «ученик без учётки» и «учётка без ученика» — это разные
      // сущности, и связь между ними должна появиться целиком.
      if (input.account !== undefined) {
        if (input.userId !== undefined && input.userId !== null) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Нельзя одновременно привязать существующую учётную запись и создать новую',
            { details: { userId: input.userId } },
          );
        }
      }

      return withTransaction(db, options.executor, async (tx) => {
        let userId = input.userId ?? null;

        // Локальная переменная: внутри транзакции сужение типа для `input.account`
        // теряется, а обращаться к нему нужно несколько раз.
        const account = input.account;

        if (account !== undefined) {
          // Перевод ошибок БД: гонка двух администраторов на один логин должна
          // давать понятный отказ, а не «внутреннюю ошибку сервера».
          const accountUser = await withDatabaseErrors(
            () =>
              users.createUser(
                {
                  username: account.username,
                  password: account.password,
                  fullName: input.fullName,
                  roles: ['student'],
                  ...(account.mustChangePassword === undefined
                    ? {}
                    : { mustChangePassword: account.mustChangePassword }),
                  ...(account.email === undefined ? {} : { email: account.email }),
                  ...(account.phone === undefined ? {} : { phone: account.phone }),
                },
                tx,
              ),
            { unique: `Логин «${account.username}» уже занят` },
          );
          userId = accountUser.id;
        }
        const created = await academics.insertStudent(
          {
            userId,
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
              accountCreated: input.account !== undefined,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async deleteStudent(id, options): Promise<void> {
      const student = await requireStudent(id);

      /**
       * Причина каждого отказа — не «нельзя», а что именно мешает и что делать вместо удаления:
       * иначе администратор ищет обходной путь и правит базу руками.
       */
      if (student.userId !== null) {
        throw new AppError(
          'CONFLICT',
          'У ученика есть учётная запись: отключите её в «Учётных записях», удалять ученика не нужно',
          { details: { studentId: id, userId: student.userId } },
        );
      }

      if (await consents.hasAnyForStudent(id)) {
        throw new AppError(
          'CONFLICT',
          'У ученика есть согласие: запись о согласии должна сохраниться, поэтому ученика нельзя удалить',
          { details: { studentId: id } },
        );
      }

      const enrollments = await academics.listStudentEnrollments(id);
      if (enrollments.length > 0) {
        throw new AppError(
          'CONFLICT',
          'У ученика есть зачисления: сначала отчислите его из групп',
          { details: { studentId: id, enrollments: enrollments.length } },
        );
      }

      await withDatabaseErrors(() => academics.deleteStudent(id), {
        foreignKey: 'На ученика ссылаются другие записи: удаление невозможно',
      });

      await audit.record(
        {
          action: 'delete',
          entityKind: 'student',
          entityId: id,
          before: { fullName: student.fullName, shortName: student.shortName },
        },
        options.actor,
      );
    },

    async createStudentAccount(studentId, input, options): Promise<StudentRecord> {
      const student = await requireStudent(studentId);

      if (student.userId !== null) {
        throw new AppError('CONFLICT', 'У ученика уже есть учётная запись', {
          details: { studentId, userId: student.userId },
        });
      }

      if ((await users.findActiveUserByUsername(input.username)) !== null) {
        throw new AppError('CONFLICT', `Логин «${input.username}» уже занят`, {
          details: { username: input.username },
        });
      }

      return withTransaction(db, options.executor, async (tx) => {
        const account = await withDatabaseErrors(
          () =>
            users.createUser(
              {
                username: input.username,
                password: input.password,
                fullName: student.fullName,
                roles: ['student'],
                /**
                 * Флаг берём из входа: это отдельная операция «выдать учётную запись», и здесь нет
                 * объекта `account` — переменная с этим именем как раз создаётся этим вызовом.
                 */
                ...(input.mustChangePassword === undefined
                  ? {}
                  : { mustChangePassword: input.mustChangePassword }),
              },
              tx,
            ),
          { unique: `Логин «${input.username}» уже занят` },
        );

        const updated = await academics.updateStudent(studentId, { userId: account.id }, tx);
        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Ученик не найден');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'student',
            entityId: studentId,
            before: { userId: null },
            after: { userId: account.id, username: input.username },
            context: { accountCreated: true },
          },
          options.actor,
          tx,
        );

        return updated;
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

    async getAcademicYear(id) {
      return requireYear(id);
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

        if (created.isActive) {
          await academics.deactivateAcademicYears(created.id, tx);
        }

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

    async updateAcademicYear(id, input, options): Promise<AcademicYearRecord> {
      const current = await requireYear(id);
      assertDateRange(input.startsOn ?? current.startsOn, input.endsOn ?? current.endsOn);

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await withDatabaseErrors(
          () => academics.updateAcademicYear(id, input, tx),
          { unique: 'Не удалось изменить учебный год' },
        );

        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Учебный год не найден');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'academic_year',
            entityId: id,
            before: { title: current.title, startsOn: current.startsOn, endsOn: current.endsOn },
            after: input,
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async activateAcademicYear(id, options): Promise<AcademicYearRecord> {
      const current = await requireYear(id);

      return withTransaction(db, options.executor, async (tx) => {
        // Активный год ровно один: выключение остальных и включение выбранного
        // идут в одной транзакции, поэтому промежуточного состояния нет.
        await academics.deactivateAcademicYears(id, tx);
        const updated = await academics.setActiveAcademicYear(id, tx);

        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Учебный год не найден');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'academic_year',
            entityId: id,
            before: { isActive: current.isActive },
            after: { isActive: true },
            context: { activated: true },
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deleteAcademicYear(id, options): Promise<void> {
      const year = await requireYear(id);

      if (year.isActive) {
        throw new AppError(
          'CONFLICT',
          'Активный учебный год удалить нельзя: сначала сделайте активным другой год',
          { details: { academicYearId: id, reason: 'active', usedBy: ['active'] } },
        );
      }

      const groups = await academics.listGroups({ academicYearId: id });
      if (groups.length > 0) {
        throw new AppError('CONFLICT', 'В учебном году есть группы: удаление запрещено', {
          details: {
            academicYearId: id,
            reason: 'groups',
            usedBy: ['groups'],
            count: groups.length,
          },
        });
      }

      return withTransaction(db, options.executor, async (tx) => {
        const deleted = await withDatabaseErrors(() => academics.deleteAcademicYear(id, tx), {
          foreignKey: 'На учебный год ссылаются данные: удаление запрещено',
        });

        if (!deleted) {
          throw new AppError('NOT_FOUND', 'Учебный год не найден');
        }

        await audit.record(
          {
            action: 'delete',
            entityKind: 'academic_year',
            entityId: id,
            before: { title: year.title, startsOn: year.startsOn, endsOn: year.endsOn },
          },
          options.actor,
          tx,
        );
      });
    },

    listPeriods(academicYearId) {
      return academics.listPeriods(academicYearId);
    },

    async createPeriod(input, options): Promise<PeriodRecord> {
      assertDateRange(input.startsOn, input.endsOn);

      return withTransaction(db, options.executor, async (tx) => {
        await assertPeriodFits(input, tx);
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

    async updatePeriod(id, input, options): Promise<PeriodRecord> {
      const current = await academics.findPeriod(id);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Период не найден');
      }

      return withTransaction(db, options.executor, async (tx) => {
        await assertPeriodFits(
          {
            academicYearId: current.academicYearId,
            startsOn: input.startsOn ?? current.startsOn,
            endsOn: input.endsOn ?? current.endsOn,
            id,
          },
          tx,
        );

        const updated = await academics.updatePeriod(id, input, tx);
        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Период не найден');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'period',
            entityId: id,
            before: {
              title: current.title,
              kind: current.kind,
              startsOn: current.startsOn,
              endsOn: current.endsOn,
            },
            after: input,
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deletePeriod(id, options): Promise<void> {
      const current = await academics.findPeriod(id);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Период не найден');
      }

      // Период внутри года свободен: на него пока ничего не ссылается. Когда
      // появятся правила оценок и оценки (Этап 4), проверка занятости встанет
      // здесь же, как у справочников, а внешний ключ с `on delete restrict`
      // подстрахует на уровне базы.
      return withTransaction(db, options.executor, async (tx) => {
        const removed = await academics.deletePeriod(id, tx);
        if (!removed) {
          throw new AppError('NOT_FOUND', 'Период не найден');
        }

        await audit.record(
          {
            action: 'delete',
            entityKind: 'period',
            entityId: id,
            before: {
              academicYearId: current.academicYearId,
              title: current.title,
              kind: current.kind,
              startsOn: current.startsOn,
              endsOn: current.endsOn,
            },
          },
          options.actor,
          tx,
        );
      });
    },

    listGroups(filters) {
      return academics.listGroups(filters);
    },

    getGroup(id) {
      return requireGroup(id);
    },

    async createGroup(input, options): Promise<StudyGroupRecord> {
      assertDateRange(input.startsOn, input.endsOn);
      await assertCurator(input.curatorUserId);

      return withTransaction(db, options.executor, async (tx) => {
        await assertGroupFitsYear(
          input.academicYearId,
          { startsOn: input.startsOn, endsOn: input.endsOn },
          tx,
        );

        const created = await withDatabaseErrors(
          () =>
            academics.insertGroup(
              {
                academicYearId: input.academicYearId,
                name: input.name,
                course: input.course ?? null,
                specialty: input.specialty ?? null,
                curatorUserId: input.curatorUserId ?? null,
                startsOn: input.startsOn,
                endsOn: input.endsOn,
              },
              tx,
            ),
          { unique: `Группа «${input.name}» в этом учебном году уже есть` },
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'study_group',
            entityId: created.id,
            after: {
              academicYearId: created.academicYearId,
              name: created.name,
              course: created.course,
              specialty: created.specialty,
              curatorUserId: created.curatorUserId,
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

    async updateGroup(id, input, options): Promise<StudyGroupRecord> {
      const current = await requireGroup(id);
      await assertCurator(input.curatorUserId);

      return withTransaction(db, options.executor, async (tx) => {
        await assertGroupFitsYear(
          current.academicYearId,
          {
            startsOn: input.startsOn ?? current.startsOn,
            endsOn: input.endsOn ?? current.endsOn,
          },
          tx,
        );

        const updated = await withDatabaseErrors(() => academics.updateGroup(id, input, tx), {
          unique: `Группа с именем «${input.name ?? current.name}» в этом году уже есть`,
        });

        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Группа не найдена');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'study_group',
            entityId: id,
            before: {
              name: current.name,
              course: current.course,
              specialty: current.specialty,
              curatorUserId: current.curatorUserId,
              startsOn: current.startsOn,
              endsOn: current.endsOn,
            },
            after: input,
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deleteGroup(id, options): Promise<void> {
      const group = await requireGroup(id);
      const dependencies = await academics.countGroupDependencies(id);
      const assignmentCount = await assignments.countUsages({ studyGroupId: id });

      const used = describeDependencies({
        assignments: assignmentCount,
        enrollments: dependencies.enrollments,
      });

      if (used.length > 0) {
        throw new AppError('CONFLICT', 'Группа используется: удаление запрещено', {
          details: { studyGroupId: id, reason: 'in_use', usedBy: used },
        });
      }

      return withTransaction(db, options.executor, async (tx) => {
        const deleted = await withDatabaseErrors(() => academics.deleteGroup(id, tx), {
          foreignKey: 'На группу ссылаются данные: удаление запрещено',
        });

        if (!deleted) {
          throw new AppError('NOT_FOUND', 'Группа не найдена');
        }

        await audit.record(
          {
            action: 'delete',
            entityKind: 'study_group',
            entityId: id,
            before: { name: group.name, academicYearId: group.academicYearId },
          },
          options.actor,
          tx,
        );
      });
    },

    listEnrollments(studyGroupId) {
      return academics.listEnrollments(studyGroupId);
    },

    async enrollStudent(studyGroupId, input, options): Promise<EnrollmentRecord> {
      return withTransaction(db, options.executor, async (tx) => {
        const group = await requireGroup(studyGroupId, tx);
        await requireStudent(input.studentId, tx);

        if (
          compareISODates(input.joinedOn, group.startsOn) < 0 ||
          compareISODates(input.joinedOn, group.endsOn) > 0
        ) {
          throw new AppError(
            'VALIDATION_FAILED',
            `Дата зачисления вне периода существования группы (${describeRange({
              startsOn: group.startsOn,
              endsOn: group.endsOn,
            })})`,
            {
              details: {
                joinedOn: input.joinedOn,
                group: describeRange({ startsOn: group.startsOn, endsOn: group.endsOn }),
              },
            },
          );
        }

        const active = await findActiveEnrollment(input.studentId, tx);
        if (active !== undefined) {
          throw new AppError(
            'CONFLICT',
            'Ученик уже числится в группе: сначала отчислите его или оформите перевод',
            {
              details: {
                enrollmentId: active.id,
                studyGroupId: active.studyGroupId,
                joinedOn: active.joinedOn,
              },
            },
          );
        }

        const created = await withDatabaseErrors(
          () =>
            academics.insertEnrollment(
              {
                studentId: input.studentId,
                studyGroupId,
                joinedOn: input.joinedOn,
                note: input.note ?? null,
              },
              tx,
            ),
          { foreignKey: 'Ученик или группа не найдены' },
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'student_enrollment',
            entityId: created.id,
            after: {
              studentId: created.studentId,
              studyGroupId: created.studyGroupId,
              joinedOn: created.joinedOn,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async withdrawStudent(enrollmentId, leftOn, note, options): Promise<EnrollmentRecord> {
      const current = await academics.findEnrollment(enrollmentId);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Зачисление не найдено');
      }
      if (current.leftOn !== null) {
        throw new AppError('CONFLICT', 'Ученик уже отчислен из этой группы', {
          details: { enrollmentId, leftOn: current.leftOn },
        });
      }
      if (compareISODates(leftOn, current.joinedOn) < 0) {
        throw new AppError('VALIDATION_FAILED', 'Дата отчисления раньше даты зачисления', {
          details: { joinedOn: current.joinedOn, leftOn },
        });
      }

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await academics.closeEnrollment(enrollmentId, leftOn, note, tx);
        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Зачисление не найдено');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'student_enrollment',
            entityId: enrollmentId,
            before: { leftOn: current.leftOn, note: current.note },
            after: note === undefined ? { leftOn } : { leftOn, note },
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async transferStudent(studentId, input, options): Promise<EnrollmentRecord> {
      await requireStudent(studentId);

      return withTransaction(db, options.executor, async (tx) => {
        const target = await requireGroup(input.studyGroupId, tx);

        if (
          compareISODates(input.transferOn, target.startsOn) < 0 ||
          compareISODates(input.transferOn, target.endsOn) > 0
        ) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Дата перевода вне периода существования группы',
            {
              details: {
                transferOn: input.transferOn,
                group: describeRange({ startsOn: target.startsOn, endsOn: target.endsOn }),
              },
            },
          );
        }

        const current = await findActiveEnrollment(studentId, tx);

        if (current !== undefined) {
          if (current.studyGroupId === input.studyGroupId) {
            throw new AppError('CONFLICT', 'Ученик уже числится в этой группе', {
              details: { enrollmentId: current.id, studyGroupId: input.studyGroupId },
            });
          }

          if (compareISODates(input.transferOn, current.joinedOn) < 0) {
            throw new AppError('VALIDATION_FAILED', 'Дата перевода раньше даты зачисления', {
              details: { joinedOn: current.joinedOn, transferOn: input.transferOn },
            });
          }
        }

        // Перевод — одна транзакция: закрытие прежнего зачисления и открытие
        // нового не могут разойтись (иначе ученик «потеряется» или удвоится).
        if (current !== undefined) {
          // Примечание не трогаем: причина зачисления относится к записи.
          await academics.closeEnrollment(current.id, input.transferOn, undefined, tx);
        }

        const created = await academics.insertEnrollment(
          {
            studentId,
            studyGroupId: input.studyGroupId,
            joinedOn: input.transferOn,
            note: input.note ?? null,
          },
          tx,
        );

        await audit.record(
          {
            action: 'update',
            entityKind: 'student_enrollment',
            entityId: created.id,
            before:
              current === undefined
                ? undefined
                : { studyGroupId: current.studyGroupId, leftOn: null },
            after: { studyGroupId: created.studyGroupId, joinedOn: created.joinedOn },
            context: {
              transfer: true,
              fromEnrollmentId: current?.id ?? null,
              transferOn: input.transferOn,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    listSubjects() {
      return academics.listSubjects();
    },

    async createSubject(input, options): Promise<SubjectRecord> {
      return withTransaction(db, options.executor, async (tx) => {
        const created = await withDatabaseErrors(
          () =>
            academics.insertSubject(
              {
                name: input.name,
                shortName: input.shortName ?? null,
                kind: input.kind,
                color: input.color ?? null,
              },
              tx,
            ),
          { unique: `Предмет «${input.name}» уже есть в справочнике` },
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'subject',
            entityId: created.id,
            after: {
              name: created.name,
              shortName: created.shortName,
              kind: created.kind,
              color: created.color,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async updateSubject(id, input, options): Promise<SubjectRecord> {
      const current = await academics.findSubject(id);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Предмет не найден');
      }

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await withDatabaseErrors(() => academics.updateSubject(id, input, tx), {
          unique: `Предмет с именем «${input.name ?? current.name}» уже есть`,
        });

        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Предмет не найден');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'subject',
            entityId: id,
            before: {
              name: current.name,
              shortName: current.shortName,
              kind: current.kind,
              color: current.color,
            },
            after: input,
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deleteSubject(id, options): Promise<void> {
      const subjectRecord = await academics.findSubject(id);
      if (subjectRecord === null) {
        throw new AppError('NOT_FOUND', 'Предмет не найден');
      }

      const assignmentCount = await assignments.countUsages({ subjectId: id });

      if (assignmentCount > 0) {
        throw new AppError(
          'CONFLICT',
          `Предмет «${subjectRecord.name}» используется в назначениях: удаление запрещено`,
          {
            details: {
              subjectId: id,
              reason: 'in_use',
              usedBy: ['assignments'],
              count: assignmentCount,
            },
          },
        );
      }

      return withTransaction(db, options.executor, async (tx) => {
        const deleted = await withDatabaseErrors(() => academics.deleteSubject(id, tx), {
          foreignKey: `Предмет «${subjectRecord.name}» используется в журнале: удаление запрещено`,
        });

        if (!deleted) {
          throw new AppError('NOT_FOUND', 'Предмет не найден');
        }

        await audit.record(
          {
            action: 'delete',
            entityKind: 'subject',
            entityId: id,
            before: { name: subjectRecord.name, kind: subjectRecord.kind },
          },
          options.actor,
          tx,
        );
      });
    },

    listRooms() {
      return academics.listRooms();
    },

    async createRoom(input, options): Promise<RoomRecord> {
      return withTransaction(db, options.executor, async (tx) => {
        const created = await withDatabaseErrors(
          () =>
            academics.insertRoom(
              { name: input.name, capacity: input.capacity ?? null, note: input.note ?? null },
              tx,
            ),
          { unique: `Аудитория «${input.name}» уже есть в справочнике` },
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'room',
            entityId: created.id,
            after: { name: created.name, capacity: created.capacity, note: created.note },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async updateRoom(id, input, options): Promise<RoomRecord> {
      const current = await academics.findRoom(id);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Аудитория не найдена');
      }

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await withDatabaseErrors(() => academics.updateRoom(id, input, tx), {
          unique: `Аудитория с именем «${input.name ?? current.name}» уже есть`,
        });

        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Аудитория не найдена');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'room',
            entityId: id,
            before: { name: current.name, capacity: current.capacity, note: current.note },
            after: input,
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deleteRoom(id, options): Promise<void> {
      const roomRecord = await academics.findRoom(id);
      if (roomRecord === null) {
        throw new AppError('NOT_FOUND', 'Аудитория не найдена');
      }

      return withTransaction(db, options.executor, async (tx) => {
        const deleted = await withDatabaseErrors(() => academics.deleteRoom(id, tx), {
          foreignKey: `Аудитория «${roomRecord.name}» используется в расписании: удаление запрещено`,
        });

        if (!deleted) {
          throw new AppError('NOT_FOUND', 'Аудитория не найдена');
        }

        await audit.record(
          {
            action: 'delete',
            entityKind: 'room',
            entityId: id,
            before: { name: roomRecord.name },
          },
          options.actor,
          tx,
        );
      });
    },

    listGradeCategories() {
      return academics.listGradeCategories();
    },

    async syncGradeCategories() {
      let created = 0;

      for (const reason of DEFAULT_GRADE_CATEGORIES) {
        const existing = await academics.findGradeCategoryByCode(reason.code);
        if (existing !== null) continue;

        await academics.insertGradeCategory({
          code: reason.code,
          title: reason.title,
          weight: reason.weight,
          color: null,
          isDefault: true,
        });
        created += 1;
      }

      /**
       * Накопительные знаки: по строке на плюсы и точки. Порог у них обязателен, иначе
       * пересчёт не знает, сколько знаков даёт оценку. Строку, заведённую ранее без
       * порога, дополняем значением по умолчанию.
       */
      for (const sign of ['plus', 'dot'] as const) {
        const existing = await academics.findSignRule(sign);
        if (existing !== null) continue;

        const byCode = await academics.findGradeCategoryByCode(sign === 'plus' ? '+' : '·');
        if (byCode !== null) {
          await academics.updateSignRule(sign, { threshold: DEFAULT_SIGN_THRESHOLD });
          created += 1;
          continue;
        }

        await academics.insertGradeCategory({
          code: sign === 'plus' ? '+' : '·',
          title: SIGN_TITLES[sign],
          weight: 1,
          color: null,
          isDefault: true,
          sign,
          signThreshold: DEFAULT_SIGN_THRESHOLD,
          signRuleActive: false,
        });
        created += 1;
      }

      const all = await academics.listGradeCategories();
      return { created, total: all.length };
    },

    listSignRules() {
      return academics.listSignRules();
    },

    async updateSignRule(sign, input, options) {
      const current = await academics.findSignRule(sign);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Накопительный знак не найден');
      }

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await academics.updateSignRule(sign, input, tx);
        if (updated === null) throw new AppError('NOT_FOUND', 'Накопительный знак не найден');

        await audit.record(
          {
            action: 'update',
            entityKind: 'grade_category',
            entityId: updated.id,
            before: { threshold: current.threshold, isActive: current.isActive },
            after: { threshold: updated.threshold, isActive: updated.isActive },
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async createGradeCategory(input, options): Promise<GradeCategoryRecord> {
      return withTransaction(db, options.executor, async (tx) => {
        const created = await withDatabaseErrors(
          () =>
            academics.insertGradeCategory(
              {
                code: input.code,
                title: input.title,
                weight: input.weight,
                color: input.color ?? null,
                isDefault: input.isDefault,
              },
              tx,
            ),
          { unique: `Категория с кодом «${input.code}» уже есть` },
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'grade_category',
            entityId: created.id,
            after: {
              code: created.code,
              title: created.title,
              weight: created.weight,
              isDefault: created.isDefault,
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async updateGradeCategory(id, input, options): Promise<GradeCategoryRecord> {
      const current = await academics.findGradeCategory(id);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Категория не найдена');
      }

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await withDatabaseErrors(
          () => academics.updateGradeCategory(id, input, tx),
          { unique: 'Не удалось изменить категорию' },
        );

        if (updated === null) {
          throw new AppError('NOT_FOUND', 'Категория не найдена');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'grade_category',
            entityId: id,
            before: {
              title: current.title,
              weight: current.weight,
              color: current.color,
              isDefault: current.isDefault,
            },
            after: input,
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deleteGradeCategory(id, options): Promise<void> {
      const category = await academics.findGradeCategory(id);
      if (category === null) {
        throw new AppError('NOT_FOUND', 'Категория не найдена');
      }

      return withTransaction(db, options.executor, async (tx) => {
        const deleted = await withDatabaseErrors(() => academics.deleteGradeCategory(id, tx), {
          foreignKey: `Категория «${category.title}» используется в оценках: удаление запрещено`,
        });

        if (!deleted) {
          throw new AppError('NOT_FOUND', 'Категория не найдена');
        }

        await audit.record(
          {
            action: 'delete',
            entityKind: 'grade_category',
            entityId: id,
            before: { code: category.code, title: category.title },
          },
          options.actor,
          tx,
        );
      });
    },
  };
}
