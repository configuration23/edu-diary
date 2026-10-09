import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { migrationsDirectory } from '../paths';
import type { Database } from './client';
import { countAppliedMigrations } from './migrations-state';

/**
 * Применение миграций — отдельная команда (`npm run migrate`), а не действие при
 * старте API (ARCHITECTURE.md §12). Миграции только вперёд.
 */

export interface RunMigrationsResult {
  applied: number;
  total: number;
}

export async function runMigrations(
  db: Database,
  options: { directory?: string; log?: (message: string) => void } = {},
): Promise<RunMigrationsResult> {
  const directory = options.directory ?? migrationsDirectory();
  const log = options.log ?? (() => {});

  const before = await countAppliedMigrations(db);
  log(`Применение миграций из ${directory}`);

  await migrate(db.orm, { migrationsFolder: directory });

  const after = await countAppliedMigrations(db);
  const applied = after - before;
  log(applied === 0 ? 'Новых миграций нет' : `Применено миграций: ${applied}`);

  return { applied, total: after };
}
