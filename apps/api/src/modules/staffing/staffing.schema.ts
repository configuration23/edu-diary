import { date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';
import { studyGroup, subject } from '../academics';

/**
 * Назначения «преподаватель ↔ предмет ↔ группа» (Этап 2).
 *
 * Здесь же появятся замены (`substitution`) Этапа 3: назначение — это период,
 * в котором преподаватель ведёт предмет в группе, а замена уточняет, кто ведёт
 * конкретный урок.
 *
 * `teacher_user_id` объявлен без внешнего ключа: `iam` уже ссылается на таблицы
 * учебного процесса, и обратная ссылка замкнула бы схемы в цикл (ADR-027).
 * Существование и активность преподавателя проверяет сервис.
 *
 * `ends_on = null` — назначение действует до явного закрытия; закрытие пишет
 * дату окончания и попадает в аудит, поэтому «удалять» назначение не нужно.
 */
export const teachingAssignment = pgTable(
  'teaching_assignment',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    teacherUserId: uuid('teacher_user_id').notNull(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subject.id, { onDelete: 'restrict' }),
    studyGroupId: uuid('study_group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'restrict' }),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }),
    hoursPlanned: integer('hours_planned'),
    /** Комментарий администратора: почему назначение закрыто или изменено. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('teaching_assignment_teacher_idx').on(table.teacherUserId),
    index('teaching_assignment_group_subject_idx').on(table.studyGroupId, table.subjectId),
  ],
);
