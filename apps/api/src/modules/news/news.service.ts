import type { AccessScope } from '@edu-diary/domain';

import { AppError } from '../../shared/errors';
import type { NewsImageRecord, NewsImageRepository } from './news.images.repository';
import type { NewsRecord, NewsRepository } from './news.repository';

/**
 * Новости заведения: правила и чтение.
 *
 * Решения владельца: публикует **администратор** (и будущая роль директора), видны **всем
 * вошедшим**, править и убирать можно. Последняя новость показывается полностью, предыдущие —
 * свёрнутыми до заголовка: это делает интерфейс, сервис отдаёт список **от свежих к старым**.
 */

export interface NewsViewer {
  userId: string;
  /**
   * Области прав: `news:read` нужен всем, `news:write` — только публикующим.
   *
   * `ReadonlyMap`, а не `Map`: сервис **читает** права и не должен их менять. Из сессии приходит
   * именно неизменяемая карта, и требовать изменяемую значило бы копировать её на каждом запросе.
   */
  permissions: ReadonlyMap<string, AccessScope>;
}

/** Новость в том виде, в каком её отдаём наружу. */
export interface NewsView {
  id: string;
  title: string;
  body: string;
  publishedOn: string;
  visibleUntil: string | null;
  imageUrl: string | null;
  imageName: string | null;
  /** Где показать картинку: `top` — сверху текста, `bottom` — снизу. */
  imagePosition: string;
  createdAt: string;
}

export interface NewsService {
  list(input: { viewer: NewsViewer; limit: number; forEditing?: boolean }): Promise<NewsView[]>;
  create(input: {
    viewer: NewsViewer;
    title: string;
    body: string;
    publishedOn?: string;
    visibleUntil?: string | null;
    imageFileId?: string | null;
    imagePosition?: string;
  }): Promise<{ id: string }>;
  update(input: {
    viewer: NewsViewer;
    id: string;
    title?: string;
    body?: string;
    publishedOn?: string;
    visibleUntil?: string | null;
    imageFileId?: string | null;
    imagePosition?: string;
  }): Promise<{ before: NewsView; after: NewsView }>;
  remove(input: { viewer: NewsViewer; id: string }): Promise<{ removed: NewsView }>;
  /** Картинка по идентификатору файла: нужна маршруту выдачи. */
  findImage(id: string): Promise<NewsImageRecord | null>;
}

