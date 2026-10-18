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
  // Сквозные сценарии Этапа 2 длиннее: несколько разделов подряд, каждая
  // проверка ждёт перезапроса данных. 30 секунд по умолчанию не хватает.
  timeout: 120_000,
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
  /**
   * Серверы **не переиспользуются** — ни локально, ни в CI.
   *
   * `tools/dev/run-e2e-isolated.mjs` по умолчанию **удаляет и создаёт заново** базу
   * `edu_diary_e2e`. Если Playwright подхватит сервер от прошлого прогона, тот будет смотреть в уже
   * удалённую базу: приложение не получит статус настройки и навсегда останется на заставке.
   * Внешне это выглядит как «сценарий упал на ожидании поля входа» — и уводит в сторону. Дважды так
   * и случилось при работах по оформлению, пока причина не нашлась.
   *
   * Честный отказ «порт занят» лучше, чем прогон на чужой базе: он сразу говорит, что делать —
   * остановить `npm run dev` или прошлый прогон.
   */
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3000/api/health',
      // API в e2e работает как в проде: без чтения .env и с JSON-логами.
      env: { NODE_ENV: 'production' },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: 'npm run preview -w apps/web',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
  ],
});
