import { healthResponseSchema } from '@edu-diary/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { createDatabase, type Database } from '../src/shared/db/client';
import { runMigrations } from '../src/shared/db/migrate';
import { readMigrationsState } from '../src/shared/db/migrations-state';
import { createTestEnv } from './helpers';

/**
 * Интеграционные проверки требуют PostgreSQL: задайте TEST_DATABASE_URL
 * (в CI он указывает на служебную базу). Без переменной тесты пропускаются,
 * чтобы `npm test` работал на машине без базы.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = describe.skipIf(!databaseUrl);

describeWithDatabase('работа с реальной базой', () => {
  let db: Database;

  beforeAll(async () => {
    db = createDatabase(databaseUrl ?? '', { max: 4, connectTimeoutSeconds: 5 });
  });

  afterAll(async () => {
    await db?.close();
  });

  it('npm run migrate применяет миграции и делает состояние ok', async () => {
    const result = await runMigrations(db);
    expect(result.total).toBeGreaterThan(0);

    const state = await readMigrationsState(db);
    expect(state.status).toBe('ok');
    expect(state.pending).toBe(0);
    expect(state.applied).toBe(result.total);
  });

  it('повторный запуск миграций ничего не меняет', async () => {
    const second = await runMigrations(db);
    expect(second.applied).toBe(0);
  });

  it('/api/health отвечает 200 и показывает ненастроенную систему', async () => {
    const app = await buildApp({
      env: createTestEnv({ databaseUrl: databaseUrl ?? '' }),
      db,
      version: 'test',
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    await app.close();

    expect(response.statusCode).toBe(200);

    const parsed = healthResponseSchema.safeParse(response.json());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.status).toBe('ok');
    expect(parsed.data.checks.database.status).toBe('ok');
    expect(parsed.data.checks.migrations.status).toBe('ok');
    expect(parsed.data.checks.migrations.pending).toBe(0);
    expect(parsed.data.setup.initialized).toBe(false);
  });
});
