import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { appUser, role, userRole } from './iam.schema';

/** SQL только здесь: пользователи и их роли. */

export interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRoleRow {
  id: string;
  code: string;
  title: string;
}

export interface UserWithRoles extends UserRow {
  roles: UserRoleRow[];
}

export interface UserListFilters {
  search?: string | undefined;
  roleCode?: string | undefined;
  isActive?: boolean | undefined;
  limit: number;
  offset: number;
}

export interface CreateUserRow {
  username: string;
  passwordHash: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  mustChangePassword: boolean;
}

export interface UpdateUserRow {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

export interface UsersRepository {
  findById(id: string): Promise<UserWithRoles | null>;
  findByUsername(username: string): Promise<UserWithRoles | null>;
  list(filters: UserListFilters): Promise<{ items: UserWithRoles[]; total: number }>;
  findRoles(userId: string): Promise<UserRoleRow[]>;
  /** Возвращает созданную строку целиком: читать её обратно внутри транзакции нельзя. */
  insert(input: CreateUserRow, executor?: Executor): Promise<UserRow>;
  update(id: string, input: UpdateUserRow, executor?: Executor): Promise<UserRow | null>;
  updatePassword(
    id: string,
    input: { passwordHash: string; mustChangePassword: boolean },
    executor?: Executor,
  ): Promise<void>;
  registerLoginFailure(
    id: string,
    input: { failedLoginCount: number; lockedUntil: Date | null },
    executor?: Executor,
  ): Promise<void>;
  registerLoginSuccess(id: string, executor?: Executor): Promise<void>;
  setRoles(userId: string, roleIds: readonly string[], executor?: Executor): Promise<void>;
  countUsers(): Promise<number>;
}

function toUserRow(row: typeof appUser.$inferSelect): UserRow {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    failedLoginCount: row.failedLoginCount,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createUsersRepository(db: Database): UsersRepository {
  /** Роли для набора пользователей одним запросом: без N+1. */
  const rolesFor = async (userIds: readonly string[]): Promise<Map<string, UserRoleRow[]>> => {
    const result = new Map<string, UserRoleRow[]>();
    if (userIds.length === 0) return result;

    const rows = await db.orm
      .select({ userId: userRole.userId, id: role.id, code: role.code, title: role.title })
      .from(userRole)
      .innerJoin(role, eq(role.id, userRole.roleId))
      .where(inArray(userRole.userId, [...userIds]))
      .orderBy(asc(role.code));

    for (const row of rows) {
      const list = result.get(row.userId) ?? [];
      list.push({ id: row.id, code: row.code, title: row.title });
      result.set(row.userId, list);
    }

    return result;
  };

  const attachRoles = async (
    rows: Array<typeof appUser.$inferSelect>,
  ): Promise<UserWithRoles[]> => {
    const roles = await rolesFor(rows.map((row) => row.id));
    return rows.map((row) => ({ ...toUserRow(row), roles: roles.get(row.id) ?? [] }));
  };

  return {
    async findById(id: string): Promise<UserWithRoles | null> {
      const rows = await db.orm.select().from(appUser).where(eq(appUser.id, id)).limit(1);
      const found = await attachRoles(rows);
      return found[0] ?? null;
    },

    async findByUsername(username: string): Promise<UserWithRoles | null> {
      // Колонка citext: регистр учитывается самой базой.
      const rows = await db.orm
        .select()
        .from(appUser)
        .where(eq(appUser.username, username))
        .limit(1);
      const found = await attachRoles(rows);
      return found[0] ?? null;
    },

    async list(filters: UserListFilters): Promise<{ items: UserWithRoles[]; total: number }> {
      const conditions = [
        filters.search === undefined || filters.search.trim() === ''
          ? undefined
          : or(
              ilike(appUser.username, `%${filters.search.trim()}%`),
              ilike(appUser.fullName, `%${filters.search.trim()}%`),
            ),
        filters.isActive === undefined ? undefined : eq(appUser.isActive, filters.isActive),
        filters.roleCode === undefined
          ? undefined
          : sql`exists (
              select 1 from ${userRole}
              inner join ${role} on ${role.id} = ${userRole.roleId}
              where ${userRole.userId} = ${appUser.id} and ${role.code} = ${filters.roleCode}
            )`,
      ].filter((condition) => condition !== undefined);

      const where = conditions.length === 0 ? undefined : and(...conditions);

      const rows = await db.orm
        .select()
        .from(appUser)
        .where(where)
        .orderBy(asc(appUser.username))
        .limit(filters.limit)
        .offset(filters.offset);

      const totals = await db.orm
        .select({ count: sql<number>`count(*)::int` })
        .from(appUser)
        .where(where);

      return { items: await attachRoles(rows), total: totals[0]?.count ?? 0 };
    },

    async findRoles(userId: string): Promise<UserRoleRow[]> {
      const rows = await db.orm
        .select({ id: role.id, code: role.code, title: role.title })
        .from(userRole)
        .innerJoin(role, eq(role.id, userRole.roleId))
        .where(eq(userRole.userId, userId))
        .orderBy(asc(role.code));

      return rows;
    },

    async insert(input: CreateUserRow, executor: Executor = db.orm): Promise<UserRow> {
      const rows = await executor
        .insert(appUser)
        .values({
          username: input.username,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          mustChangePassword: input.mustChangePassword,
        })
        .returning();

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать пользователя');
      return toUserRow(created);
    },

    async update(
      id: string,
      input: UpdateUserRow,
      executor: Executor = db.orm,
    ): Promise<UserRow | null> {
      const rows = await executor
        .update(appUser)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(appUser.id, id))
        .returning();

      const updated = rows[0];
      return updated === undefined ? null : toUserRow(updated);
    },

    async updatePassword(id, input, executor: Executor = db.orm): Promise<void> {
      await executor
        .update(appUser)
        .set({
          passwordHash: input.passwordHash,
          mustChangePassword: input.mustChangePassword,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(appUser.id, id));
    },

    async registerLoginFailure(id, input, executor: Executor = db.orm): Promise<void> {
      await executor
        .update(appUser)
        .set({
          failedLoginCount: input.failedLoginCount,
          lockedUntil: input.lockedUntil,
          updatedAt: new Date(),
        })
        .where(eq(appUser.id, id));
    },

    async registerLoginSuccess(id: string, executor: Executor = db.orm): Promise<void> {
      await executor
        .update(appUser)
        .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(appUser.id, id));
    },

    async setRoles(
      userId: string,
      roleIds: readonly string[],
      executor: Executor = db.orm,
    ): Promise<void> {
      await executor.delete(userRole).where(eq(userRole.userId, userId));
      if (roleIds.length === 0) return;

      await executor.insert(userRole).values(roleIds.map((roleId) => ({ userId, roleId })));
    },

    async countUsers(): Promise<number> {
      const rows = await db.orm.select({ count: sql<number>`count(*)::int` }).from(appUser);
      return rows[0]?.count ?? 0;
    },
  };
}
