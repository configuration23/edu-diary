import { defineConfig } from 'drizzle-kit';

/**
 * Конфигурация Drizzle Kit.
 *
 * Пути относительные: команды запускаются из каталога `apps/api` (npm -w).
 * Абсолютный `out` ломает чтение предыдущего снимка схемы при генерации второй
 * и последующих миграций.
 *
 * `generate` (npm run db:generate) работает без подключения к БД; строка
 * подключения нужна только командам, которые ходят в базу.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/*.schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/unused',
  },
  strict: true,
  verbose: true,
});
