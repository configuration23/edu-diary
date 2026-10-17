import {
  aboutSchema,
  appearanceSchema,
  brandingSchema,
  updateAppearanceRequestSchema,
  updateBrandingRequestSchema,
} from '@edu-diary/contracts';
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

  /**
   * Блок «О колледже» для страницы «Обзор».
   *
   * Отдельный маршрут, а не брендинг: брендинг требует `academics:read`, и у ученика с
   * представителем его нет — «Обзор» отвечал `403` на весь запрос. Здесь отдаём **только**
   * заголовок и текст, ничего служебного, и открываем **всем вошедшим**: это сведения о заведении,
   * которые видит каждый.
   */
  app.get('/settings/about', { preHandler: requirePermission('news:read', 'all') }, async () => {
    const branding = await settings.readBranding();

    return aboutSchema.parse({
      title: branding.aboutTitle,
      text: branding.aboutText,
    });
  });
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

  /**
   * Оформление уроков: значки событий и цвета предметов.
   *
   * Читают все, кто видит уроки, — интерфейс рисует значки по этой настройке.
   * Меняет только администратор (`settings:write`), как и договорено.
   */
  app.get('/settings/appearance', { preHandler: requirePermission('lessons:read') }, async () => {
    return appearanceSchema.parse(await settings.readAppearance());
  });

  app.put(
    '/settings/appearance',
    { preHandler: requirePermission('settings:write', 'all') },
    async (request) => {
      const input = updateAppearanceRequestSchema.parse(request.body);

      const appearance = await withTransaction(db, undefined, async (tx) => {
        const change = await settings.updateAppearance(input, request.auth?.userId ?? null, tx);

        await audit.record(
          {
            action: 'update',
            entityKind: 'appearance',
            entityId: null,
            before: change.before,
            after: change.changed,
          },
          actorFromRequest(request),
          tx,
        );

        return change.appearance;
      });

      return appearanceSchema.parse(appearance);
    },
  );
}
