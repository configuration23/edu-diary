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
    checks?: unknown;
    version?: unknown;
  };

  expect(body.status).toBe('ok');

  /**
   * Снаружи виден только статус: версия, uptime и состояние миграций — разведданные для
   * атакующего (F-09). Стенд проверяет именно это, а подробности видны администратору в профиле.
   */
  expect(body.checks).toBeUndefined();
  expect(body.version).toBeUndefined();
});

test('страница не обращается к внешним доменам', async ({ page }) => {
  const externalRequests: string[] = [];

  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) externalRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();

  expect(externalRequests).toEqual([]);
});
