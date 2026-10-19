import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { validatePassword } from '@edu-diary/domain';

import type { AuditActor } from '../../shared/actor';
import type { AuthContext } from '../../shared/auth-context';
import type { Database, Executor } from '../../shared/db/client';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { PasswordHasher } from '../../shared/password-hasher';
import type { AuditService } from '../audit';
import type { SessionRevokerPort, UsersService } from '../iam';
import type { AuthRepository, SessionRecord } from './auth.repository';

/** Сколько часов должно пройти между сменами пароля самим человеком (решение владельца). */
export const PASSWORD_CHANGE_MIN_INTERVAL_HOURS = 6;

/**
 * Вход, серверные сессии и смена пароля (ADR-004, SECURITY.md §3.1).
 *
 * В базе лежит только хеш токена: украденная копия базы не даёт войти. Cookie —
 * `httpOnly` + `SameSite=Lax`; признак `Secure` выставляется, если запрос пришёл
 * по HTTPS (за Caddy), поэтому стенд по HTTP продолжает работать.
 */

export const SESSION_COOKIE_NAME = 'edu_diary_session';
/**
 * Срок жизни сессии — два таймера (решение владельца).
 *
 * Простой: без запросов сессия умирает через 30 минут. Продление при активности пишется в базу не
 * чаще раза в 5 минут: иначе каждый запрос стоил бы обновления строки.
 */
export const SESSION_IDLE_MINUTES = 30;
export const SESSION_RENEW_AFTER_MINUTES = 5;

/** Абсолютный предел: сотрудник — 12 часов, ученик и представитель — 30 дней. */
export const SESSION_ABSOLUTE_HOURS_STAFF = 12;
export const SESSION_ABSOLUTE_DAYS_LEARNER = 30;

/**
 * Абсолютный срок по ролям.
 *
 * Сотрудник работает в кабинете и перелогинится не в тягость; ученик заходит с телефона, и 12 часов
 * означали бы вход каждый день. Роли проверяются по кодам: право тут ни при чём.
 */
export function sessionAbsoluteExpiry(createdAt: Date, roleCodes: readonly string[]): Date {
  const isLearner = roleCodes.some((code) => code === 'student' || code === 'parent');
  const ms = isLearner
    ? SESSION_ABSOLUTE_DAYS_LEARNER * 24 * 3_600_000
    : SESSION_ABSOLUTE_HOURS_STAFF * 3_600_000;

  return new Date(createdAt.getTime() + ms);
}

/** Простой: сейчас плюс 30 минут, но не позже абсолютного предела. */
export function sessionIdleExpiry(now: Date, absoluteExpiresAt: Date): Date {
  const idle = new Date(now.getTime() + SESSION_IDLE_MINUTES * 60_000);

  return idle.getTime() < absoluteExpiresAt.getTime() ? idle : absoluteExpiresAt;
}

export interface SessionMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface LoginInput {
  username: string;
  password: string;
  meta: SessionMeta;
}

/** Сессия для списка «Устройства и входы»: без токена и без хеша. */
export interface SessionSummary {
  id: string;
  /** Человеческая подпись устройства: «Chrome · Windows». */
  device: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** Истечёт от простоя. */
  expiresAt: string;
  /** Жёсткий предел: его активность не продлевает. */
  absoluteExpiresAt: string;
  /** Текущая сессия: её нельзя «завершить» отдельной кнопкой. */
  current: boolean;
}

/**
 * Подпись устройства из User-Agent.
 *
 * Это **не** отпечаток браузера: только грубая подпись для списка, чтобы человек узнал своё
 * устройство. Хранится и отдаётся сам User-Agent, как и раньше.
 */
export function describeDevice(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === '') return 'Неизвестное устройство';

  const browser =
    [
      ['Edg', 'Edge'],
      ['YaBrowser', 'Яндекс.Браузер'],
      ['OPR', 'Opera'],
      ['Firefox', 'Firefox'],
      ['Chrome', 'Chrome'],
      ['Safari', 'Safari'],
    ].find(([token]) => userAgent.includes(token as string))?.[1] ?? 'Браузер';

  const os =
    [
      ['Android', 'Android'],
      ['iPhone', 'iPhone'],
      ['iPad', 'iPad'],
      ['Windows', 'Windows'],
      ['Mac OS X', 'macOS'],
      ['Linux', 'Linux'],
    ].find(([token]) => userAgent.includes(token as string))?.[1] ?? '';

  return os === '' ? browser : `${browser} · ${os}`;
}

export interface LoginResult {
  token: string;
  auth: AuthContext;
  /** Когда истечёт от простоя. */
  expiresAt: Date;
  /** Жёсткий предел сессии: его активность не продлевает. */
  absoluteExpiresAt: Date;
}

