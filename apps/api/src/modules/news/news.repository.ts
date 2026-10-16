import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';

import type { Database } from '../../shared/db/client';
import { newsItem } from './news.schema';

/**
 * Доступ к данным новостей.
 *
 * SQL живёт только здесь (`check-architecture`): сервис формулирует правила, репозиторий — запросы.
 *
 * Новости **мягко удаляются**, поэтому каждое чтение отсекает `deleted_at is not null`: забытая
 * проверка показала бы удалённую новость, и заметить это было бы некому.
 */

export interface NewsRecord {
  id: string;
  title: string;
  body: string;
  publishedOn: Date;
  visibleUntil: Date | null;
  imageFileId: string | null;
  sortOrder: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface NewsRepository {
  /** Список для показа: только опубликованные, только не истёкшие, свежие впереди. */
  listVisible(input: { onDate: Date; limit: number }): Promise<NewsRecord[]>;
  /** Список **для правки**: включает неопубликованные и истёкшие — иначе их не найти. */
  listForEditing(input: { limit: number }): Promise<NewsRecord[]>;
  find(id: string): Promise<NewsRecord | null>;
  create(input: {
    title: string;
    body: string;
    publishedOn: Date;
    visibleUntil: Date | null;
    imageFileId: string | null;
    actorUserId: string;
  }): Promise<NewsRecord>;
  update(
    id: string,
    input: {
      title?: string;
      body?: string;
      publishedOn?: Date;
      visibleUntil?: Date | null;
      imageFileId?: string | null;
      actorUserId: string;
    },
  ): Promise<void>;
  softDelete(input: { id: string; actorUserId: string }): Promise<void>;
}

export function createNewsRepository(db: Database): NewsRepository {
  const active = isNull(newsItem.deletedAt);

  return {
    async listVisible(input) {
      /**
       * Условия показа: новость уже наступила и ещё не истекла.
       *
       * «Ещё не истекла» — это `visible_until is null` **или** `visible_until >= сегодня`.
       * Бессрочная новость обязана попадать в список, поэтому `null` участвует в условии явно:
       * без него `lte` отбросил бы все бессрочные новости — а это как раз обычный случай.
       *
       * Дату передаём **строкой** (`YYYY-MM-DD`), а не объектом `Date`: `postgres.js` не принимает
       * `Date` как параметр сырого выражения и падает с `TypeError`. Сравнение идёт с колонкой
       * `timestamptz`, и строка приводится к ней самим Postgres.
       */
      const onDate = input.onDate.toISOString().slice(0, 10);

      return db.orm
        .select()
        .from(newsItem)
        .where(
          and(
            active,
            lte(newsItem.publishedOn, input.onDate),
            or(isNull(newsItem.visibleUntil), sql`${newsItem.visibleUntil} >= ${onDate}`),
          ),
        )
        .orderBy(desc(newsItem.publishedOn), desc(newsItem.sortOrder))
        .limit(input.limit);
    },

    async listForEditing(input) {
      return db.orm
        .select()
        .from(newsItem)
        .where(active)
        .orderBy(desc(newsItem.publishedOn), desc(newsItem.sortOrder))
        .limit(input.limit);
    },

    async find(id) {
      const rows = await db.orm
        .select()
        .from(newsItem)
        .where(and(eq(newsItem.id, id), active))
        .limit(1);

      return rows[0] ?? null;
    },

    async create(input) {
      const created = await db.orm
        .insert(newsItem)
        .values({
          title: input.title,
          body: input.body,
          publishedOn: input.publishedOn,
          visibleUntil: input.visibleUntil,
          imageFileId: input.imageFileId,
          createdBy: input.actorUserId,
          updatedBy: input.actorUserId,
        })
        .returning();

      const row = created[0];
      if (row === undefined) throw new Error('Новость не создана');

      return row;
    },

    async update(id, input) {
      await db.orm
        .update(newsItem)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.publishedOn === undefined ? {} : { publishedOn: input.publishedOn }),
          /**
           * `visibleUntil` передан явно: `null` означает «снять срок» и **должен** записаться.
           * Проверка `!== undefined` это различает, а `??` — нет, и срок нельзя было бы убрать.
           */
          ...(input.visibleUntil === undefined ? {} : { visibleUntil: input.visibleUntil }),
          ...(input.imageFileId === undefined ? {} : { imageFileId: input.imageFileId }),
          updatedBy: input.actorUserId,
          updatedAt: new Date(),
        })
        .where(and(eq(newsItem.id, id), active));
    },

    async softDelete(input) {
      await db.orm
        .update(newsItem)
        .set({ deletedAt: new Date(), deletedBy: input.actorUserId })
        .where(and(eq(newsItem.id, input.id), active));
    },
  };
}
