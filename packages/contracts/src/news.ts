import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common';

/**
 * Новости заведения (Этап 6).
 *
 * Решения владельца: публикует **администратор или будущая роль директора**, новости видны **всем
 * вошедшим**, их можно править и убирать. Последняя новость показывается **полностью**,
 * предыдущие — **свёрнутыми до заголовка**.
 */

export const newsItemSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  body: z.string(),
  /** Дата показа: день, с которого новость видна. */
  publishedOn: isoDateSchema,
  /** `null` — бессрочно. Срок показа необязателен. */
  visibleUntil: isoDateSchema.nullable(),
  /**
   * Картинка: `null` — нет. Отдаём **ссылку на наш API**, а не на хранилище: файлы выдаются с
   * проверкой прав, и прямой адрес в хранилище обошёл бы её.
   */
  imageUrl: z.string().nullable(),
  imageName: z.string().nullable(),
  createdAt: z.string(),
});
export type NewsItemDto = z.infer<typeof newsItemSchema>;

export const listNewsResponseSchema = z.object({
  items: z.array(newsItemSchema),
  /** Сколько всего новостей: нужно, чтобы показать «показаны не все». */
  total: z.number().int().nonnegative(),
});
export type ListNewsResponse = z.infer<typeof listNewsResponseSchema>;

const newsBodySchema = z.object({
  title: z.string().trim().min(1, 'Введите заголовок').max(200),
  body: z.string().trim().min(1, 'Введите текст новости').max(20000),
  /** Дата показа: без неё новость ставится на сегодня. */
  publishedOn: isoDateSchema.optional(),
  /** Пусто — бессрочно. */
  visibleUntil: isoDateSchema.nullish(),
  /** Идентификатор **уже загруженной** картинки: файл передаётся до сохранения новости. */
  imageFileId: uuidSchema.nullish(),
});

export const createNewsRequestSchema = newsBodySchema;
export type CreateNewsRequest = z.infer<typeof createNewsRequestSchema>;

/**
 * Правка новости.
 *
 * Поля необязательны: правится то, что передали. `imageFileId: null` **убирает** картинку —
 * именно поэтому поле принимает `null`, а не только отсутствие.
 */
export const updateNewsRequestSchema = newsBodySchema.partial();
export type UpdateNewsRequest = z.infer<typeof updateNewsRequestSchema>;

export const listNewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListNewsQuery = z.infer<typeof listNewsQuerySchema>;
