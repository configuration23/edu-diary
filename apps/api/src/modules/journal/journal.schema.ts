import { sql } from 'drizzle-orm';
import { uuidv7 } from '../../shared/ids';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { appUser } from '../iam';
import { gradeCategory, period, student, subject } from '../academics';
import { lesson } from '../schedule';

/**
 * Журнал: оценки, знаки «+/·» и посещаемость (Этап 4, ADR-006, ADR-010, ADR-011).
 *
 * Единица журнала — **урок**: и оценка, и отметка посещаемости ссылаются на него,
 * поэтому замена, отмена и перенос автоматически видны в журнале.
 *
 * Удаление — мягкое (`deleted_at`), и каждая правка оставляет след в истории
 * (`grade_revision`, `attendance_revision`): спор «я не ставил эту двойку»
 * решается фактами, а не памятью (ADR-011).
 */

/**
 * Отметка в журнале: числовая оценка (`value`) или знак (`sign`).
 *
 * Ровно одно из двух полей заполнено — это проверяет сервис, а в БД стоит
 * соответствующее условие. Знаки «+» и «.» накапливаются и по правилу
 * превращаются в оценку (ADR-010).
 */
export const gradeEntry = pgTable(
  'grade_entry',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lesson.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    /** Числовая оценка: `2`…`5`. У знака — `null`. */
    value: text('value'),
    /** Знак: `plus` или `dot`. У оценки — `null`. */
    sign: text('sign'),
    categoryId: uuid('category_id').references(() => gradeCategory.id, { onDelete: 'set null' }),
    comment: text('comment'),
    /** Кто поставил: преподаватель или администратор. */
    createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
    /** Мягкое удаление: строку не убираем, иначе пропадёт история (ADR-011). */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => appUser.id, { onDelete: 'set null' }),
    deletedReason: text('deleted_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grade_entry_lesson_idx').on(table.lessonId),
    index('grade_entry_student_idx').on(table.studentId),
    /**
     * Одна оценка на ученика в уроке. Частичный индекс: удалённая запись место не
     * занимает, иначе после мягкого удаления нельзя было бы поставить новую оценку.
     */
    uniqueIndex('grade_entry_lesson_student_key')
      .on(table.lessonId, table.studentId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/** Отметка посещаемости: статус и причина. Одна на ученика в уроке. */
export const attendanceEntry = pgTable(
  'attendance_entry',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lesson.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    /** present | absent | excused | sick | late */
    status: text('status').notNull(),
    /** Причина: обязательна для прогула и уважительной (правило проверяет сервис). */
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => appUser.id, { onDelete: 'set null' }),
    deletedReason: text('deleted_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('attendance_entry_lesson_idx').on(table.lessonId),
    index('attendance_entry_student_idx').on(table.studentId),
    uniqueIndex('attendance_entry_lesson_student_key')
      .on(table.lessonId, table.studentId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/** История правок оценки: кто, когда, было, стало и почему (ADR-011). */
export const gradeRevision = pgTable(
  'grade_revision',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    gradeEntryId: uuid('grade_entry_id')
      .notNull()
      .references(() => gradeEntry.id, { onDelete: 'cascade' }),
    /** create | update | delete | restore */
    action: text('action').notNull(),
    /** Состояние до правки: у создания — `null`. */
    before: text('before'),
    after: text('after'),
    reason: text('reason'),
    actorId: uuid('actor_id').references(() => appUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('grade_revision_entry_idx').on(table.gradeEntryId)],
);

/** История правок посещаемости: та же идея, что и у оценок. */
export const attendanceRevision = pgTable(
  'attendance_revision',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    attendanceEntryId: uuid('attendance_entry_id')
      .notNull()
      .references(() => attendanceEntry.id, { onDelete: 'cascade' }),
    /** create | update | delete | restore */
    action: text('action').notNull(),
    before: text('before'),
    after: text('after'),
    reason: text('reason'),
    actorId: uuid('actor_id').references(() => appUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('attendance_revision_entry_idx').on(table.attendanceEntryId)],
);

/**
 * Правило «знаки → оценка»: сколько плюсов или точек даёт какую оценку (ADR-010).
 *
 * Порог задаёт администратор. Правило может быть общим для категории (`subjectId`
 * пусто) или уточнённым для предмета: счёт ведётся по предмету, поэтому у физики и
 * математики свои накопления.
 */
export const gradeRule = pgTable('grade_rule', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  /** plus | dot */
  sign: text('sign').notNull(),
  /** Сколько знаков должно накопиться. */
  threshold: integer('threshold').notNull(),
  /** Что выдаётся при срабатывании: `2`…`5`. */
  reward: text('reward').notNull(),
  /** Категория оценки, к которой применяется правило (необязательно). */
  categoryId: uuid('category_id').references(() => gradeCategory.id, { onDelete: 'cascade' }),
  /** Предмет: если задан, правило действует только для него. */
  subjectId: uuid('subject_id').references(() => subject.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Журнал срабатываний правила.
 *
 * Уникальность `(rule, ученик, предмет, период, номер срабатывания)` — это и есть
 * идемпотентность: повторный пересчёт по тем же данным не создаёт вторую запись,
 * сколько бы раз его ни запускали (ADR-010, критерий приёмки этапа).
 */
export const gradeRuleApplication = pgTable(
  'grade_rule_application',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => gradeRule.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => period.id, { onDelete: 'set null' }),
    /** Номер срабатывания внутри периода: 1, 2, 3… */
    applicationNumber: integer('application_number').notNull(),
    /** Накопление знаков на момент срабатывания: видно, за что выдана оценка. */
    counterValue: integer('counter_value').notNull(),
    /** Оценка, созданная этим срабатыванием. */
    gradeEntryId: uuid('grade_entry_id').references(() => gradeEntry.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grade_rule_application_key').on(
      table.ruleId,
      table.studentId,
      table.subjectId,
      table.periodId,
      table.applicationNumber,
    ),
  ],
);
