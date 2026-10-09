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

/**
 * Вход, серверные сессии и смена пароля (ADR-004, SECURITY.md §3.1).
 *
 * В базе лежит только хеш токена: украденная копия базы не даёт войти. Cookie —
 * `httpOnly` + `SameSite=Lax`; признак `Secure` выставляется, если запрос пришёл
 * по HTTPS (за Caddy), поэтому стенд по HTTP продолжает работать.
 */

export const SESSION_COOKIE_NAME = 'edu_diary_session';
export const SESSION_TTL_HOURS = 8;
/** Сессия продлевается при активности, но не чаще раза в час. */
export const SESSION_RENEW_AFTER_MINUTES = 60;

export interface SessionMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface LoginInput {
  username: string;
  password: string;
  meta: SessionMeta;
}

export interface LoginResult {
  token: string;
  auth: AuthContext;
  expiresAt: Date;
}

export interface AuthService extends SessionRevokerPort {
  login(input: LoginInput): Promise<LoginResult>;
  /** Возвращает контекст по токену cookie; null — сессии нет или она истекла. */
  resolveSession(token: string): Promise<AuthContext | null>;
  logout(token: string, actor: AuditActor): Promise<void>;
  changePassword(
    input: { userId: string; sessionId: string; currentPassword: string; newPassword: string },
    actor: AuditActor,
  ): Promise<void>;
  /** Создать сессию без пароля: используется мастером настройки. */
  createSessionFor(userId: string, meta: SessionMeta, executor?: Executor): Promise<LoginResult>;
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
      roles: access.roles.map((role) => ({ code: role.code, title: role.title })),
      permissions: access.permissions,
    };
  };

  const startSession = async (
    userId: string,
    meta: SessionMeta,
    executor: Executor | undefined,
  ): Promise<LoginResult> => {
    const token = createToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000);

    const record = await sessions.insert(
      {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
      executor,
    );

    const auth = await buildContext(record);
    if (auth === null) {
      throw new AppError('FORBIDDEN', 'Учётная запись отключена');
    }

    return { token, auth, expiresAt };
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
        throw new AppError(
          'RATE_LIMITED',
          'Слишком много неудачных попыток входа. Попробуйте позже',
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
        return startSession(user.id, input.meta, tx);
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
        await sessions.renew(record.id, new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000));
      }

      return auth;
    },

    async logout(token, actor): Promise<void> {
      if (token === '') return;

      const tokenHash = hashToken(token);
      await sessions.deleteByTokenHash(tokenHash);

      await audit.record({ action: 'logout', entityKind: 'user', entityId: actor.userId }, actor);
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

      // Смена пароля отзывает остальные сессии (SECURITY.md §3.1).
      await sessions.deleteByUserId(user.id, { exceptSessionId: input.sessionId });
    },

    async createSessionFor(userId, meta, executor): Promise<LoginResult> {
      return startSession(userId, meta, executor);
    },

    async revokeUserSessions(userId, options, executor): Promise<void> {
      await sessions.deleteByUserId(userId, options, executor);
    },
  };

  return service;
}
