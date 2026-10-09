import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';
import { AppError } from '../src/shared/errors';
import { createFakeDatabase, createTestEnv } from './helpers';

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

async function buildTestApp(): Promise<Awaited<ReturnType<typeof buildApp>>> {
  const app = await buildApp({
    env: createTestEnv(),
    db: createFakeDatabase(),
    version: 'test',
    // Гейт «система настроена» в этом файле не проверяется: он читал бы базу.
    systemState: { isInitialized: async () => true },
  });

  app.get('/api/boom', async () => {
    throw new AppError('CONFLICT', 'Учебный год уже существует');
  });
  app.get('/api/crash', async () => {
    throw new Error('внутренняя подробность, которую нельзя показывать');
  });
  app.get(
    '/api/validated',
    {
      schema: {
        querystring: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async () => ({ ok: true }),
  );

  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('единый формат ошибок', () => {
  it('404 отдаёт контрактный ответ без параметров строки запроса', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/unknown?token=secret' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Маршрут GET /api/unknown не найден' },
    });
    expect(response.body).not.toContain('secret');
  });

  it('AppError отдаёт свой код и сообщение', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/boom' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'CONFLICT', message: 'Учебный год уже существует' },
    });
  });

  it('неожиданная ошибка превращается в INTERNAL_ERROR без подробностей', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/crash' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' },
    });
    expect(response.body).not.toContain('внутренняя подробность');
  });

  it('ошибка валидации Fastify отдаёт VALIDATION_FAILED с деталями', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/validated' });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details?: unknown } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(body.error.details)).toBe(true);
  });
});

describe('идентификатор запроса', () => {
  it('возвращается в заголовке и генерируется, если не передан', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/unknown' });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('принимает безопасный идентификатор клиента', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/unknown',
      headers: { 'x-request-id': 'client-request-0001' },
    });

    expect(response.headers['x-request-id']).toBe('client-request-0001');
  });

  it('отбрасывает подозрительный идентификатор', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/unknown',
      headers: { 'x-request-id': '<script>alert(1)</script>' },
    });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
