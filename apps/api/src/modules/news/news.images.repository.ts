import { and, inArray, isNull } from 'drizzle-orm';

import type { Database } from '../../shared/db/client';
import { newsImage } from './news.schema';

/**
 * Картинки новостей: метаданные файла.
 *
 * Сам файл лежит в хранилище — здесь только ключ и размеры. Картинка привязывается к новости
 * **самим фактом** заполнения `news_item.image_file_id`: файл загружается до сохранения новости,
 * поэтому до привязки он ничей.
 */

export interface NewsImageRecord {
  id: string;
  storageKey: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  uploadedBy: string | null;
}

export interface NewsImageRepository {
  /** Запомнить загруженную картинку: к новости её привяжут позже. */
  createPending(input: {
    storageKey: string;
    originalName: string;
    sizeBytes: number;
    mimeType: string;
    uploadedBy: string;
  }): Promise<{ id: string }>;
  listByIds(ids: readonly string[]): Promise<NewsImageRecord[]>;
}

export function createNewsImageRepository(db: Database): NewsImageRepository {
  return {
    async createPending(input) {
      const created = await db.orm
        .insert(newsImage)
        .values({
          storageKey: input.storageKey,
          originalName: input.originalName,
          sizeBytes: input.sizeBytes,
          mimeType: input.mimeType,
          uploadedBy: input.uploadedBy,
        })
        .returning({ id: newsImage.id });

      const row = created[0];
      if (row === undefined) throw new Error('Картинка не сохранена');

      return { id: row.id };
    },

    async listByIds(ids) {
      if (ids.length === 0) return [];

      /** Помеченные удалёнными не отдаём: файл убран, показывать его нельзя. */
      return db.orm
        .select({
          id: newsImage.id,
          storageKey: newsImage.storageKey,
          originalName: newsImage.originalName,
          sizeBytes: newsImage.sizeBytes,
          mimeType: newsImage.mimeType,
          uploadedBy: newsImage.uploadedBy,
        })
        .from(newsImage)
        .where(and(inArray(newsImage.id, [...ids]), isNull(newsImage.deletedAt)));
    },
  };
}
