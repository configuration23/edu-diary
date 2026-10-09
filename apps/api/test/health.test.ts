import { healthResponseSchema } from '@edu-diary/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/shared/db/client';
import { createFakeDatabase, createTestEnv } from './helpers';

const databases: Database[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

function unreachableDatabase(): Database {
  // Порт 1 закрыт: проверяем поведение при недоступной БД без внешних сервисов.
  const db = createDatabase('postgres://edu_diary:edu_diary@127.0.0.1:1/edu_diary', {
    max: 1,
    connectTimeoutSeconds: 1,
  });
  databases.push(db);
  return db;
}

describe('GET /api/health', () => {
  it('отвечает 503 и объясняет, что база недоступна', async () => {
    const app = await buildApp({
      env: createTestEnv(),
      db: unreachableDatabase(),
      version: 'test',
    });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    await app.close();

    expect(response.statusCode).toBe(503);

    const parsed = healthResponseSchema.safeParse(response.json());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.status).toBe('degraded');
    expect(parsed.data.checks.database.status).toBe('error');
    expect(parsed.data.checks.migrations.status).toBe('unknown');
    expect(parsed.data.setup.initialized).toBeNull();
    expect(parsed.data.version).toBe('test');
  });

  it('отдаёт 200 с состоянием миграций, когда БД доступна', async () => {
    const app = await buildApp({ env: createTestEnv(), db: createFakeDatabase(), version: 'test' });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    await app.close();

    expect(response.statusCode).toBe(200);

    const parsed = healthResponseSchema.safeParse(response.json());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.checks.database.status).toBe('ok');
    expect(parsed.data.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(parsed.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
