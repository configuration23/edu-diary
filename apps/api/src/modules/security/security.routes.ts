import {
  acknowledgeSecurityEventRequestSchema,
  listSecurityEventsQuerySchema,
  listSecurityEventsResponseSchema,
  type SecurityEventDto,
} from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import { AppError } from '../../shared/errors';
import { requirePermission } from '../../shared/guards';
import type { SecurityEventRecord } from './security.repository';
import type { SecurityService } from './security.service';
import type { AuditService } from '../audit';

function toDto(record: SecurityEventRecord): SecurityEventDto {
  return {
    id: record.id,
    kind: record.kind,
    severity: record.severity as SecurityEventDto['severity'],
    actorUserId: record.actorUserId,
    actorName: record.actorName,
    ip: record.ip,
    details: record.details ?? null,
    detectedAt: record.detectedAt.toISOString(),
    acknowledgedBy: record.acknowledgedBy,
    acknowledgedAt: record.acknowledgedAt?.toISOString() ?? null,
    resolution: record.resolution,
  };
}

export function registerSecurityRoutes(
  app: FastifyInstance,
  security: SecurityService,
  audit: AuditService,
): void {
  app.get(
    '/security/events',
    { preHandler: requirePermission('security:read', 'all') },
    async (request) => {
      const query = listSecurityEventsQuerySchema.parse(request.query);

      const { items, total } = await security.list({
        severity: query.severity,
        acknowledged: query.acknowledged,
        limit: query.limit,
        offset: query.offset,
      });

      return listSecurityEventsResponseSchema.parse({ items: items.map(toDto), total });
    },
  );

  app.post(
    '/security/events/:id/ack',
    { preHandler: requirePermission('security:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = acknowledgeSecurityEventRequestSchema.parse(request.body ?? {});
      const actor = actorFromRequest(request);

      const event = await security.findById(id);
      if (event === null) {
        throw new AppError('NOT_FOUND', 'Событие безопасности не найдено');
      }

      await security.acknowledge(id, { resolution: body.resolution ?? null, actor });

      await audit.record(
        {
          action: 'update',
          entityKind: 'security_event',
          entityId: id,
          before: {
            acknowledgedAt: event.acknowledgedAt?.toISOString() ?? null,
            resolution: event.resolution,
          },
          after: { resolution: body.resolution ?? null },
        },
        actor,
      );

      return { ok: true };
    },
  );
}
