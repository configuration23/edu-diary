import { defineConfig, devices } from '@playwright/test';

/**
 * Сквозные сценарии (ARCHITECTURE.md §13.4).
 *
 * Playwright поднимает собранный API (порт 3000) и предпросмотр собранного
 * фронтенда (порт 4173, как в apps/web/vite.config.ts). Проверяется тот же
 * путь, что и в compose: браузер → фронтенд → /api → база.
 *
 * Нужна доступная PostgreSQL: строку подключения API берёт из окружения
 * (локально — из .env при NODE_ENV=development), миграции применяются заранее
 * командой `npm run migrate`.
 *
 * `stdout`/`stderr: 'ignore'` — чтобы серверы не занимали каналы вывода.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: 'npm run preview -w apps/web',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
  ],
});
