import type { Database, DatabasePing } from '../src/shared/db/client';
import type { AppEnv } from '../src/shared/env';

/** Значения, при которых проверки окружения проходят. */
export const VALID_ENV: AppEnv = {
  nodeEnv: 'test',
  isProduction: false,
  isTest: true,
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  logPretty: false,
  databaseUrl: 'postgres://edu_diary:secret@localhost:5432/edu_diary',
  sessionSecret: 'unit-test-session-secret-with-more-than-32-characters',
  storageEncryptionKey: Buffer.alloc(32, 7).toString('base64'),
  testDatabaseUrl: null,
};

export function createTestEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return { ...VALID_ENV, ...overrides };
}

/** База-заглушка: тесты, которым нужен только HTTP-слой, не ходят в PostgreSQL. */
export function createFakeDatabase(
  overrides: { ping?: () => Promise<DatabasePing>; close?: () => Promise<void> } = {},
): Database {
  return {
    sql: (() => {
      throw new Error('Заглушка базы: SQL в этом тесте не поддерживается');
    }) as unknown as Database['sql'],
    orm: {} as unknown as Database['orm'],
    ping: overrides.ping ?? (async () => ({ ok: true, latencyMs: 1 })),
    // Заглушка транзакции: выполняет операцию с тем же пустым исполнителем.
    transaction: (operation) => operation({} as unknown as Database['orm']),
    close: overrides.close ?? (async () => {}),
  };
}

/** Разбирает .env.example: только строки вида КЛЮЧ=значение. */
export function parseExampleEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }

  return result;
}