export interface AuthService extends SessionRevokerPort {
  login(input: LoginInput): Promise<LoginResult>;
  /** Возвращает контекст по токену cookie; null — сессии нет или она истекла. */
  resolveSession(token: string): Promise<AuthContext | null>;
  logout(token: string, actor: AuditActor): Promise<void>;
  /** Смена темы оформления: своя учётная запись, права администратора не нужны. */
  changeTheme(userId: string, theme: 'light' | 'dark' | 'system'): Promise<void>;
  /** Вид страниц: своя учётная запись. */
  changeViewMode(userId: string, viewMode: 'compact' | 'expanded'): Promise<void>;

  changePassword(
    input: { userId: string; sessionId: string; currentPassword: string; newPassword: string },
    actor: AuditActor,
  ): Promise<void>;
  /** Создать сессию без пароля: используется мастером настройки. */
  createSessionFor(userId: string, meta: SessionMeta, executor?: Executor): Promise<LoginResult>;

  /** Свои активные сессии: блок «Устройства и входы» в профиле. */
  listSessions(userId: string, currentSessionId: string): Promise<SessionSummary[]>;
  /** Завершить свою сессию; чужую — нельзя (вернётся «не найдено»). */
  revokeSession(userId: string, sessionId: string, actor: AuditActor): Promise<void>;
  /** Завершить все свои сессии, кроме текущей. */
  revokeOtherSessions(userId: string, currentSessionId: string, actor: AuditActor): Promise<number>;
}

