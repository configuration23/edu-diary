import {
  createRoleRequestSchema,
  createUserRequestSchema,
  linkGuardianRequestSchema,
  listPermissionsResponseSchema,
  listRolesResponseSchema,
  listUsersQuerySchema,
  listUsersResponseSchema,
  resetPasswordRequestSchema,
  setUserRolesRequestSchema,
  updateRoleRequestSchema,
  updateUserRequestSchema,
  type GuardianLinkDto,
  type RoleDetailDto,
  type UserSummaryDto,
} from '@edu-diary/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import { authOf, requirePermission } from '../../shared/guards';
import { AppError } from '../../shared/errors';
import type { GuardianLinkRow } from './iam.guardians.repository';
import type { GuardiansService } from './iam.guardians.service';
import type { RoleWithPermissions } from './iam.roles.repository';
import type { RolesService } from './iam.roles.service';
import type { UserWithRoles, UsersRepository } from './iam.users.repository';
import type { UsersService } from './iam.users.service';

function toUserDto(user: UserWithRoles): UserSummaryDto {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    roles: user.roles.map((role) => ({ code: role.code, title: role.title })),
    createdAt: user.createdAt.toISOString(),
  };
}

function toRoleDto(role: RoleWithPermissions): RoleDetailDto {
  return {
    id: role.id,
    code: role.code,
    title: role.title,
    isSystem: role.isSystem,
    permissions: role.permissions.map((grant) => ({
      permission: grant.permission,
      scope: grant.scope as RoleDetailDto['permissions'][number]['scope'],
    })),
    userCount: role.userCount,
  };
}

function toGuardianDto(link: GuardianLinkRow): GuardianLinkDto {
  return {
    id: link.id,
    guardianUserId: link.guardianUserId,
    guardianName: link.guardianName,
    guardianUsername: link.guardianUsername,
    relation: (link.relation ?? null) as GuardianLinkDto['relation'],
  };
}

/** Защита от потери доступа: нельзя менять роли и активность самому себе. */
function assertNotSelf(request: FastifyRequest, targetUserId: string, action: string): void {
  if (authOf(request).userId === targetUserId) {
    throw new AppError('CONFLICT', `Нельзя ${action} собственной учётной записи`);
  }
}

export function registerIamRoutes(
  app: FastifyInstance,
  services: {
    users: UsersService;
    userRepository: UsersRepository;
    roles: RolesService;
    guardians: GuardiansService;
  },
): void {
  const { users, roles, guardians } = services;

  app.get('/users', { preHandler: requirePermission('users:read', 'all') }, async (request) => {
    const query = listUsersQuerySchema.parse(request.query);

    const { items, total } = await users.list({
      search: query.search,
      roleCode: query.role,
      isActive: query.isActive,
      limit: query.limit,
      offset: query.offset,
    });

    return listUsersResponseSchema.parse({ items: items.map(toUserDto), total });
  });

  app.get('/users/:id', { preHandler: requirePermission('users:read', 'all') }, async (request) => {
    const { id } = request.params as { id: string };
    const user = await users.getById(id);

    if (user === null) {
      throw new AppError('NOT_FOUND', 'Пользователь не найден');
    }

    return toUserDto(user);
  });

  app.post(
    '/users',
    { preHandler: requirePermission('users:write', 'all') },
    async (request, reply) => {
      const body = createUserRequestSchema.parse(request.body);
      const created = await users.create(body, { actor: actorFromRequest(request) });

      reply.status(201);
      return toUserDto(created);
    },
  );

  app.patch(
    '/users/:id',
    { preHandler: requirePermission('users:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateUserRequestSchema.parse(request.body);

      if (body.isActive === false) {
        assertNotSelf(request, id, 'деактивировать');
      }

      const updated = await users.update(id, body, { actor: actorFromRequest(request) });
      return toUserDto(updated);
    },
  );

  app.post(
    '/users/:id/roles',
    { preHandler: requirePermission('users:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = setUserRolesRequestSchema.parse(request.body);

      assertNotSelf(request, id, 'менять роли');

      const updated = await users.setRoles(id, body.roles, { actor: actorFromRequest(request) });
      return toUserDto(updated);
    },
  );

  app.post(
    '/users/:id/reset-password',
    { preHandler: requirePermission('users:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = resetPasswordRequestSchema.parse(request.body);

      await users.resetPasswordByAdmin(id, body.password, { actor: actorFromRequest(request) });

      return { ok: true };
    },
  );

  app.get('/permissions', { preHandler: requirePermission('roles:read', 'all') }, async () => {
    const items = await roles.listPermissions();
    return listPermissionsResponseSchema.parse({ items });
  });

  app.get('/roles', { preHandler: requirePermission('roles:read', 'all') }, async () => {
    const items = await roles.list();
    return listRolesResponseSchema.parse({ items: items.map(toRoleDto) });
  });

  app.post(
    '/roles',
    { preHandler: requirePermission('roles:write', 'all') },
    async (request, reply) => {
      const body = createRoleRequestSchema.parse(request.body);
      const created = await roles.create(body, { actor: actorFromRequest(request) });

      reply.status(201);
      return toRoleDto(created);
    },
  );

  app.patch(
    '/roles/:id',
    { preHandler: requirePermission('roles:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateRoleRequestSchema.parse(request.body);
      const updated = await roles.update(id, body, { actor: actorFromRequest(request) });

      return toRoleDto(updated);
    },
  );

  app.get(
    '/students/:id/guardians',
    { preHandler: requirePermission('students:read', 'assigned') },
    async (request) => {
      const { id } = request.params as { id: string };
      const links = await guardians.listByStudent(id);
      return { items: links.map(toGuardianDto) };
    },
  );

  app.post(
    '/students/:id/guardians',
    { preHandler: requirePermission('students:write', 'all') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = linkGuardianRequestSchema.parse(request.body);

      const link = await guardians.link(
        { studentId: id, guardianUserId: body.guardianUserId, relation: body.relation },
        { actor: actorFromRequest(request) },
      );

      reply.status(201);
      return toGuardianDto(link);
    },
  );

  app.delete(
    '/students/:id/guardians/:linkId',
    { preHandler: requirePermission('students:write', 'all') },
    async (request) => {
      const { linkId } = request.params as { id: string; linkId: string };
      await guardians.unlink(linkId, { actor: actorFromRequest(request) });
      return { ok: true };
    },
  );
}
