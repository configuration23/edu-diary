import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { appUser } from '../iam';

/**
 * Настройки системы: `ключ → jsonb` (ADR-003).
 *
 * Всё изменяемое приложение хранит здесь — брендинг, параметры правил, состояние
 * настройки системы, редакции политики обработки ПДн. В коде остаются только
 * значения по умолчанию.
 *
 * `updated_by` ссылается на `app_user` (Этап 1): видно, кто менял настройку.
 */
export const setting = pgTable('setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => appUser.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SettingRow = typeof setting.$inferSelect;