export interface AuthServiceDependencies {
  db: Database;
  sessions: AuthRepository;
  users: UsersService;
  audit: AuditService;
  hasher: PasswordHasher;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Сравнение постоянного времени: не подсказывает длину совпавшего префикса. */
function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAuthService(dependencies: AuthServiceDependencies): AuthService {
  const { db, sessions, users, audit, hasher } = dependencies;

  const buildContext = async (sessionRecord: SessionRecord): Promise<AuthContext | null> => {
    const user = await users.getById(sessionRecord.userId);
    if (user === null || !user.isActive) return null;

    const access = await users.resolveAccess(user.id);

    return {
      sessionId: sessionRecord.id,
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      theme: user.theme as 'light' | 'dark' | 'system',
      viewMode: user.viewMode as 'compact' | 'expanded',
      roles: access.roles.map((role) => ({ code: role.code, title: role.title })),
      permissions: access.permissions,
    };
  };

  const startSession = async (
    userId: string,
    meta: SessionMeta,
    executor: Executor | undefined,
    roleCodes: readonly string[] = [],
  ): Promise<LoginResult> => {
    const token = createToken();
    const now = new Date();
    const absoluteExpiresAt = sessionAbsoluteExpiry(now, roleCodes);
    const expiresAt = sessionIdleExpiry(now, absoluteExpiresAt);

    const record = await sessions.insert(
      {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        absoluteExpiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
      executor,
    );

    const auth = await buildContext(record);
    if (auth === null) {
      throw new AppError('FORBIDDEN', 'Учётная запись отключена');
    }

    return { token, auth, expiresAt, absoluteExpiresAt };
  };

  const service: AuthService = {
    async login(input): Promise<LoginResult> {
      const user = await users.findByUsername(input.username);

      if (user === null) {
        // Выравниваем время ответа: иначе по задержке видно, есть ли учётка.
        await hasher.verifyDummy(input.password);
        throw new AppError('UNAUTHORIZED', 'Неверный логин или пароль');
      }

      if (!user.isActive) {
        throw new AppError('FORBIDDEN', 'Учётная запись отключена');
      }

      if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
        /**
         * Срок сообщаем числом: «попробуйте позже» человек читает как «может, сейчас». Задержка
         * растёт с каждой неудачей (5, 10, 20, 40 минут), поэтому без цифры непонятно, чего ждать.
         */
        const retryAfterMinutes = Math.max(
          1,
          Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000),
        );

        throw new AppError(
          'RATE_LIMITED',
          `Слишком много неудачных попыток входа. Повторите через ${retryAfterMinutes} мин`,
          { details: { retryAfterMinutes } },
        );
      }

      const passwordMatches = await hasher.verify(user.passwordHash, input.password);

      if (!passwordMatches) {
        const actor: AuditActor = {
          userId: user.id,
          name: user.fullName,
          ip: input.meta.ip,
        };

        await users.registerFailedLogin(user.id, { actor });
        throw new AppError('UNAUTHORIZED', 'Неверный логин или пароль');
      }

      const actor: AuditActor = { userId: user.id, name: user.fullName, ip: input.meta.ip };
      const result = await withTransaction(db, undefined, async (tx) => {
        await users.registerSuccessfulLogin(user.id, actor, tx);
        const roleCodes = (await users.resolveAccess(user.id)).roles.map((role) => role.code);

        return startSession(user.id, input.meta, tx, roleCodes);
      });

      return result;
    },

    async resolveSession(token: string): Promise<AuthContext | null> {
      if (token === '') return null;

      const tokenHash = hashToken(token);
      const record = await sessions.findByTokenHash(tokenHash);
      if (record === null) return null;

      if (!tokensEqual(record.tokenHash, tokenHash)) return null;

      if (record.expiresAt.getTime() <= Date.now()) {
        await sessions.deleteByTokenHash(tokenHash);
        return null;
      }

      const auth = await buildContext(record);
      if (auth === null) {
        await sessions.deleteByTokenHash(tokenHash);
        return null;
      }

      const renewAfter = SESSION_RENEW_AFTER_MINUTES * 60_000;
      if (Date.now() - record.lastSeenAt.getTime() > renewAfter) {
        /** Активность продлевает простой, но **не** абсолютный предел. */
        await sessions.renew(record.id, sessionIdleExpiry(new Date(), record.absoluteExpiresAt));
      }

      return auth;
    },

    async logout(token, actor): Promise<void> {
      if (token === '') return;

      const tokenHash = hashToken(token);
      await sessions.deleteByTokenHash(tokenHash);

      await audit.record({ action: 'logout', entityKind: 'user', entityId: actor.userId }, actor);
    },
    async changeTheme(userId, theme): Promise<void> {
      await users.setTheme(userId, theme);
    },

    async changeViewMode(userId, viewMode): Promise<void> {
      await users.setViewMode(userId, viewMode);
    },

    async changePassword(input, actor): Promise<void> {
      const user = await users.getById(input.userId);
      if (user === null) {
        throw new AppError('UNAUTHORIZED', 'Требуется вход в систему');
      }

      const matches = await hasher.verify(user.passwordHash, input.currentPassword);
      if (!matches) {
        throw new AppError('UNAUTHORIZED', 'Неверный текущий пароль');
      }

      /**
       * Частоту смены ограничиваем (решение владельца): не чаще одного раза в 6 часов.
       *
       * Отметку снимает только сброс пароля администратором — иначе человек не смог бы войти с
       * выданным паролем.
       */
      if (user.passwordChangedAt !== null) {
        const limitMs = PASSWORD_CHANGE_MIN_INTERVAL_HOURS * 60 * 60 * 1000;
        const elapsedMs = Date.now() - user.passwordChangedAt.getTime();

        if (elapsedMs < limitMs) {
          const retryAfterMinutes = Math.max(1, Math.ceil((limitMs - elapsedMs) / 60_000));

          throw new AppError(
            'RATE_LIMITED',
            `Пароль можно менять не чаще одного раза в ${PASSWORD_CHANGE_MIN_INTERVAL_HOURS} часов. Повторите через ${retryAfterMinutes} мин`,
            { details: { retryAfterMinutes } },
          );
        }
      }

      const issues = validatePassword(input.newPassword, {
        username: user.username,
        fullName: user.fullName,
      });
      if (issues.length > 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Пароль не соответствует требованиям: ${issues.join('; ')}`,
          { details: { issues } },
        );
      }

      await users.setPassword(user.id, input.newPassword, { mustChangePassword: false }, { actor });
      await users.setPasswordChangedAt(user.id, new Date());

      // Смена пароля отзывает остальные сессии (SECURITY.md §3.1).
      await sessions.deleteByUserId(user.id, { exceptSessionId: input.sessionId });
    },

    async listSessions(userId, currentSessionId): Promise<SessionSummary[]> {
      const rows = await sessions.listByUserId(userId);

      return rows.map((row) => ({
        id: row.id,
        device: describeDevice(row.userAgent),
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
        current: row.id === currentSessionId,
      }));
    },

    async revokeSession(userId, sessionId, actor): Promise<void> {
      /** Ищем среди своих: чужая сессия должна выглядеть как «не найдено», а не как «нет прав». */
      const rows = await sessions.listByUserId(userId);
      if (!rows.some((row) => row.id === sessionId)) {
        throw new AppError('NOT_FOUND', 'Сессия не найдена');
      }

      await sessions.deleteById(sessionId);

      await audit.record(
        {
          action: 'logout',
          entityKind: 'user',
          entityId: userId,
          context: { sessionId, reason: 'revoked_by_user' },
        },
        actor,
      );
    },

    async revokeOtherSessions(userId, currentSessionId, actor): Promise<number> {
      const rows = await sessions.listByUserId(userId);
      const others = rows.filter((row) => row.id !== currentSessionId);

      for (const row of others) {
        await sessions.deleteById(row.id);
      }

      if (others.length > 0) {
        await audit.record(
          {
            action: 'logout',
            entityKind: 'user',
            entityId: userId,
            context: { reason: 'revoked_other_sessions', count: others.length },
          },
          actor,
        );
      }

      return others.length;
    },

    async createSessionFor(userId, meta, executor): Promise<LoginResult> {
      const roleCodes = (await users.resolveAccess(userId)).roles.map((role) => role.code);

      return startSession(userId, meta, executor, roleCodes);
    },

    async revokeUserSessions(userId, options, executor): Promise<void> {
      await sessions.deleteByUserId(userId, options, executor);
    },
  };

  return service;
}
