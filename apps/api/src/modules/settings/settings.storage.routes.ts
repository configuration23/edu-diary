import { storageSettingsSchema, updateStorageSettingsRequestSchema } from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import type { Database } from '../../shared/db/client';
import { requirePermission } from '../../shared/guards';
import type { AuditService } from '../audit';
import { testStorageConnection, type StorageService } from '../storage';
import type { SettingsService } from './settings.service';

/**
 * Настройки хранилища файлов.
 *
 * Правка — только администратор (`settings:write` со всей областью): адрес хранилища и ключи
 * доступа к нему это **системная** настройка, а не рабочая. Разделение «бизнес и системные
 * настройки» через отдельную роль записано в `BACKLOG.md`.
 *
 * Ключи доступа **никогда не отдаются обратно** в открытом виде: в ответе только признак
 * «задан», иначе сохранённый пароль утекал бы в браузер и в историю.
 */
export function registerStorageSettingsRoutes(
  app: FastifyInstance,
  dependencies: {
    db: Database;
    settings: SettingsService;
    audit: AuditService;
    storage: StorageService;
  },
): void {
  const { settings, audit, storage } = dependencies;

  const readStorageSettings = async () => {
    const provider = (await settings.get<string>('storage.provider')) ?? 'local';

    return storageSettingsSchema.parse({
      provider,
      localPath: await settings.get<string>('storage.local_path'),
      endpoint: await settings.get<string>('storage.s3_endpoint'),
      bucket: await settings.get<string>('storage.s3_bucket'),
      region: (await settings.get<string>('storage.s3_region')) ?? 'us-east-1',
      /** Сам ключ не отдаём: только признак, что он задан. */
      accessKeySet: (await settings.get<string>('storage.s3_access_key')) !== null,
      secretKeySet: (await settings.get<string>('storage.s3_secret_key')) !== null,
      maxFileMb: (await settings.get<number>('storage.max_file_mb')) ?? 10,
      allowedTypes: await settings.get<string>('storage.allowed_types'),
    });
  };

  app.get(
    '/settings/storage',
    { preHandler: requirePermission('settings:write', 'all') },
    async () => readStorageSettings(),
  );

  app.put(
    '/settings/storage',
    { preHandler: requirePermission('settings:write', 'all') },
    async (request) => {
      const input = updateStorageSettingsRequestSchema.parse(request.body);

      const writes: [string, unknown][] = [];
      if (input.provider !== undefined) writes.push(['storage.provider', input.provider]);
      if (input.localPath !== undefined) writes.push(['storage.local_path', input.localPath]);
      if (input.endpoint !== undefined) writes.push(['storage.s3_endpoint', input.endpoint]);
      if (input.bucket !== undefined) writes.push(['storage.s3_bucket', input.bucket]);
      if (input.region !== undefined) writes.push(['storage.s3_region', input.region]);
      if (input.maxFileMb !== undefined) writes.push(['storage.max_file_mb', input.maxFileMb]);
      if (input.allowedTypes !== undefined) {
        writes.push(['storage.allowed_types', input.allowedTypes]);
      }

      /**
       * Ключи доступа шифруем перед записью: в открытом виде они попали бы в дамп базы и в
       * резервную копию. Пустая строка означает «не менять» — иначе сохранение формы без
       * повторного ввода пароля стёрло бы его.
       */
      if (input.accessKey !== undefined && input.accessKey !== '') {
        writes.push(['storage.s3_access_key', storage.encrypt(input.accessKey)]);
      }
      if (input.secretKey !== undefined && input.secretKey !== '') {
        writes.push(['storage.s3_secret_key', storage.encrypt(input.secretKey)]);
      }

      for (const [key, value] of writes) {
        await settings.set(key, value);
      }

      await audit.record(
        {
          action: 'update',
          entityKind: 'setting',
          /**
           * entityId не задаём: колонка имеет тип uuid, а настройка опознаётся ключом,
           * а не идентификатором. Слово «storage» в этой колонке давало ошибку базы
           * 22P02 и отказ 500 при сохранении настроек.
           */
          entityId: null,
          /**
           * Значения ключей в аудит не пишем: только факт смены и состав изменений. Ключи
           * настроек — это и есть «идентификатор» настройки, поэтому они здесь.
           */
          after: { keys: writes.map(([key]) => key) },
        },
        actorFromRequest(request),
      );

      return readStorageSettings();
    },
  );

  /**
   * Проверка подключения.
   *
   * Пишет настоящий файл в хранилище, читает его обратно и удаляет: так проверяются права на
   * запись и чтение, а не только доступность сервера. Значения из формы имеют приоритет —
   * проверить можно **до** сохранения.
   */
  app.post(
    '/settings/storage/test',
    { preHandler: requirePermission('settings:write', 'all') },
    async (request) => {
      const body = updateStorageSettingsRequestSchema.parse(request.body ?? {});

      const adapter = await storage.adapter({
        ...(body.provider === undefined ? {} : { provider: body.provider }),
        ...(body.localPath === undefined ? {} : { localPath: body.localPath }),
        ...(body.endpoint === undefined ? {} : { endpoint: body.endpoint }),
        ...(body.bucket === undefined ? {} : { bucket: body.bucket }),
        ...(body.region === undefined ? {} : { region: body.region }),
        ...(body.accessKey === undefined || body.accessKey === ''
          ? {}
          : { accessKey: body.accessKey }),
        ...(body.secretKey === undefined || body.secretKey === ''
          ? {}
          : { secretKey: body.secretKey }),
      });

      const result = await testStorageConnection(adapter);

      await audit.record(
        {
          action: 'storage_test',
          entityKind: 'setting',
          /** Тот же случай: настройка опознаётся ключом, а не uuid. */
          entityId: null,
          after: { provider: body.provider ?? 'текущий', ok: result.ok, step: result.step },
        },
        actorFromRequest(request),
      );

      return result;
    },
  );
}
