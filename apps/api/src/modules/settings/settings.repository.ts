import { eq } from 'drizzle-orm';

import type { Database } from '../../shared/db/client';
import { setting } from './settings.schema';

/** SQL существует только в репозитории модуля (ARCHITECTURE.md §3). */

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: Date;
}

export interface SettingsRepository {
  findByKey(key: string): Promise<SettingRecord | null>;
  upsert(record: { key: string; value: unknown; actorUserId: string | null }): Promise<void>;
}

export function createSettingsRepository(db: Database): SettingsRepository {
  return {
    async findByKey(key: string): Promise<SettingRecord | null> {
      const rows = await db.orm.select().from(setting).where(eq(setting.key, key)).limit(1);
      const row = rows[0];
      if (row === undefined) return null;

      return { key: row.key, value: row.value, updatedAt: row.updatedAt };
    },

    async upsert(record): Promise<void> {
      const updatedAt = new Date();

      await db.orm
        .insert(setting)
        .values({
          key: record.key,
          value: record.value,
          updatedBy: record.actorUserId,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: setting.key,
          set: { value: record.value, updatedBy: record.actorUserId, updatedAt },
        });
    },
  };
}
