import { expect, test } from '@playwright/test';

test('страница показывает состояние системы', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Электронный дневник' })).toBeVisible();
  await expect(page.getByTestId('health-status')).toContainText('Сервер и база данных доступны');
  await expect(page.getByTestId('health-status')).toContainText('подключение есть');
  await expect(page.getByTestId('health-status')).toContainText('применены');
});

test('страница не обращается к внешним доменам', async ({ page }) => {
  const externalRequests: string[] = [];

  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) externalRequests.push(request.url());
  });

  await page.goto('/');
  await expect(page.getByTestId('health-status')).toContainText('Сервер и база данных доступны');

  expect(externalRequests).toEqual([]);
});
