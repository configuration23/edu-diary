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
import { buildPrivacyService, createPrivacyModule } from './modules/privacy';
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
import type { Database } from './shared/db/client';
import type { AppEnv } from './shared/env';
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
  const userLookup = {
    async findActiveUser(userId: string) {
      const user = await usersRepository.findById(userId);
      return user === null || !user.isActive ? null : { id: user.id, fullName: user.fullName };
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

  const staffing = buildStaffingService({
    db,
    audit,
    teachers: userLookup,
    catalog: catalogLookup,
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
  await app.register(createAcademicsModule({ academics }), { prefix: '/api' });
  await app.register(createStaffingModule({ staffing }), { prefix: '/api' });
  await app.register(createAuditModule({ audit }), { prefix: '/api' });
  await app.register(createSecurityModule({ security, audit }), { prefix: '/api' });
  await app.register(createPrivacyModule({ privacy }), { prefix: '/api' });
  await app.register(createSettingsModule({ db, settings, audit }), { prefix: '/api' });

  return app;
}
