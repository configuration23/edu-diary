import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';

import {
  createNewsRequestSchema,
  listNewsQuerySchema,
  listNewsResponseSchema,
  updateNewsRequestSchema,
  uploadFileResponseSchema,
} from '@edu-diary/contracts';

import { actorFromRequest } from '../../shared/actor';
import { AppError } from '../../shared/errors';
import { authOf, requirePermission } from '../../shared/guards';
import type { AuditService } from '../audit';
import { createFileService, type FileService, type FileSink } from '../media';
import { createNewsImageRepository } from './news.images.repository';
import { createNewsRepository } from './news.repository';
import { createNewsService, type NewsService, type NewsViewer } from './news.service';

/**
 * Маршруты новостей.
 *
 * Чтение — **всем вошедшим**: новости видны каждому (решение владельца). Публикация, правка и
 * удаление — `news:write`: администратору сейчас, будущей роли директора потом. Право заведено
 * **отдельным** именно поэтому: чтобы не переписывать маршруты ради новой роли.
 *
 * Картинка принимается **своим** маршрутом, а не маршрутом вложений задания: файл пишется в свою
 * таблицу, иначе привязка картинки искала бы её среди материалов заданий.
 */

export function createNewsModule(dependencies: {
  db: Parameters<typeof createNewsRepository>[0];
  /**
   * Тот же адаптер хранилища, что у домашних заданий: картинки лежат **там же**, где вложения
   * заданий, и переключаются вместе с ними одной настройкой. Отдельное подключение к S3 для
   * новостей не нужно — подтверждено владельцем.
   */
  storageAdapter: Parameters<typeof createFileService>[0]['adapter'];
  storageLimits: () => Promise<{ maxFileMb: number; allowedExtensions: readonly string[] }>;
  audit: AuditService;
}): (app: FastifyInstance) => Promise<void> {
  const repository = createNewsRepository(dependencies.db);
  const imageRepository = createNewsImageRepository(dependencies.db);
  const files: FileService = createFileService({ adapter: dependencies.storageAdapter });

  return async function newsModule(app: FastifyInstance): Promise<void> {
    await app.register(multipart);

    const service: NewsService = createNewsService({ repository, images: imageRepository });

    const viewerOf = (request: Parameters<typeof authOf>[0]): NewsViewer => {
      const auth = authOf(request);

      return { userId: auth.userId, permissions: auth.permissions };
    };

    app.post(
      '/news/images',
      { preHandler: requirePermission('news:write', 'all') },
      async (request, reply) => {
        const viewer = viewerOf(request);

        const file = await request.file();
        if (file === undefined) throw new AppError('VALIDATION_FAILED', 'Файл не передан');

        const limits = await dependencies.storageLimits();
        const uploaded = await files.upload({
          fileName: file.filename,
          body: await file.toBuffer(),
          uploadedBy: viewer.userId,
          maxFileMb: limits.maxFileMb,
          allowedExtensions: limits.allowedExtensions,
          repository: imageRepository,
        });

        await dependencies.audit.record(
          { action: 'create', entityKind: 'news_image', entityId: uploaded.id },
          actorFromRequest(request),
        );

        reply.status(201);
        return uploadFileResponseSchema.parse(uploaded);
      },
    );

    /**
     * Список новостей.
     *
     * `forEditing=true` открывает и подготовленные, и просроченные — иначе новость, поставленную на
     * будущее, нельзя было бы найти и поправить. Доступно только публикующим.
     */
    app.get('/news', { preHandler: requirePermission('news:read', 'all') }, async (request) => {
      const query = listNewsQuerySchema.parse(request.query);
      const forEditing = (request.query as { forEditing?: string }).forEditing === 'true';

      if (forEditing && authOf(request).permissions.get('news:write') !== 'all') {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: news:write');
      }

      const items = await service.list({
        viewer: viewerOf(request),
        limit: query.limit,
        ...(forEditing ? { forEditing: true } : {}),
      });

      return listNewsResponseSchema.parse({ items, total: items.length });
    });

    /**
     * Картинка новости.
     *
     * Отдаём **через API**, а не ссылкой на хранилище: тогда нельзя достать файл в обход прав.
     * Отдельного права не требуем — читать новости вправе любой вошедший.
     */
    app.get(
      '/news/images/:imageId',
      { preHandler: requirePermission('news:read', 'all') },
      async (request, reply) => {
        const { imageId } = request.params as { imageId: string };

        const image = await service.findImage(imageId);
        if (image === null) throw new AppError('NOT_FOUND', 'Картинка не найдена');

        const body = await files.read(image.storageKey);
        if (body === null) throw new AppError('NOT_FOUND', 'Картинка не найдена');

        return reply
          .header('content-type', image.mimeType)
          .header('cache-control', 'private, max-age=300')
          .send(body);
      },
    );

    app.post(
      '/news',
      { preHandler: requirePermission('news:write', 'all') },
      async (request, reply) => {
        const body = createNewsRequestSchema.parse(request.body);

        const created = await service.create({
          viewer: viewerOf(request),
          title: body.title,
          body: body.body,
          ...(body.publishedOn === undefined ? {} : { publishedOn: body.publishedOn }),
          ...(body.visibleUntil === undefined ? {} : { visibleUntil: body.visibleUntil ?? null }),
          ...(body.imageFileId === undefined ? {} : { imageFileId: body.imageFileId ?? null }),
        });

        await dependencies.audit.record(
          {
            action: 'create',
            entityKind: 'news_item',
            entityId: created.id,
            after: { title: body.title },
          },
          actorFromRequest(request),
        );

        reply.status(201);
        return { id: created.id };
      },
    );

    app.patch(
      '/news/:newsId',
      { preHandler: requirePermission('news:write', 'all') },
      async (request) => {
        const { newsId } = request.params as { newsId: string };
        const body = updateNewsRequestSchema.parse(request.body);

        const change = await service.update({
          viewer: viewerOf(request),
          id: newsId,
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(body.body === undefined ? {} : { body: body.body }),
          ...(body.publishedOn === undefined ? {} : { publishedOn: body.publishedOn }),
          ...(body.visibleUntil === undefined ? {} : { visibleUntil: body.visibleUntil ?? null }),
          ...(body.imageFileId === undefined ? {} : { imageFileId: body.imageFileId ?? null }),
        });

        /** В аудит пишем **до и после**: спор «я это не менял» решается фактами. */
        await dependencies.audit.record(
          {
            action: 'update',
            entityKind: 'news_item',
            entityId: newsId,
            before: change.before,
            after: change.after,
          },
          actorFromRequest(request),
        );

        return { ok: true };
      },
    );

    app.delete(
      '/news/:newsId',
      { preHandler: requirePermission('news:write', 'all') },
      async (request) => {
        const { newsId } = request.params as { newsId: string };

        const removed = await service.remove({ viewer: viewerOf(request), id: newsId });

        /** Удаление **мягкое**: новость скрывается, а снимок остаётся в аудите. */
        await dependencies.audit.record(
          {
            action: 'delete',
            entityKind: 'news_item',
            entityId: newsId,
            before: removed.removed,
          },
          actorFromRequest(request),
        );

        return { ok: true };
      },
    );
  };
}

export type { FileSink };
