import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { PasswordHasher } from '../../shared/password-hasher';
import type { AcademicsService } from '../academics';
import type { AuditService } from '../audit';
import type { SecurityService } from '../security';
import { createGuardiansRepository } from './iam.guardians.repository';
import { createGuardiansService, type GuardiansService } from './iam.guardians.service';
import { createRolesRepository } from './iam.roles.repository';
import { createRolesService, type RolesService } from './iam.roles.service';
import { registerIamRoutes } from './iam.routes';
import { createUsersRepository, type UsersRepository } from './iam.users.repository';
import {
  createUsersService,
  type SessionRevokerPort,
  type UsersService,
} from './iam.users.service';

/**
 * Публичный интерфейс модуля `iam`: пользователи, роли, права, привязки.
 */

export { PERMISSIONS, SYSTEM_ROLES } from './iam.catalog';
export type { PermissionDefinition, SystemRoleDefinition } from './iam.catalog';
export { createGuardiansRepository } from './iam.guardians.repository';
export type { GuardianLinkRow } from './iam.guardians.repository';
export { createGuardiansService } from './iam.guardians.service';
export type { GuardiansService, LinkGuardianInput } from './iam.guardians.service';
export { createRolesRepository } from './iam.roles.repository';
export type { RoleRow, RoleWithPermissions } from './iam.roles.repository';
export { createRolesService } from './iam.roles.service';
export type { RolesService } from './iam.roles.service';
export { createUsersRepository } from './iam.users.repository';
export type { UserWithRoles, UserRoleRow, UsersRepository } from './iam.users.repository';
export {
  ACCOUNT_LOCK_MINUTES,
  createUsersService,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from './iam.users.service';
export type {
  MutationOptions,
  SessionRevokerPort,
  UserAccess,
  UsersService,
} from './iam.users.service';
export { appUser, guardianLink, permission, role, rolePermission, userRole } from './iam.schema';

export { registerIamRoutes } from './iam.routes';

export interface IamServices {
  users: UsersService;
  userRepository: UsersRepository;
  roles: RolesService;
  guardians: GuardiansService;
}

export function buildIamServices(dependencies: {
  db: Database;
  audit: AuditService;
  security: SecurityService;
  hasher: PasswordHasher;
  academics: AcademicsService;
  sessions: SessionRevokerPort;
}): IamServices {
  const { db, audit, security, hasher, academics, sessions } = dependencies;

  const userRepository = createUsersRepository(db);
  const rolesRepository = createRolesRepository(db);
  const guardiansRepository = createGuardiansRepository(db);

  return {
    userRepository,
    users: createUsersService({
      db,
      users: userRepository,
      roles: rolesRepository,
      audit,
      security,
      hasher,
      sessions,
    }),
    roles: createRolesService({ db, roles: rolesRepository, audit }),
    guardians: createGuardiansService({
      db,
      guardians: guardiansRepository,
      academics,
      audit,
    }),
  };
}

export function createIamModule(dependencies: { services: IamServices }): FastifyPluginAsync {
  return async (app) => {
    registerIamRoutes(app, dependencies.services);
  };
}
