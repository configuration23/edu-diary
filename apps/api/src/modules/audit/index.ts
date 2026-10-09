import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import { createAuditRepository } from './audit.repository';
import { registerAuditRoutes } from './audit.routes';
import { createAuditService, type AuditService } from './audit.service';

/**
 * Публичный интерфейс модуля `audit`: журнал изменений и доступа.
 *
 * Записи только добавляются: снаружи доступны `record` (в транзакции изменения)
 * и чтение списка. Методов изменения и удаления нет намеренно (ADR-012).
 */

export {
  createAuditRepository,
  type AuditListFilters,
  type AuditRecord,
  type AuditRepository,
} from './audit.repository';
export { createAuditService, type AuditEntryInput, type AuditService } from './audit.service';
export { auditLog } from './audit.schema';

export function createAuditModule(dependencies: { audit: AuditService }): FastifyPluginAsync {
  return async (app) => {
    registerAuditRoutes(app, dependencies.audit);
  };
}

export function buildAuditService(db: Database): AuditService {
  return createAuditService(createAuditRepository(db));
}
