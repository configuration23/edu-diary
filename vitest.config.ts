import { defineConfig } from 'vitest/config';

/**
 * Один набор тестов на весь монорепозиторий: `npm test` из корня.
 *
 * Интеграционные тесты с PostgreSQL включаются только при заданном
 * TEST_DATABASE_URL (в CI он указывает на служебную базу), поэтому `npm test`
 * проходит и на машине без базы.
 *
 * Пул потоков (а не форков) выбран намеренно: он не требует дочерних процессов
 * и каналов, поэтому одинаково работает локально и в CI.
 */
export default defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    include: [
      'apps/api/test/**/*.test.ts',
      'apps/web/test/**/*.test.tsx',
      'packages/*/test/**/*.test.ts',
      'tools/**/*.test.mjs',
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
