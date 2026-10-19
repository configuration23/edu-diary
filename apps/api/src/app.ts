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
import { createHomeworkModule } from './modules/homework';
import { createNewsModule } from './modules/news';
import { createHomeworkRepository } from './modules/homework/homework.repository';
import { createAssignmentFileRepository } from './modules/homework/homework.files.repository';
import { createStorageService } from './modules/storage';
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
        mustChangePassword?: boolean;
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
          ...(input.mustChangePassword === undefined
            ? {}
            : { mustChangePassword: input.mustChangePassword }),
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
    /**
     * Согласия: берём у сервиса `privacy`, который собирается ниже.
     *
     * Обращение ленивое — внутри функции: на момент запроса сервис уже создан, а прямой импорт
     * модуля нарушил бы правило «модули не знают друг о друге».
     */
    consents: {
      hasAnyForStudent: async (studentId) =>
        (await privacy.listConsents({ studentId, limit: 1, offset: 0 })).total > 0,
    },
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
    /**
     * Название активного года для подписи расписания.
     *
     * Отдаётся через порт, а не запросом справочника с клиента: справочник годов закрыт правом
     * `academics:read`, и у ученика с представителем год в подписи отсутствовал.
     */
    async activeYearTitle() {
      const years = await academicsRepository.listAcademicYears();

      return years.find((year) => year.isActive)?.title ?? null;
    },
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

  /** Хранилище файлов: адаптер по настройкам, ключи S3 расшифровываются ключом окружения. */
  const storageService = createStorageService(settings, env.storageEncryptionKey);

  /** Вложения заданий: отдельный репозиторий, потому что файл живёт до сохранения задания. */
  const homeworkFiles = createAssignmentFileRepository(db.orm);
  const homeworkRepository = createHomeworkRepository(db.orm);
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

  /**
   * API не кэшируем. Ответы содержат оценки, ФИО и посещаемость: промежуточный кэш или общий
   * компьютер не должны оставлять их после выхода (находка F-10).
   */
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?')[0] ?? '';

    if (path.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store, private');
      reply.header('Pragma', 'no-cache');
    }

    return payload;
  });

  // Сессия: контекст запроса заполняется до маршрутов.
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    request.auth =
      typeof token === 'string' && token !== '' ? await auth.resolveSession(token) : null;
  });

  /**
   * Принудительная смена временного пароля (решение владельца, находка F-03).
   *
   * Пока `mustChangePassword` стоит, разрешены только «свои» маршруты: узнать себя, сменить пароль и
   * выйти. Иначе флаг оставался украшением: человек с выданным паролем работал с системой бессрочно.
   */
  const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
    '/api/auth/me',
    '/api/auth/change-password',
    '/api/auth/logout',
  ]);

  /**
   * Маршруты, без которых приложение не отрисуется: состояние системы, здоровье, оформление.
   *
   * Гейт временного пароля не должен ломать загрузку экрана: иначе человек видит «не удалось
   * получить состояние системы» вместо просьбы сменить пароль (дефект, найденный владельцем).
   */
  const PASSWORD_CHANGE_ALLOWED_PREFIXES = ['/api/setup/', '/api/health', '/api/settings/'];

  app.addHook('onRequest', async (request) => {
    const auth = request.auth;
    if (auth === null || !auth.mustChangePassword) return;

    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;
    if (PASSWORD_CHANGE_ALLOWED_PATHS.has(path)) return;
    if (PASSWORD_CHANGE_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return;

    throw new AppError('FORBIDDEN', 'Сначала смените временный пароль', {
      details: { reason: 'PASSWORD_CHANGE_REQUIRED' },
    });
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
      /**
       * Состав группы на дату: отчёту аналитики нужен список учеников группы.
       * Берём именно состав на дату, а не текущий, — как в журнале урока.
       */
      async studentsOfGroup(studyGroupId, onDate) {
        const enrollments = await academicsRepository.listEnrollments(studyGroupId);
        const active = enrollments.filter(
          (enrollment) =>
            enrollment.joinedOn <= onDate &&
            (enrollment.leftOn === null || enrollment.leftOn >= onDate),
        );

        return active.map((enrollment) => ({ studentId: enrollment.studentId }));
      },
    }),
    { prefix: '/api' },
  );

  /**
   * Домашние задания. Права и правила живут в сервисе модуля, а сюда передаются порты:
   * поиск урока (по нему определяются права), уроки группы на дату и предельная
   * длительность задания из настроек.
   */
  /**
   * Новости заведения (Этап 6).
   *
   * Адаптер хранилища берём **тот же**, что у домашних заданий: картинки лежат там же, где
   * вложения заданий, и переключаются вместе с ними одной настройкой хранилища.
   */
  await app.register(
    createNewsModule({
      db,
      audit,
      storageAdapter: () => storageService.adapter(),
      storageLimits: () => storageService.readSettings(),
    }),
    /** Префикс обязателен: без него маршруты встанут в корень и не найдутся клиентом. */
    { prefix: '/api' },
  );

  await app.register(
    createHomeworkModule({
      db,
      audit,
      /**
       * getLesson бросает NOT_FOUND на неизвестный урок, а модулю нужен 
ull: он сам
       * решает, показать 404 или отказать в правке чужого задания неотличимо.
       */
      async findLesson(lessonId) {
        try {
          return await schedule.getLesson(lessonId);
        } catch {
          return null;
        }
      },
      /**
       * Уроки группы на дату: нужны, чтобы понять, в каких уроках видно задание.
       * Берём из сервиса расписания — он уже умеет это с проверками.
       */
      async listLessonsForGroup(studyGroupId, from, to) {
        const result = await schedule.listLessons({
          studyGroupId,
          from,
          to,
          limit: 200,
          offset: 0,
        });
        return result.items;
      },
      /** Группы ученика и его представителей: ученик видит задания только своих групп. */
      /**
       * Чьё это задание и чей ученик смотрит.
       *
       * Ученик получает задание своей группы; представитель видит работу ребёнка, но **не**
       * сдаёт за него — поэтому studentId возвращается только для собственной карточки.
       */
      async resolveStudentAccess({ viewerUserId, scope: staffScope, assignmentId }) {
        const assignment = await homeworkRepository.findAssignment(assignmentId);
        if (assignment === null) return null;

        const staffAllowed =
          staffScope === 'all' ||
          (staffScope === 'assigned' &&
            (await homeworkRepository.isTeacherOfLesson(assignment.lessonId, viewerUserId)));

        const own = await academicsRepository.findStudentByUserId(viewerUserId);
        const children = await guardiansRepository.studentIdsOfGuardian(viewerUserId);
        const visibleStudents = new Set<string>([...(own === null ? [] : [own.id]), ...children]);

        const isOwnGroup = (await scheduleCatalog.groupsOfViewer(viewerUserId)).some(
          (group) => group.id === assignment.studyGroupId,
        );

        if (!staffAllowed && !isOwnGroup) return null;
        if (visibleStudents.size === 0 && !staffAllowed) return null;

        /** Сдавать может только ученик со своей карточкой; представитель — только смотрит. */
        const canSubmitAs = own !== null && isOwnGroup ? own.id : null;

        return { assignment, studentId: canSubmitAs };
      },
      /** Урок задания: по нему проверяется право на список сдавших. */
      async findAssignmentLesson(assignmentId) {
        const assignment = await homeworkRepository.findAssignment(assignmentId);
        return assignment?.lessonId ?? null;
      },
      storageAdapter: () => storageService.adapter(),
      storageLimits: () => storageService.readSettings(),
      /**
       * Право на файл: администратору — любой, преподавателю — файл своего урока, ученику и
       * представителю — файл задания своей группы. Чужой файл отвечает 404 (см. маршрут).
       */
      async mayReadFile({ viewerUserId, scope, fileId }) {
        const file = await homeworkFiles.findById(fileId);
        if (file === null || file.assignmentId === null) {
          // Незавершённая загрузка: видеть её может только автор.
          return file !== null && file.uploadedBy === viewerUserId;
        }

        const assignment = await homeworkRepository.findAssignment(file.assignmentId);
        if (assignment === null) return false;

        /**
         * Преподавателю файл доступен, если это **его** урок: чужое занятие он не видит и
         * здесь — правило то же, что в журнале. Администратору (ll) доступно всё.
         */
        if (scope === 'all' || scope === 'assigned') {
          if (scope === 'all') return true;
          return homeworkRepository.isTeacherOfLesson(assignment.lessonId, viewerUserId);
        }

        const groups = await scheduleCatalog.groupsOfViewer(viewerUserId);
        return groups.some((group) => group.id === assignment.studyGroupId);
      },
      /**
       * Состав группы **на дату**: таблица сданных работ строится по нему.
       *
       * Берём состав на дату урока-срока: проверяют тех, кто был в группе тогда, а не тех,
       * кто в ней сейчас.
       */
      async studentsOfGroup(studyGroupId, onDate) {
        const enrollments = await academicsRepository.listEnrollments(studyGroupId);
        const active = enrollments.filter(
          (enrollment) =>
            enrollment.joinedOn <= onDate &&
            (enrollment.leftOn === null || enrollment.leftOn >= onDate),
        );

        const found = await academicsRepository.listStudents({
          search: undefined,
          limit: 500,
          offset: 0,
        });

        /**
         * Оставляем только тех, кто был в группе на дату: listStudents даёт весь
         * справочник, а состав группы задают зачисления.
         */
        const activeIds = new Set(active.map((enrollment) => enrollment.studentId));

        return found.items
          .filter((item) => activeIds.has(item.id))
          .map((item) => ({ studentId: item.id, studentName: item.fullName }));
      },
      groupIdsOfViewer: async (userId) => {
        const groups = await scheduleCatalog.groupsOfViewer(userId);
        return groups.map((group) => group.id);
      },
    }),
    { prefix: '/api' },
  );
  await app.register(createAuditModule({ audit }), { prefix: '/api' });
  await app.register(createSecurityModule({ security, audit }), { prefix: '/api' });
  await app.register(createPrivacyModule({ privacy }), { prefix: '/api' });
  await app.register(createSettingsModule({ db, settings, audit, storage: storageService }), {
    prefix: '/api',
  });

  return app;
}
