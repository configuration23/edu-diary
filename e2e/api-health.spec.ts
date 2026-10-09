import { expect, test } from '@playwright/test';

/** Идём через прокси фронтенда: проверяется тот же путь, что и через Caddy. */
test('GET /api/health отвечает 200 и подтверждает готовность БД и миграций', async ({
  request,
}) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(response.headers()['x-request-id']).toBeTruthy();

  const body = (await response.json()) as {
    status: string;
    checks: { database: { status: string }; migrations: { status: string; pending: number } };
  };

  expect(body.status).toBe('ok');
  expect(body.checks.database.status).toBe('ok');
  expect(body.checks.migrations.status).toBe('ok');
  expect(body.checks.migrations.pending).toBe(0);
});

test('неизвестный маршрут отвечает контрактной ошибкой без параметров запроса', async ({
  request,
}) => {
  const response = await request.get('/api/unknown-route?token=secret-value');

  expect(response.status()).toBe(404);
  expect(response.headers()['x-request-id']).toBeTruthy();

  const body = (await response.json()) as { error: { code: string; message: string } };
  expect(body.error).toEqual({
    code: 'NOT_FOUND',
    message: 'Маршрут GET /api/unknown-route не найден',
  });
  expect(JSON.stringify(body)).not.toContain('secret-value');
});
