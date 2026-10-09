import { randomBytes } from 'node:crypto';

import { afterAll } from 'vitest';
import postgres from 'postgres';

import { createDatabase, type Database } from '../../src/shared/db/client';
import { runMigrations } from '../../src/shared/db/migrate';

/**
 * Изолированная база для файла тестов.
 *
 * Каждый файл создаёт собственную базу: тесты Этапа 1 меняют состояние системы
 * (мастер настройки, пользователи, согласия), и общая база делала бы результат
 * зависимым от порядка запуска.
 */

const adminUrl = process.env.TEST_DATABASE_URL;

export const hasTestDatabase = typeof adminUrl === 'string' && adminUrl !== '';

export interface TestDatabase {
  db: Database;
  url: string;
  dispose(): Promise<void>;
}

function databaseUrlFor(name: string): string {
  const url = new URL(adminUrl ?? '');
  url.pathname = `/${name}`;
  return url.toString();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  if (!hasTestDatabase) {
    throw new Error('TEST_DATABASE_URL не задан: тесты с базой пропускаются');
  }

  const name = `edu_diary_test_${randomBytes(4).toString('hex')}`;

  const admin = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database "${name}"`);
  await admin.end({ timeout: 5 });

  const db = createDatabase(databaseUrlFor(name), { max: 4, connectTimeoutSeconds: 5 });
  await runMigrations(db);

  return {
    db,
    url: databaseUrlFor(name),
    async dispose(): Promise<void> {
      await db.close();

      const cleanup = postgres(adminUrl as string, { max: 1, onnotice: () => {} });
      await cleanup.unsafe(`drop database if exists "${name}" with (force)`);
      await cleanup.end({ timeout: 5 });
    },
  };
}

/** Регистрирует создание/удаление базы на время файла тестов. */
export function useTestDatabase(): () => TestDatabase {
  let database: TestDatabase | null = null;

  afterAll(async () => {
    await database?.dispose();
    database = null;
  });

  return () => {
    if (database === null) {
      throw new Error('База ещё не создана: вызовите useTestDatabase() в beforeAll');
    }
    return database;
  };
}
