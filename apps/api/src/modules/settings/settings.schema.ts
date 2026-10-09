import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Настройки системы: `ключ → jsonb` (ADR-003).
 *
 * Всё изменяемое приложение хранит здесь — брендинг, параметры правил, состояние
 * настройки системы. В коде остаются только значения по умолчанию.
 *
 * `updated_by` ссылается на `app_user`, которая появится на Этапе 1: внешний
 * ключ добавляется отдельной миграцией, когда таблица пользователей существует.
 */
export const setting = pgTable('setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SettingRow = typeof setting.$inferSelect;
