import { buildApp } from './app';
import { loadApplicationEnv } from './shared/bootstrap';
import { createDatabase } from './shared/db/client';

/**
 * Точка входа API.
 *
 * Секреты проверяются до любых сетевых действий: без них процесс завершается с
 * кодом 1 и понятным сообщением (ROADMAP.md, Этап 0).
 */

async function main(): Promise<void> {
  const env = loadApplicationEnv();
  const db = createDatabase(env.databaseUrl);
  const app = await buildApp({ env, db });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;

    app.log.info({ signal }, 'остановка приложения');
    try {
      await app.close();
      await db.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.port, host: env.host });
}

main().catch((error: unknown) => {
  console.error('FATAL: приложение не запустилось');
  console.error(error);
  process.exit(1);
});
