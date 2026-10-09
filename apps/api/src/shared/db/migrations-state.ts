import { readFileSync } from 'node:fs';
import path from 'node:path';

import { migrationsDirectory } from '../paths';
import type { Database } from './client';

/**
 * Состояние миграций для `/api/health` (ROADMAP.md, Этап 0).
 *
 * Применённые миграции считаются по служебной таблице Drizzle, ожидаемое число
 * берётся из журнала `drizzle/meta/_journal.json`. Если журнал недоступен,
 * состояние честно помечается как `unknown`, а не «всё хорошо».
 */

export interface MigrationsState {
  status: 'ok' | 'pending' | 'unknown';
  applied: number;
  pending: number;
}

interface JournalEntry {
  tag?: unknown;
}

interface Journal {
  entries?: unknown;
}

/** Сколько миграций записано в журнале Drizzle. null — журнал недоступен. */
export function readMigrationJournalSize(directory = migrationsDirectory()): number | null {
  try {
    const raw = readFileSync(path.join(directory, 'meta', '_journal.json'), 'utf8');
    const journal = JSON.parse(raw) as Journal;
    if (!Array.isArray(journal.entries)) return null;
    return (journal.entries as JournalEntry[]).length;
  } catch {
    return null;
  }
}

/** Сколько миграций применено к базе. Таблица может отсутствовать — это 0. */
export async function countAppliedMigrations(db: Database): Promise<number> {
  try {
    const rows = await db.sql<{ count: number }[]>`
      select count(*)::int as count from drizzle.__drizzle_migrations
    `;
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function readMigrationsState(
  db: Database,
  directory = migrationsDirectory(),
): Promise<MigrationsState> {
  const applied = await countAppliedMigrations(db);
  const expected = readMigrationJournalSize(directory);

  if (expected === null) {
    return { status: 'unknown', applied, pending: 0 };
  }

  const pending = Math.max(0, expected - applied);
  return { status: pending === 0 ? 'ok' : 'pending', applied, pending };
}
