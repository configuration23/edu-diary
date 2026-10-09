import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { PasswordHasher } from '../../shared/password-hasher';
import type { AuditService } from '../audit';
import type { UsersService } from '../iam';
import { createAuthRepository } from './auth.repository';
import { registerAuthRoutes } from './auth.routes';
import { createAuthService, type AuthService } from './auth.service';

/**
 * Публичный интерфейс модуля `auth`: вход, сессии, смена пароля.
 */

export { createAuthRepository, type SessionRecord } from './auth.repository';
export {
  createAuthService,
  SESSION_COOKIE_NAME,
  SESSION_RENEW_AFTER_MINUTES,
  SESSION_TTL_HOURS,
} from './auth.service';
export type { AuthService, LoginResult, SessionMeta } from './auth.service';
export { session } from './auth.schema';

export function createAuthModule(dependencies: { auth: AuthService }): FastifyPluginAsync {
  return async (app) => {
    registerAuthRoutes(app, dependencies.auth);
  };
}

export function buildAuthService(dependencies: {
  db: Database;
  users: UsersService;
  audit: AuditService;
  hasher: PasswordHasher;
}): AuthService {
  return createAuthService({
    db: dependencies.db,
    sessions: createAuthRepository(dependencies.db),
    users: dependencies.users,
    audit: dependencies.audit,
    hasher: dependencies.hasher,
  });
}
