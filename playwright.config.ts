import { defineConfig, devices } from '@playwright/test';

/**
 * Сквозные сценарии (ARCHITECTURE.md §13.4).
 *
 * Playwright поднимает собранный API (порт 3000) и предпросмотр собранного
 * фронтенда (порт 4173, как в apps/web/vite.config.ts). Проверяется тот же
 * путь, что и в compose: браузер → фронтенд → /api → база.
 *
 * Нужна доступная PostgreSQL: миграции применяются заранее командой
 * `npm run migrate`. Локально секреты и строку подключения API берёт из `.env`
 * (файл читается здесь и передаётся серверу через окружение), в CI они приходят
 * из окружения процесса.
 *
 * `stdout`/`stderr: 'ignore'` — чтобы серверы не занимали каналы вывода.
 */
try {
  // Node 22: файла может не быть (CI) — это норма.
  process.loadEnvFile();
} catch {
  // Нет .env — работаем на переменных окружения.
}

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
      // API в e2e работает как в проде: без чтения .env и с JSON-логами.
      env: { NODE_ENV: 'production' },
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
