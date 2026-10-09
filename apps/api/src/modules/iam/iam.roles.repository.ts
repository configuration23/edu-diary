import { asc, eq, inArray, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { permission, role, rolePermission, userRole } from './iam.schema';

/** SQL только здесь: роли, права и их связь с пользователями. */

export interface RoleRow {
  id: string;
  code: string;
  title: string;
  isSystem: boolean;
}

export interface PermissionGrantRow {
  permission: string;
  scope: string;
}

export interface RoleWithPermissions extends RoleRow {
  permissions: PermissionGrantRow[];
  userCount: number;
}

export interface RolesRepository {
  list(): Promise<RoleWithPermissions[]>;
  findById(id: string): Promise<RoleRow | null>;
  findIdsByCodes(codes: readonly string[]): Promise<RoleRow[]>;
  insert(
    input: { code: string; title: string; isSystem: boolean },
    executor?: Executor,
  ): Promise<{ id: string }>;
  update(id: string, input: { title: string }, executor?: Executor): Promise<void>;
  setPermissions(
    roleId: string,
    grants: readonly PermissionGrantRow[],
    executor?: Executor,
  ): Promise<void>;
  listPermissions(): Promise<Array<{ code: string; title: string }>>;
  upsertPermission(definition: { code: string; title: string }, executor?: Executor): Promise<void>;
  permissionsForUser(userId: string): Promise<PermissionGrantRow[]>;
}

export function createRolesRepository(db: Database): RolesRepository {
  const permissionsForRoles = async (
    roleIds: readonly string[],
  ): Promise<Map<string, PermissionGrantRow[]>> => {
    const result = new Map<string, PermissionGrantRow[]>();
    if (roleIds.length === 0) return result;

    const rows = await db.orm
      .select({
        roleId: rolePermission.roleId,
        permission: rolePermission.permissionCode,
        scope: rolePermission.scope,
      })
      .from(rolePermission)
      .where(inArray(rolePermission.roleId, [...roleIds]));

    for (const row of rows) {
      const list = result.get(row.roleId) ?? [];
      list.push({ permission: row.permission, scope: row.scope });
      result.set(row.roleId, list);
    }

    return result;
  };

  return {
    async list(): Promise<RoleWithPermissions[]> {
      const roles = await db.orm.select().from(role).orderBy(asc(role.code));
      const permissions = await permissionsForRoles(roles.map((item) => item.id));

      const counts = await db.orm
        .select({ roleId: userRole.roleId, count: sql<number>`count(*)::int` })
        .from(userRole)
        .groupBy(userRole.roleId);

      const countByRole = new Map(counts.map((row) => [row.roleId, row.count]));

      return roles.map((item) => ({
        id: item.id,
        code: item.code,
        title: item.title,
        isSystem: item.isSystem,
        permissions: permissions.get(item.id) ?? [],
        userCount: countByRole.get(item.id) ?? 0,
      }));
    },

    async findById(id: string): Promise<RoleRow | null> {
      const rows = await db.orm.select().from(role).where(eq(role.id, id)).limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return { id: row.id, code: row.code, title: row.title, isSystem: row.isSystem };
    },

    async findIdsByCodes(codes: readonly string[]): Promise<RoleRow[]> {
      if (codes.length === 0) return [];

      const rows = await db.orm
        .select()
        .from(role)
        .where(inArray(role.code, [...codes]))
        .orderBy(asc(role.code));

      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        title: row.title,
        isSystem: row.isSystem,
      }));
    },

    async insert(input, executor: Executor = db.orm): Promise<{ id: string }> {
      const rows = await executor
        .insert(role)
        .values({ code: input.code, title: input.title, isSystem: input.isSystem })
        .returning({ id: role.id });

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать роль');
      return created;
    },

    async update(id: string, input: { title: string }, executor: Executor = db.orm): Promise<void> {
      await executor.update(role).set({ title: input.title }).where(eq(role.id, id));
    },

    async setPermissions(roleId, grants, executor: Executor = db.orm): Promise<void> {
      await executor.delete(rolePermission).where(eq(rolePermission.roleId, roleId));
      if (grants.length === 0) return;

      await executor.insert(rolePermission).values(
        grants.map((grant) => ({
          roleId,
          permissionCode: grant.permission,
          scope: grant.scope,
        })),
      );
    },

    async listPermissions(): Promise<Array<{ code: string; title: string }>> {
      const rows = await db.orm
        .select({ code: permission.code, title: permission.title })
        .from(permission)
        .orderBy(asc(permission.code));

      return rows;
    },

    async upsertPermission(
      definition: { code: string; title: string },
      executor: Executor = db.orm,
    ): Promise<void> {
      await executor
        .insert(permission)
        .values(definition)
        .onConflictDoUpdate({
          target: permission.code,
          set: { title: definition.title },
        });
    },

    async permissionsForUser(userId: string): Promise<PermissionGrantRow[]> {
      const rows = await db.orm
        .select({ permission: rolePermission.permissionCode, scope: rolePermission.scope })
        .from(userRole)
        .innerJoin(rolePermission, eq(rolePermission.roleId, userRole.roleId))
        .where(eq(userRole.userId, userId));

      return rows.map((row) => ({ permission: row.permission, scope: row.scope }));
    },
  };
}
