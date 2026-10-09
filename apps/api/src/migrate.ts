import { loadApplicationEnv } from './shared/bootstrap';
import { createDatabase } from './shared/db/client';
import { runMigrations } from './shared/db/migrate';

/**
 * `npm run migrate` — применение миграций отдельным шагом, до запуска API
 * (ARCHITECTURE.md §12). Миграции только вперёд.
 */

async function main(): Promise<void> {
  const env = loadApplicationEnv();
  const db = createDatabase(env.databaseUrl, { max: 1 });

  try {
    const result = await runMigrations(db, { log: (message) => console.log(message) });
    console.log(`Миграции: применено ${result.applied}, всего в базе ${result.total}`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('FATAL: миграции не применены');
  console.error(error);
  process.exit(1);
});
