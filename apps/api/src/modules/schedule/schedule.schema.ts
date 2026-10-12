import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';
import { period, room, studyGroup, subject } from '../academics';
import { teachingAssignment } from '../staffing';

/**
 * Расписание и уроки (Этап 3).
 *
 * Пять таблиц: сетка звонков, шаблон расписания, исключение на конкретную дату,
 * урок и замена преподавателя. Шаблон ссылается на назначение, поэтому предмет,
 * группа и преподаватель в нём не дублируются.
 *
 * `teacher_user_id` и `substitute_user_id` объявлены без внешних ключей: `iam`
 * уже ссылается на таблицы учебного процесса, и обратная ссылка замкнула бы
 * схемы в цикл (ADR-027). Существование и активность проверяет сервис через порт.
 */

/**
 * Звонки: сетка времени по номеру пары (справочник заведения).
 *
 * Сетка различается между заведениями, поэтому хранится в базе, а не в коде:
 * при составлении расписания время подставляется по номеру пары и остаётся
 * правимым — в отдельных случаях пара идёт в другое время.
 */
export const bellSchedule = pgTable(
  'bell_schedule',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** Номер пары: 1–8. */
    pairNumber: integer('pair_number').notNull(),
    timeStart: time('time_start').notNull(),
    timeEnd: time('time_end').notNull(),
    /** Перемена после пары: справочная информация для интерфейса. */
    breakMinutes: integer('break_minutes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('bell_schedule_pair_key').on(table.pairNumber)],
);

/** Шаблон: занятие, повторяющееся каждую неделю в заданном периоде. */
export const scheduleEntry = pgTable(
  'schedule_entry',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => teachingAssignment.id, { onDelete: 'restrict' }),
    studyGroupId: uuid('study_group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    /** 1 — понедельник … 7 — воскресенье (ISO 8601). */
    dayOfWeek: integer('day_of_week').notNull(),
    /** Номер пары: 1–8. */
    pairNumber: integer('pair_number').notNull(),
    timeStart: time('time_start').notNull(),
    timeEnd: time('time_end').notNull(),
    roomId: uuid('room_id').references(() => room.id, { onDelete: 'set null' }),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    /** `null` — шаблон действует до отмены. */
    validTo: date('valid_to', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('schedule_entry_group_idx').on(table.studyGroupId, table.dayOfWeek),
    index('schedule_entry_assignment_idx').on(table.assignmentId),
    // В одной группе на одну пару одного дня недели — один шаблон.
    uniqueIndex('schedule_entry_group_slot_key').on(
      table.studyGroupId,
      table.dayOfWeek,
      table.pairNumber,
    ),
  ],
);

/**
 * Исключение на дату: отмена, перенос или замена.
 *
 * Состав полей у действий разный (отмене ничего не нужно, переносу — время и
 * аудитория, замене — преподаватель), поэтому различия хранятся в `payload`, а
 * таблица одна.
 */
export const scheduleException = pgTable(
  'schedule_exception',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    scheduleEntryId: uuid('schedule_entry_id')
      .notNull()
      .references(() => scheduleEntry.id, { onDelete: 'cascade' }),
    studyGroupId: uuid('study_group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    exceptionDate: date('exception_date', { mode: 'string' }).notNull(),
    pairNumber: integer('pair_number').notNull(),
    /** cancel | move | replace */
    action: text('action').notNull(),
    payload: jsonb('payload').notNull().default({}),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('schedule_exception_group_date_idx').on(table.studyGroupId, table.exceptionDate),
    // На одну пару одной даты — одно исключение: оно уже описывает замену или отмену.
    uniqueIndex('schedule_exception_slot_key').on(
      table.scheduleEntryId,
      table.exceptionDate,
      table.pairNumber,
    ),
  ],
);

/** Урок: занятие на конкретную дату, порождённое шаблоном. */
export const lesson = pgTable(
  'lesson',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** `null` — урок заведён вручную, без шаблона (например, разовая консультация). */
    scheduleEntryId: uuid('schedule_entry_id').references(() => scheduleEntry.id, {
      onDelete: 'set null',
    }),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => teachingAssignment.id, { onDelete: 'restrict' }),
    studyGroupId: uuid('study_group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'restrict' }),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'restrict' }),
    /** Кто ведёт урок: при замене — заменяющий. */
    teacherUserId: uuid('teacher_user_id').notNull(),
    /** Кто должен был вести по расписанию: заполняется при замене. */
    plannedTeacherUserId: uuid('planned_teacher_user_id'),
    roomId: uuid('room_id').references(() => room.id, { onDelete: 'set null' }),
    lessonDate: date('lesson_date', { mode: 'string' }).notNull(),
    pairNumber: integer('pair_number').notNull(),
    timeStart: time('time_start').notNull(),
    timeEnd: time('time_end').notNull(),
    topic: text('topic'),
    lessonType: text('lesson_type'),
    /** Учебный период, в который попал урок: границы для правил и аналитики (ADR-009). */
    periodId: uuid('period_id').references(() => period.id, { onDelete: 'set null' }),
    /** planned | done | cancelled | replaced */
    status: text('status').notNull().default('planned'),
    /** Правку внесли вручную: повторная генерация такую запись не перезаписывает. */
    isManual: boolean('is_manual').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('lesson_group_date_idx').on(table.studyGroupId, table.lessonDate),
    index('lesson_teacher_date_idx').on(table.teacherUserId, table.lessonDate),
    index('lesson_assignment_idx').on(table.assignmentId),
    // В одной группе на одну пару одной даты — один урок (ADR-006). Отменённый
    // урок освобождает пару: на его место можно поставить другой (например,
    // перенесённый), поэтому ограничение частичное.
    uniqueIndex('lesson_group_slot_key')
      .on(table.studyGroupId, table.lessonDate, table.pairNumber)
      .where(sql`status <> 'cancelled'`),
  ],
);

/** Замена преподавателя: на один урок или на диапазон дат (ADR-009). */
export const substitution = pgTable(
  'substitution',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => teachingAssignment.id, { onDelete: 'cascade' }),
    /** Замена на один урок: тогда здесь ссылка на него. */
    lessonId: uuid('lesson_id').references(() => lesson.id, { onDelete: 'cascade' }),
    substituteUserId: uuid('substitute_user_id').notNull(),
    /** Кого заменяют: фиксируется на момент создания, чтобы история не «переехала». */
    replacedUserId: uuid('replaced_user_id').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('substitution_assignment_range_idx').on(table.assignmentId, table.startsOn),
    index('substitution_lesson_idx').on(table.lessonId),
  ],
);
