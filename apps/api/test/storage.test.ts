import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, isEncrypted } from '../src/modules/storage/storage.crypto';
import { objectKey } from '../src/modules/storage/storage.adapter';
import { createLocalStorage } from '../src/modules/storage/storage.local';
import { createS3Storage } from '../src/modules/storage/storage.s3';

/**
 * Хранилище: локальный адаптер и адаптер S3.
 *
 * Локальный проверяется всегда. Проверка на **настоящем S3** включается переменными
 * окружения и пропускается, если их нет: набор тестов не должен зависеть от того, доступен
 * ли внешний стенд.
 */

const KEY = 'test-encryption-key-for-unit-tests-32b';

describe('шифрование ключей доступа', () => {
  it('значение расшифровывается обратно', () => {
    const encrypted = encryptSecret('секретный-ключ', KEY);

    expect(encrypted).not.toContain('секретный-ключ');
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decryptSecret(encrypted, KEY)).toBe('секретный-ключ');
  });

  it('другим ключом не расшифровывается', () => {
    const encrypted = encryptSecret('секретный-ключ', KEY);

    // Ключ окружения сменили: расшифровать нельзя, и это не повод падать приложению.
    expect(decryptSecret(encrypted, 'другой-ключ')).toBeNull();
  });

  it('испорченное значение не ломает приложение', () => {
    expect(decryptSecret('v1:ерунда', KEY)).toBeNull();
    expect(decryptSecret('совсем-не-шифр', KEY)).toBeNull();
    expect(isEncrypted('совсем-не-шифр')).toBe(false);
  });

  it('два шифрования одного значения дают разные результаты', () => {
    // Иначе по одинаковым строкам в базе было бы видно, что ключи совпадают.
    expect(encryptSecret('одно', KEY)).not.toBe(encryptSecret('одно', KEY));
  });
});

describe('ключ объекта', () => {
  it('не содержит исходного имени файла', () => {
    const key = objectKey('pdf');

    expect(key.endsWith('.pdf')).toBe(true);
    expect(key).not.toContain('документ');
  });

  it('ключи не повторяются', () => {
    const keys = new Set(Array.from({ length: 100 }, () => objectKey('txt')));

    expect(keys.size).toBe(100);
  });

  it('посторонние символы в расширении не попадают в ключ', () => {
    // Расширение приходит из имени файла: там может оказаться что угодно.
    const key = objectKey('p/d.f');

    expect(key).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });
});

describe('локальное хранилище', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'edu-diary-storage-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('файл записывается, читается и удаляется', async () => {
    const storage = createLocalStorage(root);
    const key = objectKey('txt');

    await storage.put({ key, body: Buffer.from('решение ученика'), mimeType: 'text/plain' });

    const stored = await storage.get(key);
    expect(stored?.body.toString('utf8')).toBe('решение ученика');

    await storage.remove(key);
    expect(await storage.get(key)).toBeNull();
  });

  it('чужого объекта нет — возвращается null, а не ошибка', async () => {
    const storage = createLocalStorage(root);

    expect(await storage.get('нет-такого-файла.txt')).toBeNull();
  });

  it('ключ с выходом из каталога отклоняется', async () => {
    const storage = createLocalStorage(root);

    /**
     * Ключи генерирует `objectKey`, но проверка нужна: цена ошибки — чтение или запись
     * произвольного файла на сервере.
     */
    await expect(storage.get('../секрет.txt')).rejects.toThrow('вне хранилища');
    await expect(
      storage.put({ key: '../../секрет.txt', body: Buffer.from('x'), mimeType: 'text/plain' }),
    ).rejects.toThrow('вне хранилища');
  });

  it('хранилище отвечает, что работоспособно', async () => {
    const storage = createLocalStorage(root);
    const health = await storage.health();

    expect(health.ok).toBe(true);
  });
});

/**
 * Проверка на **настоящем** S3.
 *
 * Включается переменными окружения:
 *
 * ```
 * S3_TEST_ENDPOINT=http://192.168.1.95:9000
 * S3_TEST_BUCKET=edu-diary-dev
 * S3_TEST_ACCESS_KEY=...
 * S3_TEST_SECRET_KEY=...
 * ```
 *
 * Без них проверка пропускается: обычный прогон не должен зависеть от внешнего стенда.
 * Используется **отдельный префикс** и свои объекты удаляются за собой — чужие данные в
 * общем хранилище не трогаем.
 */
const s3Config = {
  endpoint: process.env.S3_TEST_ENDPOINT ?? '',
  bucket: process.env.S3_TEST_BUCKET ?? '',
  accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? '',
  secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? '',
};

const hasS3 = Object.values(s3Config).every((value) => value !== '');

describe.skipIf(!hasS3)('внешнее S3-хранилище', () => {
  it('файл записывается, читается и удаляется', async () => {
    const storage = createS3Storage({ ...s3Config, region: 'us-east-1' });

    const health = await storage.health();
    expect(health.ok, health.detail ?? '').toBe(true);

    const key = `test/${objectKey('txt')}`;
    await storage.put({
      key,
      body: Buffer.from('проверка внешнего хранилища'),
      mimeType: 'text/plain',
    });

    const stored = await storage.get(key);
    expect(stored?.body.toString('utf8')).toBe('проверка внешнего хранилища');

    await storage.remove(key);
    expect(await storage.get(key)).toBeNull();
  });
});
