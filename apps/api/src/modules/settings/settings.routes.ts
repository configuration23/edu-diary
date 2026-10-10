import { brandingSchema, updateBrandingRequestSchema } from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import type { Database } from '../../shared/db/client';
import { withTransaction } from '../../shared/db/transaction';
import { requirePermission } from '../../shared/guards';
import type { AuditService } from '../audit';
import type { SettingsService } from './settings.service';

/**
 * Маршруты настроек: брендинг после мастера.
 *
 * Чтение доступно любому сотруднику (`academics:read`), правка — только тому, у
 * кого есть `settings:write`. Значения применяются сразу: экран входа и шапка
 * берут брендинг из `/api/setup/status`, поэтому после сохранения достаточно
 * перечитать состояние.
 */
export function registerSettingsRoutes(
  app: FastifyInstance,
  dependencies: { db: Database; settings: SettingsService; audit: AuditService },
): void {
  const { db, settings, audit } = dependencies;

  app.get(
    '/settings/branding',
    { preHandler: requirePermission('academics:read', 'assigned') },
    async () => {
      return brandingSchema.parse(await settings.readBranding());
    },
  );

  app.put(
    '/settings/branding',
    { preHandler: requirePermission('settings:write', 'all') },
    async (request) => {
      const input = updateBrandingRequestSchema.parse(request.body);

      const branding = await withTransaction(db, undefined, async (tx) => {
        const change = await settings.updateBranding(input, request.auth?.userId ?? null, tx);

        await audit.record(
          {
            action: 'update',
            entityKind: 'branding',
            entityId: null,
            before: change.before,
            after: change.changed,
          },
          actorFromRequest(request),
          tx,
        );

        return change.branding;
      });

      return brandingSchema.parse(branding);
    },
  );
}
