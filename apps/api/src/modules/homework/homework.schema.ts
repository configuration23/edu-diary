import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';
import { appUser } from '../iam';
import { student } from '../academics';
import { lesson } from '../schedule';

/**
 * Домашние задания и вложения (Этап 5, `ARCHITECTURE.md` §7).
 *
 * Задание привязано к **уроку**: учитель ставит его в журнале, там же видно, кто сдал.
 * «Продолжительное» задание не размножается по урокам: это **одно** задание, которое
 * видно во всех уроках предмета до даты `visibleUntil`, а сдаётся один раз (решение
 * владельца). Копии дали бы ученику пять одинаковых заданий и пять сдач.
 *
 * Вложения лежат **в хранилище**, а в базе только `storage_key` и метаданные: файлы не
 * должны раздувать контейнер. Удаление — мягкое (`deleted_at`): решения учеников не
 * стираем, только помечаем (решение владельца).
 *
 * Файлы учеников — персональные данные, поэтому выдача идёт **через API с проверкой
 * прав**, а не прямой ссылкой на файловую систему.
 */

/** Задание: текст, срок и материалы. Одно задание — один урок-владелец. */
export const homeworkAssignment = pgTable(
  'homework_assignment',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** Урок, из которого задание поставлено: от него берутся группа, предмет и учитель. */
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => lesson.id, { onDelete: 'cascade' }),
    /** Текст задания: обязателен либо он, либо хотя бы одно вложение. */
    text: text('text').notNull(),
    /**
     * Срок сдачи. `null` — без срока: задание просто видно в уроке.
     *
     * Срок — **календарная дата**, а не момент времени: «сдать до 20-го» понятнее, чем
     * «до 20-го 23:59:59», и часовой пояс перестаёт влиять на опоздание.
     */
    dueOn: text('due_on'),
    /**
     * До какого числа задание видно в уроках предмета («продолжительное задание»).
     *
     * `null` — видно только в своём уроке. Значение ограничено настройкой
     * `homework.max_duration_days`: без предела задание легко растянуть на весь год, и
     * оно будет висеть в каждом уроке.
     */
    visibleUntil: text('visible_until'),
    createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
    /** Мягкое удаление: задание скрывается, но история и сдачи остаются. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => appUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('homework_assignment_lesson_idx').on(table.lessonId),
    /**
     * Уникальность «один урок — одно задание»: два задания на один урок запутали бы и
     * учителя, и ученика. Второе задание ставится на другой урок.
     */
    uniqueIndex('homework_assignment_lesson_key')
      .on(table.lessonId)
      .where(sql`${table.deletedAt} is null`),
    /** Продолжительное задание ищем по дате видимости. */
    index('homework_assignment_visible_until_idx').on(table.visibleUntil),
    check('homework_assignment_text_or_files', sql`length(btrim(${table.text})) > 0`),
  ],
);

/** Решение ученика: текст и вложения. Одна отправка, черновика нет (решение владельца). */
export const homeworkSubmission = pgTable(
  'homework_submission',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => homeworkAssignment.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    /** Текст решения: обязателен либо он, либо хотя бы одно вложение. */
    text: text('text').notNull(),
    /**
     * Когда сдано. По этой дате видно опоздание — сдача после срока **разрешена**, но
     * помечается (решение владельца): не наказываем за задержку, но показываем факт.
     */
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Мягкое удаление: решение не стираем, только помечаем. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => appUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('homework_submission_assignment_idx').on(table.assignmentId),
    index('homework_submission_student_idx').on(table.studentId),
    /**
     * Уникальности «задание + ученик» здесь **нет намеренно**: сейчас попытка одна, но
     * пересдача обсуждается. Ограничение в базе пришлось бы снимать миграцией, а правило
     * одной попытки живёт в сервисе и меняется одной строкой.
     */
    index('homework_submission_assignment_student_idx').on(table.assignmentId, table.studentId),
  ],
);

/**
 * Вложение — файл в хранилище.
 *
 * Отдельные таблицы на материалы задания и на файлы решения, а не одна с признаком
 * владельца: так связи выражены явно, а «осиротевших» строк с двумя пустыми ссылками не
 * бывает.
 *
 * `storageKey` — случайный UUID (никаких путей от пользователя), `originalName` — имя,
 * которое показать человеку. Размер и MIME сохраняем: они нужны и для показа, и для
 * разбора инцидентов.
 */
const attachmentColumns = {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  /** Ключ в хранилище: случайный UUID, без пользовательских путей. */
  storageKey: text('storage_key').notNull(),
  /** Имя файла, как его видит человек. */
  originalName: text('original_name').notNull(),
  /** Размер в байтах: лимит проверяет сервер, значение нужно для показа и разбора. */
  sizeBytes: integer('size_bytes').notNull(),
  /** MIME по **содержимому**, а не по заголовку от клиента. */
  mimeType: text('mime_type').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => appUser.id, { onDelete: 'set null' }),
  /** Мягкое удаление: файл не стираем (решение владельца). */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
} as const;

/** Материалы задания: файлы, которые приложил учитель. */
export const homeworkAssignmentFile = pgTable(
  'homework_assignment_file',
  {
    ...attachmentColumns,
    /**
     * Может быть пустым: файл загружается **до** сохранения задания — иначе пришлось бы
     * держать форму открытой, пока передаётся большой файл. Такой файл ещё ни к чему не
     * привязан, и «забрать» его может только тот, кто загрузил.
     */
    assignmentId: uuid('assignment_id').references(() => homeworkAssignment.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => [
    index('homework_assignment_file_assignment_idx').on(table.assignmentId),
    /** Незавершённые загрузки ищем по автору: по ним видно, что форма была закрыта. */
    index('homework_assignment_file_uploaded_by_idx').on(table.uploadedBy),
  ],
);

/**
 * Файлы решения: то, что приложил ученик.
 *
 * submissionId **может быть пустым**: ученик прикладывает файл до отправки решения, иначе
 * форма ждала бы передачи файла. «Забрать» такой файл может только тот, кто его загрузил.
 */
export const homeworkSubmissionFile = pgTable(
  'homework_submission_file',
  {
    ...attachmentColumns,
    submissionId: uuid('submission_id').references(() => homeworkSubmission.id, {
      onDelete: 'cascade',
    }),
  },
  (table) => [
    index('homework_submission_file_submission_idx').on(table.submissionId),
    index('homework_submission_file_uploaded_by_idx').on(table.uploadedBy),
  ],
);

/** Ссылки: и в задании, и в решении их может быть несколько. */
export const homeworkLink = pgTable(
  'homework_link',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** Задание или решение: ровно одна из ссылок заполнена. */
    assignmentId: uuid('assignment_id').references(() => homeworkAssignment.id, {
      onDelete: 'cascade',
    }),
    submissionId: uuid('submission_id').references(() => homeworkSubmission.id, {
      onDelete: 'cascade',
    }),
    url: text('url').notNull(),
    /** Подпись ссылки: «учебник, глава 3». */
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('homework_link_assignment_idx').on(table.assignmentId),
    index('homework_link_submission_idx').on(table.submissionId),
    check(
      'homework_link_single_owner',
      sql`(${table.assignmentId} is null) <> (${table.submissionId} is null)`,
    ),
  ],
);
