import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';
import { appUser } from '../iam';

/**
 * Общие колонки вложения: картинка новости хранится так же, как материалы задания.
 *
 * `storageKey` — случайный UUID (никаких путей от пользователя), `originalName` — имя, которое
 * показать человеку. Размер и MIME храним: они нужны и для показа, и для разбора инцидентов.
 *
 * Дублирование с модулем домашних заданий **намеренное**: это разные таблицы разных документов, и
 * общая «универсальная» таблица файлов связала бы их правила между собой.
 */
const attachmentColumns = {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  storageKey: text('storage_key').notNull(),
  originalName: text('original_name').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  /** MIME по **содержанию**, а не по заголовку от клиента. */
  mimeType: text('mime_type').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => appUser.id, { onDelete: 'set null' }),
  /** Мягкое удаление: файл не стираем (решение владельца). */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by').references(() => appUser.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
} as const;

/** Картинка новости: загружается до сохранения новости, привязывается позже. */
export const newsImage = pgTable('news_image', attachmentColumns, (table) => [
  /** Незавершённые загрузки ищем по автору: по ним видно, что форму закрыли. */
  index('news_image_uploaded_by_idx').on(table.uploadedBy),
]);

/**
 * Новости заведения (Этап 6).
 *
 * Владелец: публикует **администратор или будущая роль директора**, видны **всем вошедшим**, можно
 * **править и убирать**. Последняя новость показывается полностью, предыдущие — свёрнутыми до
 * заголовка.
 *
 * Удаление **мягкое**: как у отметок, заданий и файлов. Случайно убранную новость можно вернуть, а
 * история правок остаётся в аудите — не в самой таблице, а там, где ей место.
 */

export const newsItem = pgTable(
  'news_item',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    title: text('title').notNull(),
    body: text('body').notNull(),

    /**
     * Когда новость **показывать**. Отдельно от `createdAt`: новость можно подготовить заранее и
     * поставить на нужный день, а не публиковать в момент набора.
     */
    publishedOn: timestamp('published_on', { withTimezone: true }).notNull().defaultNow(),

    /**
     * До какого дня новость видна. `null` — **бессрочно**: срок показа необязателен. Заставлять его
     * указывать нельзя, иначе простая новость потребует лишнего решения.
     */
    visibleUntil: timestamp('visible_until', { withTimezone: true }),

    /**
     * Картинка — **ссылка на файл в нашем хранилище**, а не на внешний адрес.
     *
     * Файлы у нас за абстракцией хранилища и отдаются через API с проверкой прав: чужой URL обошёл
     * бы и проверку, и требование держать данные на своём сервере.
     *
     * Признак «прикреплена» — это **само заполненное поле**: файл загружается до сохранения
     * новости, и до привязки он ничей. Отдельного булева поля не нужно, оно могло бы разойтись с
     * ссылкой.
     */
    imageFileId: uuid('image_file_id'),

    /**
     * Где показать картинку относительно текста: `top` — сверху, `bottom` — снизу.
     *
     * Решение владельца. Храним **строкой**, а не булевым полем: положение — это **выбор из
     * вариантов**, и третий вариант («слева», «в галерее») добавится значением, а не переделкой
     * типа. Булево поле пришлось бы заменять миграцией, и старые данные читались бы неверно.
     */
    imagePosition: text('image_position').notNull().default('top'),

    /** Порядок среди новостей одной даты: по нему определяется «последняя». */
    sortOrder: integer('sort_order').notNull().default(0),

    createdBy: uuid('created_by').references(() => appUser.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => appUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => appUser.id, { onDelete: 'set null' }),
  },
  (table) => [
    /** Список идёт по дате показа: по ней же отбирается «последняя». */
    index('news_item_published_idx').on(table.publishedOn.desc(), table.sortOrder.desc()),
    /** Мягко удалённые не показываем: индекс нужен на каждом чтении списка. */
    index('news_item_active_idx')
      .on(table.publishedOn.desc())
      .where(sql`${table.deletedAt} is null`),
  ],
);
