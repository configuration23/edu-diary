import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { PutObjectInput, StorageAdapter, StoredObject } from './storage.adapter';

/**
 * Внешнее S3-совместимое хранилище (MinIO, S3 в инфраструктуре заведения).
 *
 * Настраивается **как внешнее**: адрес, bucket, регион и ключи задаёт администратор. Это
 * требование владельца — чтобы на проде не дорабатывать. Никаких предположений о том, что
 * хранилище рядом с приложением, здесь нет.
 *
 * `forcePathStyle` включён: MinIO и большинство частных S3-совместимых сервисов работают
 * со стилем пути, а не с поддоменом на каждый bucket.
 *
 * Требование 152-ФЗ касается **хранилища**, а не библиотеки: файлы лежат там, где решит
 * заведение (на своём сервере в РФ).
 */
export interface S3StorageConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createS3Storage(config: S3StorageConfig): StorageAdapter {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    kind: 's3',

    async put(input: PutObjectInput): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.mimeType,
        }),
      );
    },

    async get(key: string): Promise<StoredObject | null> {
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        );

        const body = Buffer.from(await response.Body!.transformToByteArray());
        return { key, body, mimeType: response.ContentType ?? 'application/octet-stream' };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async remove(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },

    async health(): Promise<{ ok: boolean; detail: string | null }> {
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
        return { ok: true, detail: `${config.endpoint}/${config.bucket}` };
      } catch (error) {
        return { ok: false, detail: describeError(error) };
      }
    },
  };
}

/** Объекта нет: для вызывающего это `null`, а не исключение. */
function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: string }).name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

/**
 * Понятная причина отказа.
 *
 * Значения ключей в сообщение не попадают: они могут оказаться в журнале и в отчёте об
 * ошибке, а это уже утечка.
 */
function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const name = (error as { name?: string }).name ?? 'Ошибка';
  const message = (error as { message?: string }).message ?? '';
  return `${name}: ${message}`;
}
