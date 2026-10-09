import {
  listAuditQuerySchema,
  listAuditResponseSchema,
  type AuditEntryDto,
} from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import { requirePermission } from '../../shared/guards';
import type { AuditRecord } from './audit.repository';
import type { AuditService } from './audit.service';

function toDto(record: AuditRecord): AuditEntryDto {
  return {
    id: record.id,
    actorUserId: record.actorUserId,
    actorName: record.actorName,
    actorIp: record.actorIp,
    action: record.action,
    entityKind: record.entityKind,
    entityId: record.entityId,
    before: record.before ?? null,
    after: record.after ?? null,
    context: record.context ?? null,
    isAccess: record.isAccess,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * HTTP-слой модуля. Только чтение: изменить или удалить запись аудита через API
 * невозможно — таких маршрутов нет (SECURITY.md §3.4).
 */
export function registerAuditRoutes(app: FastifyInstance, audit: AuditService): void {
  app.get('/audit', { preHandler: requirePermission('audit:read', 'all') }, async (request) => {
    const query = listAuditQuerySchema.parse(request.query);

    const { items, total } = await audit.list({
      entityKind: query.entityKind,
      entityId: query.entityId,
      actorUserId: query.actorId,
      action: query.action,
      accessOnly: query.accessOnly,
      limit: query.limit,
      offset: query.offset,
    });

    // Просмотр журнала — тоже доступ к персональным данным (ADR-017).
    await audit.record(
      {
        action: 'access',
        entityKind: 'audit_log',
        isAccess: true,
        context: { limit: query.limit, offset: query.offset, total },
      },
      actorFromRequest(request),
    );

    return listAuditResponseSchema.parse({ items: items.map(toDto), total });
  });
}
