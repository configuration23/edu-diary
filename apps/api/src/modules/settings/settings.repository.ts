import { eq, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { setting } from './settings.schema';

/** SQL существует только в репозитории модуля (ARCHITECTURE.md §3). */

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: Date;
}

export interface SettingsRepository {
  findByKey(key: string, executor?: Executor): Promise<SettingRecord | null>;
  upsert(
    record: { key: string; value: unknown; actorUserId: string | null },
    executor?: Executor,
  ): Promise<void>;
}

export function createSettingsRepository(db: Database): SettingsRepository {
  return {
    async findByKey(key: string, executor: Executor = db.orm): Promise<SettingRecord | null> {
      const rows = await executor.select().from(setting).where(eq(setting.key, key)).limit(1);
      const row = rows[0];
      if (row === undefined) return null;

      return { key: row.key, value: row.value, updatedAt: row.updatedAt };
    },

    async upsert(record, executor: Executor = db.orm): Promise<void> {
      const updatedAt = new Date();
      // Значение всегда передаётся как jsonb-литерал: колонка NOT NULL, а
      // «пустое» значение настройки — это JSON null, а не отсутствие данных.
      const value = sql`${JSON.stringify(record.value ?? null)}::jsonb`;

      await executor
        .insert(setting)
        .values({
          key: record.key,
          value,
          updatedBy: record.actorUserId,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: setting.key,
          set: { value, updatedBy: record.actorUserId, updatedAt },
        });
    },
  };
}
