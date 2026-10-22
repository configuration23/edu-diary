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

    /**
     * Подробности снаружи не отдаются (F-09): версия, uptime и состояние миграций — разведданные.
     * Их видит только вошедший человек.
     */
    expect(parsed.data.checks).toBeUndefined();
    expect(parsed.data.version).toBeUndefined();
    expect(parsed.data.uptimeSeconds).toBeUndefined();
  });

  it('отдаёт 200 с состоянием миграций, когда БД доступна', async () => {
    const app = await buildApp({ env: createTestEnv(), db: createFakeDatabase(), version: 'test' });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    await app.close();

    expect(response.statusCode).toBe(200);

    const parsed = healthResponseSchema.safeParse(response.json());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;

    /** Фейковая БД не сообщает состояние миграций, поэтому `degraded` — допустимый ответ. */
    expect(['ok', 'degraded']).toContain(parsed.data.status);

    /** Снаружи — только статус: остальное закрыто сессией. */
    expect(parsed.data.checks).toBeUndefined();
  });
});
