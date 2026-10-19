import {
  isAccessScope,
  mergePermissions,
  suggestUsername,
  usernameCandidates,
  validatePassword,
} from '@edu-diary/domain';
import type { AccessScope } from '@edu-diary/domain';

import type { AuditActor } from '../../shared/actor';
import type { Database, Executor } from '../../shared/db/client';
import { withDatabaseErrors } from '../../shared/db/errors';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { PasswordHasher } from '../../shared/password-hasher';
import type { AuditService } from '../audit';
import type { SecurityService } from '../security';
import type { RolesRepository, RoleRow } from './iam.roles.repository';
import type {
  UserListFilters,
  UserRoleRow,
  UsersRepository,
  UserWithRoles,
} from './iam.users.repository';

/** Пользователи и их доступ (модуль `iam`). */

/** Сколько подряд неудачных входов блокируют учётную запись. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/** Первая блокировка — 5 минут (решение владельца). */
export const ACCOUNT_LOCK_MINUTES = 5;

/** Потолок блокировки: сутки. Иначе после десятка попыток человек ждал бы месяцами. */
export const ACCOUNT_LOCK_MAX_MINUTES = 24 * 60;

/**
 * Срок блокировки после N-й неудачной попытки.
 *
 * Владелец: первая блокировка 5 минут, каждая следующая неудача **удваивает** срок —
 * 5, 10, 20, 40, 80 минут. Так перебор становится бессмысленным по времени, а человек, который
 * просто перепутал раскладку, ждёт всего 5 минут.
 */
export function lockMinutesFor(failedCount: number): number {
  const steps = Math.max(0, failedCount - MAX_FAILED_LOGIN_ATTEMPTS);
  return Math.min(ACCOUNT_LOCK_MINUTES * 2 ** steps, ACCOUNT_LOCK_MAX_MINUTES);
}

export interface MutationOptions {
  actor: AuditActor;
  /** Транзакция вызывающего кода: мастер настройки выполняет всё одним блоком. */
  executor?: Executor | undefined;
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  password: string;
  email?: string | undefined;
  phone?: string | undefined;
  roles: readonly string[];
  /** true по умолчанию: пароль выдал администратор, при входе нужно сменить. */
  mustChangePassword?: boolean | undefined;
}

export interface UpdateUserInput {
  fullName?: string | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  isActive?: boolean | undefined;
}

export interface UserAccess {
  roles: UserRoleRow[];
  permissions: ReadonlyMap<string, AccessScope>;
}

export interface FailedLoginState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

/**
 * Порт отзыва сессий: реализацию даёт модуль `auth` при сборке приложения.
 * Так `iam` не зависит от `auth` (иначе модули ссылались бы друг на друга).
 */
export interface SessionRevokerPort {
  revokeUserSessions(
    userId: string,
    options: { exceptSessionId?: string | undefined },
    executor?: Executor,
  ): Promise<void>;
}

export interface UsersService {
  list(filters: UserListFilters): Promise<{ items: UserWithRoles[]; total: number }>;
  /** Подсказка свободного логина по ФИО (транслитерация + проверка занятости). */
  suggestUsername(fullName: string): Promise<{ username: string | null; taken: string[] }>;
  getById(id: string): Promise<UserWithRoles | null>;
  findByUsername(username: string): Promise<UserWithRoles | null>;
  create(input: CreateUserInput, options: MutationOptions): Promise<UserWithRoles>;
  update(id: string, input: UpdateUserInput, options: MutationOptions): Promise<UserWithRoles>;
  setRoles(
    id: string,
    roleCodes: readonly string[],
    options: MutationOptions,
  ): Promise<UserWithRoles>;
  setPassword(
    id: string,
    password: string,
    input: {
      mustChangePassword: boolean;
      action?: 'password_changed' | 'password_reset' | undefined;
    },
    options: MutationOptions,
  ): Promise<void>;
  /** Сброс пароля администратором: пароль временный, все сессии отзываются. */
  resetPasswordByAdmin(id: string, password: string, options: MutationOptions): Promise<void>;
  /** Счётчик неудачных входов и блокировка (SECURITY.md §3.1). */
  registerFailedLogin(userId: string, options: MutationOptions): Promise<FailedLoginState>;
  registerSuccessfulLogin(userId: string, actor: AuditActor, executor?: Executor): Promise<void>;
  resolveAccess(userId: string): Promise<UserAccess>;
  /** Смена темы оформления: своя учётная запись, без прав администратора. */
  setTheme(id: string, theme: string): Promise<void>;
  /** Вид страниц: своя учётная запись, без прав администратора. */
  setViewMode(id: string, viewMode: string): Promise<void>;
  /** Отметка о смене пароля человеком: ограничение частоты. Значение null снимает ограничение. */
  setPasswordChangedAt(id: string, at: Date | null): Promise<void>;
  count(): Promise<number>;
}

