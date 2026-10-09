import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'drizzle-kit';

const apiRoot = path.dirname(fileURLToPath(import.meta.url));

/** Drizzle Kit сопоставляет глобы только с прямыми слэшами, поэтому путь нормализуется. */
const toPosixPath = (value: string): string => value.split(path.sep).join('/');

/**
 * Конфигурация Drizzle Kit.
 *
 * `generate` (npm run db:generate) работает без подключения к БД; строка
 * подключения нужна только командам, которые ходят в базу.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: toPosixPath(path.join(apiRoot, 'src/modules/*/*.schema.ts')),
  out: path.join(apiRoot, 'drizzle'),
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/unused',
  },
  strict: true,
  verbose: true,
});
