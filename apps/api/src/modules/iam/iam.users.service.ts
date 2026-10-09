import { isAccessScope, mergePermissions, validatePassword } from '@edu-diary/domain';
import type { AccessScope } from '@edu-diary/domain';

import type { AuditActor } from '../../shared/actor';
import type { Database, Executor } from '../../shared/db/client';
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
/** На сколько минут блокируется учётная запись. */
export const ACCOUNT_LOCK_MINUTES = 15;

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

    async create(input, options): Promise<UserWithRoles> {
      const username = normalizeUsername(input.username);
      assertPasswordAcceptable(input.password, { username, fullName: input.fullName });

      const roleRows = await resolveRoleRows(input.roles);
      const passwordHash = await hasher.hash(input.password);
      const mustChangePassword = input.mustChangePassword ?? true;
      const email = input.email ?? null;
      const phone = input.phone ?? null;

      const created = await withTransaction(db, options.executor, async (tx) => {
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
      });

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

    async resetPasswordByAdmin(id, password, options): Promise<void> {
      await applyPassword(
        id,
        password,
        { mustChangePassword: true, action: 'password_reset' },
        options,
      );

      // Сброс пароля администратором отзывает все сессии пользователя.
      await sessions.revokeUserSessions(id, {}, options.executor);
    },

    async registerFailedLogin(userId, options): Promise<FailedLoginState> {
      const current = await requireUser(userId);
      const failedLoginCount = current.failedLoginCount + 1;
      const lockedUntil =
        failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS
          ? new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60_000)
          : current.lockedUntil;

      await withTransaction(db, options.executor, async (tx) => {
        await users.registerLoginFailure(userId, { failedLoginCount, lockedUntil }, tx);

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
            lockedUntil: failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS ? lockedUntil : null,
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