export interface UsersServiceDependencies {
  db: Database;
  users: UsersRepository;
  roles: RolesRepository;
  audit: AuditService;
  security: SecurityService;
  hasher: PasswordHasher;
  sessions: SessionRevokerPort;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function assertPasswordAcceptable(
  password: string,
  input: { username?: string; fullName?: string },
): void {
  const issues = validatePassword(password, input);
  if (issues.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Пароль не соответствует требованиям: ${issues.join('; ')}`,
      { details: { issues } },
    );
  }
}

export function createUsersService(dependencies: UsersServiceDependencies): UsersService {
  const { db, users, roles, audit, security, hasher, sessions } = dependencies;

  const resolveRoleRows = async (codes: readonly string[]): Promise<RoleRow[]> => {
    const found = await roles.findIdsByCodes(codes);
    const missing = codes.filter((code) => !found.some((row) => row.code === code));

    if (missing.length > 0) {
      throw new AppError('VALIDATION_FAILED', `Неизвестные роли: ${missing.join(', ')}`, {
        details: { missing },
      });
    }

    return found;
  };

  const requireUser = async (id: string): Promise<UserWithRoles> => {
    const user = await users.findById(id);
    if (user === null) {
      throw new AppError('NOT_FOUND', 'Пользователь не найден');
    }
    return user;
  };

  const applyPassword = async (
    id: string,
    password: string,
    input: {
      mustChangePassword: boolean;
      action?: 'password_changed' | 'password_reset' | undefined;
    },
    options: MutationOptions,
  ): Promise<void> => {
    const current = await requireUser(id);
    assertPasswordAcceptable(password, { username: current.username, fullName: current.fullName });

    const passwordHash = await hasher.hash(password);

    await withTransaction(db, options.executor, async (tx) => {
      await users.updatePassword(
        id,
        { passwordHash, mustChangePassword: input.mustChangePassword },
        tx,
      );

      await audit.record(
        {
          action: input.action ?? 'password_changed',
          entityKind: 'user',
          entityId: id,
          context: { mustChangePassword: input.mustChangePassword },
        },
        options.actor,
        tx,
      );
    });
  };

  return {
    list(filters) {
      return users.list(filters);
    },

    getById(id) {
      return users.findById(id);
    },

    findByUsername(username) {
      return users.findByUsername(normalizeUsername(username));
    },

    async suggestUsername(fullName) {
      // Занятость проверяем одним запросом по списку кандидатов: базовый логин и
      // варианты с цифрами. Само правило подбора — в домене.
      const candidates = usernameCandidates(fullName);
      if (candidates.length === 0) return { username: null, taken: [] };

      const taken = await users.findTakenUsernames(candidates);
      return suggestUsername(fullName, taken);
    },

    async create(input, options): Promise<UserWithRoles> {
      const username = normalizeUsername(input.username);
      assertPasswordAcceptable(input.password, { username, fullName: input.fullName });

      const roleRows = await resolveRoleRows(input.roles);
      const passwordHash = await hasher.hash(input.password);
      const mustChangePassword = input.mustChangePassword ?? true;
      const email = input.email ?? null;
      const phone = input.phone ?? null;

      const created = await withDatabaseErrors(
        () =>
          withTransaction(db, options.executor, async (tx) => {
            const row = await users.insert(
              {
                username,
                passwordHash,
                fullName: input.fullName,
                email,
                phone,
                mustChangePassword,
              },
              tx,
            );

            await users.setRoles(
              row.id,
              roleRows.map((role) => role.id),
              tx,
            );

            await audit.record(
              {
                action: 'create',
                entityKind: 'user',
                entityId: row.id,
                after: {
                  username,
                  fullName: input.fullName,
                  email,
                  phone,
                  roles: roleRows.map((role) => role.code),
                  mustChangePassword,
                },
              },
              options.actor,
              tx,
            );

            return row;
          }),
        {
          // Логин и почта уникальны: занятое значение — это конфликт, а не сбой.
          unique: `Логин «${username}» уже занят`,
        },
      );

      return {
        ...created,
        roles: roleRows.map((role) => ({ id: role.id, code: role.code, title: role.title })),
      };
    },

    async update(id, input, options): Promise<UserWithRoles> {
      const current = await requireUser(id);

      const updated = await withTransaction(db, options.executor, async (tx) => {
        const row = await users.update(id, input, tx);
        if (row === null) {
          throw new AppError('NOT_FOUND', 'Пользователь не найден');
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'user',
            entityId: id,
            before: {
              fullName: current.fullName,
              email: current.email,
              phone: current.phone,
              isActive: current.isActive,
            },
            after: input,
          },
          options.actor,
          tx,
        );

        return row;
      });

      return { ...updated, roles: current.roles };
    },

    async setRoles(id, roleCodes, options): Promise<UserWithRoles> {
      const current = await requireUser(id);
      const roleRows = await resolveRoleRows(roleCodes);

      await withTransaction(db, options.executor, async (tx) => {
        await users.setRoles(
          id,
          roleRows.map((role) => role.id),
          tx,
        );

        await audit.record(
          {
            action: 'update',
            entityKind: 'user_roles',
            entityId: id,
            before: { roles: current.roles.map((role) => role.code) },
            after: { roles: roleRows.map((role) => role.code) },
          },
          options.actor,
          tx,
        );

        // Изменение прав — событие безопасности (SECURITY.md §3.7).
        await security.onRolesChanged(
          { targetUserId: id, roles: roleRows.map((role) => role.code), actor: options.actor },
          tx,
        );
      });

      return {
        ...current,
        roles: roleRows.map((role) => ({ id: role.id, code: role.code, title: role.title })),
      };
    },

    setPassword: applyPassword,

    async setTheme(id, theme): Promise<void> {
      await requireUser(id);
      await users.setTheme(id, theme);
    },

    async setViewMode(id, viewMode): Promise<void> {
      await requireUser(id);
      await users.setViewMode(id, viewMode);
    },

    async setPasswordChangedAt(id, at): Promise<void> {
      await requireUser(id);
      await users.setPasswordChangedAt(id, at);
    },

    async resetPasswordByAdmin(id, password, options): Promise<void> {
      await applyPassword(
        id,
        password,
        { mustChangePassword: true, action: 'password_reset' },
        options,
      );

      /**
       * Ограничение частоты снимаем: пароль выдал администратор, и человек должен войти новым
       * паролем сразу, а не ждать шесть часов.
       */
      await users.setPasswordChangedAt(id, null, options.executor);

      // Сброс пароля администратором отзывает все сессии пользователя.
      await sessions.revokeUserSessions(id, {}, options.executor);
    },

    async registerFailedLogin(userId, options): Promise<FailedLoginState> {
      const current = await requireUser(userId);

      /** Счётчик и блокировку пишет одна инструкция: параллельные попытки не теряются. */
      const { failedLoginCount, lockedUntil } = await users.registerLoginFailureAtomic(userId, {
        threshold: MAX_FAILED_LOGIN_ATTEMPTS,
        baseMinutes: ACCOUNT_LOCK_MINUTES,
        maxMinutes: ACCOUNT_LOCK_MAX_MINUTES,
      });

      await withTransaction(db, options.executor, async (tx) => {
        await audit.record(
          {
            action: 'login_failed',
            entityKind: 'user',
            entityId: userId,
            context: { failedLoginCount },
          },
          options.actor,
          tx,
        );

        await security.onFailedLogin(
          {
            username: current.username,
            failedCount: failedLoginCount,
            lockedUntil:
              lockedUntil !== null && lockedUntil.getTime() > Date.now() ? lockedUntil : null,
            actor: options.actor,
          },
          tx,
        );
      });

      return { failedLoginCount, lockedUntil };
    },

    async registerSuccessfulLogin(userId, actor, executor): Promise<void> {
      await withTransaction(db, executor, async (tx) => {
        await users.registerLoginSuccess(userId, tx);

        await audit.record({ action: 'login', entityKind: 'user', entityId: userId }, actor, tx);
      });
    },

    async resolveAccess(userId): Promise<UserAccess> {
      const [roleRows, grants] = await Promise.all([
        users.findRoles(userId),
        roles.permissionsForUser(userId),
      ]);

      const valid = grants
        .filter((grant) => isAccessScope(grant.scope))
        .map((grant) => ({ permission: grant.permission, scope: grant.scope as AccessScope }));

      return {
        roles: roleRows,
        permissions: mergePermissions(valid),
      };
    },

    count() {
      return users.countUsers();
    },
  };
}
