import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  buildAcademicsService,
  createAcademicsModule,
  createAcademicsRepository,
} from './modules/academics';
import { buildAuditService, createAuditModule } from './modules/audit';
import { buildAuthService, createAuthModule, SESSION_COOKIE_NAME } from './modules/auth';
import { createHealthModule } from './modules/health';
import { buildIamServices, createIamModule, type SessionRevokerPort } from './modules/iam';
import { createGuardiansRepository } from './modules/iam/iam.guardians.repository';
import { createUsersRepository } from './modules/iam/iam.users.repository';
import type { UsersService } from './modules/iam/iam.users.service';
import {
  buildJournalService,
  createJournalModule,
  createJournalRepository,
} from './modules/journal';
import { buildPrivacyService, createPrivacyModule } from './modules/privacy';
import {
  buildScheduleService,
  createScheduleModule,
  type CatalogLookupPort as ScheduleCatalogPort,
  type UserLookupPort as ScheduleUserPort,
} from './modules/schedule';
import { buildSecurityService, createSecurityModule } from './modules/security';
import {
  createSettingsModule,
  createSettingsRepository,
  createSettingsService,
} from './modules/settings';
import {
  buildStaffingService,
  createStaffingModule,
  createStaffingRepository,
} from './modules/staffing';
import {
  buildSetupService,
  createSetupModule,
  createSystemState,
  type SystemState,
} from './modules/setup';
import type { Database, Executor } from './shared/db/client';
import type { AppEnv } from './shared/env';
import { SYSTEM_ACTOR } from './shared/actor';
import { AppError, registerErrorHandling } from './shared/errors';
import { createLoggerOptions, resolveRequestId } from './shared/logger';
import { createPasswordHasher } from './shared/password-hasher';
import { applicationVersion } from './shared/paths';

/**
 * Сборка приложения: инфраструктура → модули.
 *
 * Зависимости передаются явно, поэтому приложение целиком поднимается в тестах
 * без сети и без глобального состояния. Два кольца разорваны портами:
 * `academics` получает доступ к привязкам родителей репозиторием, а `iam` —
 * отзыв сессий сервисом `auth` через ленивую ссылку (отзыв происходит в момент
 * запроса, когда оба сервиса уже собраны).
 */

export interface BuildAppOptions {
  env: AppEnv;
  db: Database;
  version?: string;
  /** Состояние настройки: в тестах подменяется, чтобы не ходить в базу. */
  systemState?: SystemState;
}

/** Пути, доступные до прохождения мастера настройки. */
const SETUP_EXEMPT_PATHS = new Set(['/api/health']);