export function createNewsService(dependencies: {
  repository: NewsRepository;
  images: NewsImageRepository;
}): NewsService {
  const { repository, images } = dependencies;

  const scopeOf = (viewer: NewsViewer, permission: string): AccessScope | undefined =>
    viewer.permissions.get(permission);

  /**
   * Новости видны **всем вошедшим** (решение владельца), поэтому «читать» — это просто наличие
   * права: область у `news:read` всегда `all`.
   */
  const requireRead = (viewer: NewsViewer): void => {
    if (scopeOf(viewer, 'news:read') === undefined) {
      throw new AppError('FORBIDDEN', 'Недостаточно прав: news:read');
    }
  };

  /** Публикация и правка — только администратор. Право отдельное, чтобы директор получил его позже. */
  const requireWrite = (viewer: NewsViewer): void => {
    if (scopeOf(viewer, 'news:write') !== 'all') {
      throw new AppError('FORBIDDEN', 'Недостаточно прав: news:write');
    }
  };

  /**
   * День без времени: `published_on` — это **день показа**, а не момент. В колонке лежит момент,
   * но сравнивать и показывать надо по календарю.
   */
  const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

  /** Ссылка на **наш** API: файлы выдаются с проверкой прав, прямой адрес хранилища обошёл бы её. */
  const imageUrlOf = (fileId: string | null): string | null =>
    fileId === null ? null : `/api/news/images/${fileId}`;

  const viewOf = (record: NewsRecord, imageName: string | null): NewsView => ({
    id: record.id,
    title: record.title,
    body: record.body,
    publishedOn: toIsoDate(record.publishedOn),
    visibleUntil: record.visibleUntil === null ? null : toIsoDate(record.visibleUntil),
    imageUrl: imageUrlOf(record.imageFileId),
    imageName,
    imagePosition: record.imagePosition,
    createdAt: record.createdAt.toISOString(),
  });

  /** Имена картинок для списка: одним запросом, а не по новости за раз. */
  const nameImages = async (records: readonly NewsRecord[]): Promise<Map<string, string>> => {
    const ids = records
      .map((record) => record.imageFileId)
      .filter((id): id is string => id !== null);
    const found = await images.listByIds(ids);

    return new Map(found.map((image) => [image.id, image.originalName]));
  };

  const parseDate = (value: string, field: string): Date => {
    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(parsed.getTime())) {
      throw new AppError('VALIDATION_FAILED', `Некорректная дата: ${field}`);
    }

    return parsed;
  };

  const requireNews = async (id: string): Promise<NewsRecord> => {
    const found = await repository.find(id);
    if (found === null) throw new AppError('NOT_FOUND', 'Новость не найдена');

    return found;
  };

  const viewWithImage = async (record: NewsRecord): Promise<NewsView> => {
    const names = await nameImages([record]);

    return viewOf(
      record,
      record.imageFileId === null ? null : (names.get(record.imageFileId) ?? null),
    );
  };

  return {
    async list(input) {
      requireRead(input.viewer);

      /**
       * Для правки показываем и то, что **ещё не наступило** или **уже истекло**: иначе
       * подготовленную или просроченную новость нельзя было бы найти и поправить. Показ же
       * фильтрует по датам.
       */
      const records = input.forEditing
        ? await repository.listForEditing({ limit: input.limit })
        : await repository.listVisible({ onDate: new Date(), limit: input.limit });

      const names = await nameImages(records);

      return records.map((record) =>
        viewOf(
          record,
          record.imageFileId === null ? null : (names.get(record.imageFileId) ?? null),
        ),
      );
    },

    async create(input) {
      requireWrite(input.viewer);

      const created = await repository.create({
        title: input.title,
        body: input.body,
        publishedOn:
          input.publishedOn === undefined
            ? new Date()
            : parseDate(input.publishedOn, 'дата показа'),
        visibleUntil:
          input.visibleUntil === undefined || input.visibleUntil === null
            ? null
            : parseDate(input.visibleUntil, 'срок показа'),
        imageFileId: input.imageFileId ?? null,
        /** По умолчанию сверху: обычный случай не должен требовать выбора. */
        imagePosition: input.imagePosition ?? 'top',
        actorUserId: input.viewer.userId,
      });

      return { id: created.id };
    },

    async update(input) {
      requireWrite(input.viewer);

      const before = await requireNews(input.id);

      await repository.update(input.id, {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.publishedOn === undefined
          ? {}
          : { publishedOn: parseDate(input.publishedOn, 'дата показа') }),
        ...(input.visibleUntil === undefined
          ? {}
          : {
              visibleUntil:
                input.visibleUntil === null ? null : parseDate(input.visibleUntil, 'срок показа'),
            }),
        ...(input.imageFileId === undefined ? {} : { imageFileId: input.imageFileId }),
        ...(input.imagePosition === undefined ? {} : { imagePosition: input.imagePosition }),
        actorUserId: input.viewer.userId,
      });

      return {
        before: await viewWithImage(before),
        after: await viewWithImage(await requireNews(input.id)),
      };
    },

    async remove(input) {
      requireWrite(input.viewer);

      const found = await requireNews(input.id);
      const removed = await viewWithImage(found);

      await repository.softDelete({ id: input.id, actorUserId: input.viewer.userId });

      return { removed };
    },

    async findImage(id) {
      const found = await images.listByIds([id]);

      return found[0] ?? null;
    },
  };
}
