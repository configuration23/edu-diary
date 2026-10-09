import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';

/**
 * Учебный процесс: учебные годы, периоды, ученики, группы и справочники.
 *
 * На Этапе 1 здесь только то, что нужно мастеру настройки, согласиям и привязке
 * родителей; Этап 2 добавил группы, зачисления, предметы, аудитории и категории
 * оценок. Назначения «преподаватель ↔ предмет ↔ группа» живут в модуле
 * `staffing` — там же появятся замены Этапа 3.
 *
 * Календарные поля — тип `date` со строковым режимом: никаких Date и часовых
 * поясов (ADR-016).
 *
 * Внешние ключи справочников — `on delete restrict`: удаление предмета, по
 * которому есть история, запрещено (ARCHITECTURE.md §5). Понятное сообщение об
 * отказе формирует сервис до обращения к БД.
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

/** Учебная группа года: расписание, назначения и уроки привязаны к ней (§4.1). */
export const studyGroup = pgTable(
  'study_group',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYear.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    course: integer('course'),
    specialty: text('specialty'),
    /** Куратор группы; ссылка ослаблена так же, как `student.user_id` (ADR-027). */
    curatorUserId: uuid('curator_user_id'),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('study_group_year_name_key').on(table.academicYearId, table.name),
    index('study_group_year_idx').on(table.academicYearId),
  ],
);

/**
 * Зачисление ученика в группу с датами.
 *
 * Запись не удаляется: отчисление — это `leftOn`, перевод — закрытие старого
 * зачисления и открытие нового. Так сохраняется история «кто где учился».
 */
export const studentEnrollment = pgTable(
  'student_enrollment',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'restrict' }),
    studyGroupId: uuid('study_group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'restrict' }),
    joinedOn: date('joined_on', { mode: 'string' }).notNull(),
    /** `null` — ученик числится в группе сейчас. */
    leftOn: date('left_on', { mode: 'string' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('student_enrollment_group_idx').on(table.studyGroupId, table.leftOn),
    index('student_enrollment_student_idx').on(table.studentId, table.leftOn),
  ],
);

/** Предмет: справочник, на который ссылаются назначения, уроки и правила оценок. */
export const subject = pgTable('subject', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text('name').notNull().unique(),
  shortName: text('short_name'),
  /** mandatory | optional | practice */
  kind: text('kind').notNull(),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const room = pgTable('room', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text('name').notNull().unique(),
  capacity: integer('capacity'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Категория оценки с весом в среднем балле (§5, Этап 4 считает по весам). */
export const gradeCategory = pgTable('grade_category', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  weight: integer('weight').notNull().default(1),
  color: text('color'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
