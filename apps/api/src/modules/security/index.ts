import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AuditService } from '../audit';
import { createSecurityRepository } from './security.repository';
import { registerSecurityRoutes } from './security.routes';
import { createSecurityService, type SecurityService } from './security.service';

/**
 * Публичный интерфейс модуля `security`: события безопасности и инциденты.
 */

export {
  createSecurityRepository,
  type SecurityEventRecord,
  type SecurityListFilters,
  type SecurityRepository,
} from './security.repository';
export {
  createSecurityService,
  FAILED_LOGIN_BURST_THRESHOLD,
  type SecurityEventInput,
  type SecurityService,
} from './security.service';
export { securityEvent } from './security.schema';

export function createSecurityModule(dependencies: {
  security: SecurityService;
  audit: AuditService;
}): FastifyPluginAsync {
  return async (app) => {
    registerSecurityRoutes(app, dependencies.security, dependencies.audit);
  };
}

export function buildSecurityService(db: Database): SecurityService {
  return createSecurityService(createSecurityRepository(db));
}
