import { sql } from 'drizzle-orm';
import { uuidv7 } from '../../shared/ids';
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { appUser } from '../iam';
import { gradeCategory, student } from '../academics';
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
    /**
     * Какой оценкой оплачен знак.
     *
     * Пересчёт «плюсы и точки → оценка» съедает накопленные знаки: у съеденного
     * знака заполнены `consumedByGradeId` и `consumedAt`. Так видно и происхождение
     * оценки («за три плюса»), и почему знак исчез из журнала. Восстановление знака
     * снимает пометку, и следующий пересчёт посчитает его снова.
     */
    consumedByGradeId: uuid('consumed_by_grade_id'),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
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
     * Уникальности «ученик + урок» здесь **нет намеренно**: за урок можно поставить
     * несколько оценок и знаков — например, ответ на уроке и контрольную работу.
     * От случайного дубля защищает сервис: он сравнивает причину и спрашивает
     * подтверждение замены.
     */
    index('grade_entry_lesson_student_idx').on(table.lessonId, table.studentId),
    /** Ссылка на оплатившую оценку: нужна, чтобы найти съеденные знаки. */
    index('grade_entry_consumed_by_idx').on(table.consumedByGradeId),
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
    /** present | not_present | sick | late (плюс устаревший excused из ранней версии). */
    status: text('status').notNull(),
    /**
     * Отметка «уважительная»: ставится вместе с отсутствием и требует причины.
     *
     * Отдельным признаком, а не статусом: в журнале это не пятая буква, а галочка
     * к «Н» — «не был по уважительной причине».
     */
    isExcused: boolean('is_excused').notNull().default(false),
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
 * Пересчёт «плюсы и точки → оценка» живёт без отдельной таблицы правил.
 *
 * Награда жёстко привязана к знаку: плюсы дают `5`, точки дают `2` — это правило
 * предметной области, а не настройка. Настраивается только порог, и он лежит в
 * справочнике причин оценок (`grade_category.sign_threshold`), рядом с выключателем
 * пересчёта. Съеденные знаки помечаются оценкой, которая их оплатила
 * (`grade_entry.consumed_by_grade_id`), поэтому отдельный журнал срабатываний не
 * нужен: происхождение оценки видно по самим знакам, а история — в аудите.
 */
