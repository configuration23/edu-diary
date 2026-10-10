import { isAccessScope } from '@edu-diary/domain';
import type { AccessScope } from '@edu-diary/domain';

import { SYSTEM_ACTOR } from '../../shared/actor';
import type { Database } from '../../shared/db/client';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { AuditService } from '../audit';
import { PERMISSIONS, SYSTEM_ROLES, type PermissionDefinition } from './iam.catalog';
import type { RolesRepository, RoleWithPermissions } from './iam.roles.repository';
import type { MutationOptions } from './iam.users.service';

/** Роли и права (модуль `iam`). */

export interface RolePermissionsInput {
  permission: string;
  scope: string;
}

export interface CreateRoleInput {
  code: string;
  title: string;
  permissions: readonly RolePermissionsInput[];
}

export interface UpdateRoleInput {
  title?: string | undefined;
  permissions?: readonly RolePermissionsInput[] | undefined;
}

export interface CatalogSyncResult {
  permissions: number;
  rolesCreated: number;
  /** Сколько прав выдано уже существующим ролям (новые права каталога). */
  grantsAdded: number;
}

export interface RolesService {
  list(): Promise<RoleWithPermissions[]>;
  listPermissions(): Promise<PermissionDefinition[]>;
  create(input: CreateRoleInput, options: MutationOptions): Promise<RoleWithPermissions>;
  update(
    id: string,
    input: UpdateRoleInput,
    options: MutationOptions,
  ): Promise<RoleWithPermissions>;
  /** Приводит каталог прав и системные роли в соответствие с кодом. */
  syncCatalog(): Promise<CatalogSyncResult>;
}

export interface RolesServiceDependencies {
  db: Database;
  roles: RolesRepository;
  audit: AuditService;
}

function assertPermissions(permissions: readonly RolePermissionsInput[]): void {
  const known = new Set(PERMISSIONS.map((item) => item.code));
  const unknown = permissions.filter((item) => !known.has(item.permission));
  if (unknown.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Неизвестные права: ${unknown.map((item) => item.permission).join(', ')}`,
      { details: { unknown: unknown.map((item) => item.permission) } },
    );
  }

  const badScope = permissions.filter((item) => !isAccessScope(item.scope));
  if (badScope.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'Недопустимая область действия права', {
      details: { permissions: badScope },
    });
  }
}

export function createRolesService(dependencies: RolesServiceDependencies): RolesService {
  const { db, roles, audit } = dependencies;

  const requireRole = async (id: string): Promise<RoleWithPermissions> => {
    const all = await roles.list();
    const found = all.find((item) => item.id === id);
    if (found === undefined) {
      throw new AppError('NOT_FOUND', 'Роль не найдена');
    }
    return found;
  };

  return {
    list() {
      return roles.list();
    },

    async listPermissions(): Promise<PermissionDefinition[]> {
      // Каталог отдаём из кода: он же синхронизируется в базу при старте.
      return [...PERMISSIONS];
    },

    async create(input, options): Promise<RoleWithPermissions> {
      assertPermissions(input.permissions);

      const existing = await roles.findIdsByCodes([input.code]);
      if (existing.length > 0) {
        throw new AppError('CONFLICT', `Роль с кодом «${input.code}» уже существует`);
      }

      const created = await withTransaction(db, options.executor, async (tx) => {
        const row = await roles.insert(
          { code: input.code, title: input.title, isSystem: false },
          tx,
        );

        await roles.setPermissions(
          row.id,
          input.permissions.map((item) => ({ permission: item.permission, scope: item.scope })),
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'role',
            entityId: row.id,
            after: { code: input.code, title: input.title, permissions: input.permissions },
          },
          options.actor,
          tx,
        );

        return row.id;
      });

      return requireRole(created);
    },

    async update(id, input, options): Promise<RoleWithPermissions> {
      const current = await requireRole(id);
      if (input.permissions !== undefined) assertPermissions(input.permissions);

      await withTransaction(db, options.executor, async (tx) => {
        if (input.title !== undefined && input.title !== current.title) {
          await roles.update(id, { title: input.title }, tx);
        }

        if (input.permissions !== undefined) {
          await roles.setPermissions(
            id,
            input.permissions.map((item) => ({ permission: item.permission, scope: item.scope })),
            tx,
          );
        }

        await audit.record(
          {
            action: 'update',
            entityKind: 'role',
            entityId: id,
            before: { title: current.title, permissions: current.permissions },
            after: {
              title: input.title ?? current.title,
              permissions: input.permissions ?? current.permissions,
            },
          },
          options.actor,
          tx,
        );
      });

      return requireRole(id);
    },

    async syncCatalog(): Promise<CatalogSyncResult> {
      return db.transaction(async (tx) => {
        for (const permission of PERMISSIONS) {
          await roles.upsertPermission({ code: permission.code, title: permission.title }, tx);
        }

        let rolesCreated = 0;
        let grantsAdded = 0;

        for (const definition of SYSTEM_ROLES) {
          const existing = await roles.findIdsByCodes([definition.code]);

          if (existing.length === 0) {
            const created = await roles.insert(
              { code: definition.code, title: definition.title, isSystem: true },
              tx,
            );

            await roles.setPermissions(
              created.id,
              definition.permissions.map((grant) => ({
                permission: grant.permission,
                scope: grant.scope satisfies AccessScope,
              })),
              tx,
            );

            rolesCreated += 1;
            continue;
          }

          // Роль уже есть: набор прав администратор мог изменить сам, поэтому
          // выдаём только те права, которые явно помечены как «выдавать при
          // синхронизации». Новое право каталога иначе осталось бы без роли —
          // и новый раздел отвечал бы 403 на существующих установках.
          const grants = definition.grantedOnSync ?? [];
          if (grants.length === 0) continue;

          const roleId = existing[0]?.id;
          if (roleId === undefined) continue;

          const current = await roles.list();
          const present = new Set(
            (current.find((role) => role.id === roleId)?.permissions ?? []).map(
              (grant) => grant.permission,
            ),
          );

          const missing = grants.filter((grant) => !present.has(grant.permission));
          if (missing.length === 0) continue;

          for (const grant of missing) {
            await roles.upsertPermissionGrant(
              {
                roleId,
                permission: grant.permission,
                scope: grant.scope satisfies AccessScope,
              },
              tx,
            );
            grantsAdded += 1;
          }
        }

        if (grantsAdded > 0) {
          await audit.record(
            {
              action: 'update',
              entityKind: 'role',
              entityId: null,
              after: { grantsAdded },
              context: { catalogSync: true },
            },
            SYSTEM_ACTOR,
            tx,
          );
        }

        return { permissions: PERMISSIONS.length, rolesCreated, grantsAdded };
      });
    },
  };
}
