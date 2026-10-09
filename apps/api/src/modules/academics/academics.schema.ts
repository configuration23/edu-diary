import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';

/**
 * Учебный процесс: учебные годы, периоды и ученики.
 *
 * На Этапе 1 здесь только то, что нужно мастеру настройки, согласиям и привязке
 * родителей; группы, предметы, аудитории и назначения добавляет Этап 2.
 *
 * Календарные поля — тип `date` со строковым режимом: никаких Date и часовых
 * поясов (ADR-016).
 */
export const academicYear = pgTable('academic_year', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  title: text('title').notNull(),
  startsOn: date('starts_on', { mode: 'string' }).notNull(),
  endsOn: date('ends_on', { mode: 'string' }).notNull(),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const period = pgTable(
  'period',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYear.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** term | semester | quarter */
    kind: text('kind').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (table) => [index('period_year_idx').on(table.academicYearId)],
);

export const student = pgTable('student', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  /**
   * Учётная запись ученика: без неё он не увидит свои оценки (ADR-005).
   *
   * Внешний ключ на `app_user` намеренно не объявлен: `iam` уже ссылается на
   * `student` (привязка родителя), и обратная ссылка создала бы цикл схем.
   * Существование пользователя проверяет сервис, а учётные записи сотрудников
   * деактивируются, а не удаляются (ADR-022).
   */
  userId: uuid('user_id'),
  fullName: text('full_name').notNull(),
  shortName: text('short_name'),
  birthDate: date('birth_date', { mode: 'string' }),
  /** Только факты по учёбе: медицинские сведения вносить запрещено (ADR-020). */
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
