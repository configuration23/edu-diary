import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { testStorageConnection } from '../src/modules/storage/storage.check';
import { createLocalStorage } from '../src/modules/storage/storage.local';
import { createS3Storage } from '../src/modules/storage/storage.s3';

/**
 * Проверка подключения к хранилищу.
 *
 * Проверка **одна и та же** для локального каталога и для S3: оба скрыты за общим
 * интерфейсом, и кнопка в интерфейсе меняет поведение вслед за выбранным типом. Здесь это и
 * проверяется — на обоих вариантах, чтобы «работает на local» не выдавалось за «работает».
 */

describe('проверка подключения: локальный каталог', () => {
  it('рабочий каталог проходит проверку и не оставляет мусора', async () => {
    const root = await mkdtemp(join(tmpdir(), 'edu-diary-check-'));
    const storage = createLocalStorage(root);

    const result = await testStorageConnection(storage);
    expect(result.ok, result.detail ?? '').toBe(true);
    expect(result.step).toBe('done');
    expect(result.checked).toContain('локальный');

    // Пробный файл удалён за собой: в хранилище не должно остаться следов проверки.
    const files = await storage.get(`connection-test/нет`);
    expect(files).toBeNull();

    await rm(root, { recursive: true, force: true });
  });
});

/**
 * Внешнее S3: проверка включается переменными окружения и пропускается без них — обычный
 * прогон не должен зависеть от доступности внешнего сервера.
 */
const s3Config = {
  endpoint: process.env.S3_TEST_ENDPOINT ?? '',
  bucket: process.env.S3_TEST_BUCKET ?? '',
  accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? '',
  secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? '',
};

const hasS3 = Object.values(s3Config).every((value) => value !== '');

describe.skipIf(!hasS3)('проверка подключения: внешнее S3', () => {
  it('рабочее хранилище проходит ту же проверку', async () => {
    const storage = createS3Storage({ ...s3Config, region: 'us-east-1' });

    const result = await testStorageConnection(storage);
    expect(result.ok, result.detail ?? '').toBe(true);
    expect(result.step).toBe('done');
    // Отличается только формулировка: администратор должен понимать, куда смотреть.
    expect(result.checked).toContain('S3');
  });

  it('неверные ключи дают отказ с понятной причиной', async () => {
    const storage = createS3Storage({
      ...s3Config,
      region: 'us-east-1',
      accessKeyId: 'неверный-ключ',
      secretAccessKey: 'неверный-секрет',
    });

    const result = await testStorageConnection(storage);
    expect(result.ok).toBe(false);
    expect(result.step).toBe('health');
    expect(result.checked).toContain('S3');
    // Значения ключей в сообщение не попадают: иначе они утекли бы в журнал.
    expect(result.detail ?? '').not.toContain('неверный-секрет');
  });
});