export async function buildApp({
  env,
  db,
  version,
  systemState: providedState,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLoggerOptions(env),
    genReqId: (request) => resolveRequestId(request.headers['x-request-id']),
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024,
  });

  await app.register(cookie);

  const settings = createSettingsService(createSettingsRepository(db));
  const audit = buildAuditService(db);
  const security = buildSecurityService(db);
  const hasher = createPasswordHasher();

  // Порт доступа к привязкам родителей: репозиторий вместо сервиса iam, иначе
  // сборка зависимостей замкнулась бы в кольцо.
  const guardiansRepository = createGuardiansRepository(db);
  // Порт «справочник используется в назначениях»: отвечает модуль staffing.
  const staffingRepository = createStaffingRepository(db);
  // Порт проверки пользователя (куратор группы, преподаватель): репозиторий iam.
  const usersRepository = createUsersRepository(db);
  // Учётные записи создаёт сервис iam: политика паролей и роли живут там.
  // Ленивая ссылка, потому что сервис собирается ниже (кольцо зависимостей).
  let usersService: UsersService | null = null;
  const userLookup = {
    async findActiveUser(userId: string) {
      const user = await usersRepository.findById(userId);
      return user === null || !user.isActive ? null : { id: user.id, fullName: user.fullName };
    },
    async findActiveUserByUsername(username: string) {
      const user = await usersRepository.findByUsername(username);
      return user === null ? null : { id: user.id };
    },
    async findUsernames(userIds: readonly string[]) {
      return usersRepository.findUsernamesByIds(userIds);
    },
    createUser(
      input: {
        username: string;
        password: string;
        fullName: string;
        roles: readonly string[];
        email?: string;
        phone?: string;
      },
      executor?: Executor,
    ) {
      if (usersService === null) {
        throw new Error('Сервис пользователей ещё не собран — создание учётной записи недоступно');
      }

      return usersService.create(
        {
          username: input.username,
          password: input.password,
          fullName: input.fullName,
          roles: [...input.roles],
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
        },
        { actor: SYSTEM_ACTOR, executor },
      );
    },
    async findActiveTeacher(userId: string) {
      const user = await usersRepository.findById(userId);
      if (user === null || !user.isActive) return null;

      const isTeacher = user.roles.some((role) => role.code === 'teacher');
      return isTeacher ? { id: user.id, fullName: user.fullName } : null;
    },
  };
  // Порт справочников для назначений: читает репозиторий academics.
  const academicsRepository = createAcademicsRepository(db);
  const catalogLookup = {
    findGroup: (id: string) => academicsRepository.findGroup(id),
    findSubject: (id: string) => academicsRepository.findSubject(id),
  };

  const academics = buildAcademicsService({
    db,
    audit,
    security,
    guardians: guardiansRepository,
    assignments: staffingRepository,
    users: userLookup,
  });

  /**
   * Причины оценок «из коробки»: недостающие добавляются, изменённые заведением
   * не перезаписываются. Так журнал работает сразу после установки, а справочник
   * остаётся принадлежащим заведению.
   *
   * Ошибку не пробрасываем: без справочника приложение обязано стартовать — иначе
   * не поднять даже мастер настройки, который её и починит. Причины — данные, а не
   * условие работы (в тестах сборки приложения базы может не быть вовсе).
   */
  try {
    await academics.syncGradeCategories();
  } catch (error) {
    app.log.warn({ err: error }, 'причины оценок не синхронизированы: проверьте миграции');
  }

  const staffing = buildStaffingService({
    db,
    audit,
    teachers: userLookup,
    catalog: catalogLookup,
  });

  /**
   * Расписание и уроки (Этап 3).
   *
   * Порты собираются здесь: расписанию нужны назначения и группы (без импорта
   * модулей `staffing`/`academics`), а также имена преподавателей.
   */
  const scheduleCatalog: ScheduleCatalogPort = {
    async findAssignment(id) {
      const assignment = await staffingRepository.find(id);
      if (assignment === null) return null;

      return {
        id: assignment.id,
        teacherUserId: assignment.teacherUserId,
        subjectId: assignment.subjectId,
        studyGroupId: assignment.studyGroupId,
        startsOn: assignment.startsOn,
        endsOn: assignment.endsOn,
        subjectName: assignment.subjectName,
        groupName: assignment.groupName,
      };
    },
    async findAssignmentForGroupSubject(studyGroupId, subjectId, date) {
      // Действующее назначение на дату: у одного предмета в группе оно одно
      // (ADR-030), поэтому берём первое подходящее по периоду действия.
      const assignments = await staffingRepository.listByGroup(studyGroupId);
      const found = assignments.find(
        (assignment) =>
          assignment.subjectId === subjectId &&
          assignment.startsOn <= date &&
          (assignment.endsOn === null || assignment.endsOn >= date),
      );

      if (found === undefined) return null;

      return {
        id: found.id,
        teacherUserId: found.teacherUserId,
        subjectId: found.subjectId,
        studyGroupId: found.studyGroupId,
        startsOn: found.startsOn,
        endsOn: found.endsOn,
        subjectName: found.subjectName,
        groupName: found.groupName,
      };
    },
    async findRoom(id) {
      const room = await academicsRepository.findRoom(id);
      return room === null ? null : { id: room.id, name: room.name };
    },
    async findGroup(id) {
      const group = await academicsRepository.findGroup(id);
      return group === null ? null : { id: group.id, name: group.name };
    },
    async findGroups(ids) {
      const groups = await academicsRepository.listGroups({ ids });
      return groups.map((group) => ({ id: group.id, name: group.name }));
    },
    async groupsOfViewer(userId) {
      // Ученик приходит своей учётной записью, родитель — через привязку к
      // ученику: связь живёт в `iam`, поэтому спрашиваем её портом (ADR-031).
      const own = await academicsRepository.findStudentByUserId(userId);
      const studentIds = new Set<string>();
      if (own !== null) studentIds.add(own.id);
      for (const id of await guardiansRepository.studentIdsOfGuardian(userId)) studentIds.add(id);

      return academicsRepository.listGroupsForStudents([...studentIds]);
    },
  };
  const scheduleUsers: ScheduleUserPort = {
    findActiveUser: (userId) => userLookup.findActiveUser(userId),
    findActiveTeacher: (userId) => userLookup.findActiveTeacher(userId),
    async listActiveTeachers() {
      // Преподаватели для подбора заменяющего: берём активные учётные записи с
      // ролью преподавателя через тот же список пользователей, что и в фильтрах.
      const users = await usersRepository.list({ isActive: true, limit: 500, offset: 0 });
      return users.items
        .filter((user) => user.roles.some((role) => role.code === 'teacher'))
        .map((user) => ({ id: user.id, fullName: user.fullName }));
    },
    async findUsers(userIds) {
      const users = await usersRepository.findUsernamesByIds([...userIds]);
      void users;
      const names = new Map<string, string>();
      for (const id of userIds) {
        const found = await usersRepository.findById(id);
        if (found !== null) names.set(id, found.fullName);
      }
      return names;
    },
  };

  const schedule = buildScheduleService({
    db,
    audit,
    catalog: scheduleCatalog,
    users: scheduleUsers,
  });

  /**
   * Журнал (оценки и посещаемость). Порт расписания отдаёт урок и состав
   * смотрящего: модуль журнала не знает ни о таблице уроков, ни о зачислениях.
   */
  const journal = buildJournalService({
    db,
    audit,
    journal: createJournalRepository(db),
    schedule: {
      async findLesson(id) {
        const lesson = await schedule.getLesson(id);
        if (lesson === null) return null;

        const [group, subject] = await Promise.all([
          academicsRepository.findGroup(lesson.studyGroupId),
          academicsRepository.findSubject(lesson.subjectId),
        ]);
        const teacher = await userLookup.findActiveUser(lesson.teacherUserId);

        return {
          id: lesson.id,
          lessonDate: lesson.lessonDate,
          pairNumber: lesson.pairNumber,
          timeStart: lesson.timeStart,
          timeEnd: lesson.timeEnd,
          studyGroupId: lesson.studyGroupId,
          groupName: group?.name ?? lesson.groupName,
          subjectId: lesson.subjectId,
          subjectName: subject?.name ?? lesson.subjectName,
          teacherUserId: lesson.teacherUserId,
          teacherName: teacher?.fullName ?? '',
          topic: lesson.topic,
          status: lesson.status,
        };
      },
      async groupsOfViewer(userId) {
        const own = await academicsRepository.findStudentByUserId(userId);
        const studentIds = new Set<string>();
        if (own !== null) studentIds.add(own.id);
        for (const id of await guardiansRepository.studentIdsOfGuardian(userId)) {
          studentIds.add(id);
        }

        const groups = await academicsRepository.listGroupsForStudents([...studentIds]);
        return groups.map((group) => group.id);
      },
      async studentIdOfUser(userId) {
        const student = await academicsRepository.findStudentByUserId(userId);
        return student?.id ?? null;
      },
      studentIdsOfGuardian: (userId) => guardiansRepository.studentIdsOfGuardian(userId),
    },
    /**
     * Пороги накопительных знаков ведёт учебный процесс, поэтому журнал спрашивает
     * их через порт: прямых импортов между модулями нет.
     *
     * В базе знак лежит строкой, а журналу нужны только два известных значения:
     * посторонние строки отбрасываем — они не знаки, а мусор в справочнике.
     */
    signRules: {
      async listSignRules() {
        const rules = await academics.listSignRules();

        return rules.flatMap((rule) =>
          rule.sign === 'plus' || rule.sign === 'dot'
            ? [
                {
                  id: rule.id,
                  sign: rule.sign,
                  categoryId: rule.categoryId,
                  categoryTitle: rule.categoryTitle,
                  threshold: rule.threshold,
                  isActive: rule.isActive,
                },
              ]
            : [],
        );
      },
    },
  });

  let authService: SessionRevokerPort | null = null;
  const sessionsPort: SessionRevokerPort = {
    revokeUserSessions(userId, options, executor) {
      if (authService === null) {
        throw new Error('Сервис сессий ещё не собран — отзыв возможен только во время запроса');
      }
      return authService.revokeUserSessions(userId, options, executor);
    },
  };

  const iam = buildIamServices({ db, audit, security, hasher, academics, sessions: sessionsPort });
  // Ссылка для порта создания учётных записей (в том числе ученикам).
  usersService = iam.users;

  const auth = buildAuthService({ db, users: iam.users, audit, hasher });
  authService = auth;

  const privacy = buildPrivacyService({
    db,
    settings,
    academics,
    guardians: iam.guardians,
    users: iam.users,
    audit,
  });
  const setup = buildSetupService({
    db,
    settings,
    users: iam.users,
    roles: iam.roles,
    academics,
    audit,
  });
  const systemState = providedState ?? createSystemState(settings);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Сессия: контекст запроса заполняется до маршрутов.
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    request.auth =
      typeof token === 'string' && token !== '' ? await auth.resolveSession(token) : null;
  });

  // Гейт «система не настроена»: всё, кроме health и мастера, отвечает 503 (ADR-014).
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? '';

    if (!path.startsWith('/api/')) return;
    if (SETUP_EXEMPT_PATHS.has(path)) return;
    if (path.startsWith('/api/setup/')) return;

    if (!(await systemState.isInitialized())) {
      throw new AppError(
        'SETUP_REQUIRED',
        'Система не настроена: пройдите мастер первого запуска (/api/setup/status)',
      );
    }
  });

  registerErrorHandling(app);

  await app.register(
    createHealthModule({ db, settings, version: version ?? applicationVersion() }),
    {
      prefix: '/api',
    },
  );
  await app.register(createSetupModule({ setup, auth }), { prefix: '/api' });
  await app.register(createAuthModule({ auth }), { prefix: '/api' });
  await app.register(createIamModule({ services: iam }), { prefix: '/api' });
  await app.register(createAcademicsModule({ academics, users: userLookup }), { prefix: '/api' });
  await app.register(createStaffingModule({ staffing }), { prefix: '/api' });
  await app.register(
    createScheduleModule({ schedule, catalog: scheduleCatalog, users: scheduleUsers }),
    {
      prefix: '/api',
    },
  );
  await app.register(
    createJournalModule({
      db,
      audit,
      journal,
      async isOwnStudent(viewerUserId, studentId) {
        const own = await academicsRepository.findStudentByUserId(viewerUserId);
        if (own?.id === studentId) return true;
        const children = await guardiansRepository.studentIdsOfGuardian(viewerUserId);
        return children.includes(studentId);
      },
      async studentsOfViewer(viewerUserId) {
        const own = await academicsRepository.findStudentByUserId(viewerUserId);
        const studentIds = new Set<string>();
        if (own !== null) studentIds.add(own.id);
        for (const id of await guardiansRepository.studentIdsOfGuardian(viewerUserId)) {
          studentIds.add(id);
        }
        return [...studentIds];
      },
    }),
    { prefix: '/api' },
  );

  await app.register(createAuditModule({ audit }), { prefix: '/api' });
  await app.register(createSecurityModule({ security, audit }), { prefix: '/api' });
  await app.register(createPrivacyModule({ privacy }), { prefix: '/api' });
  await app.register(createSettingsModule({ db, settings, audit }), { prefix: '/api' });

  return app;
}
