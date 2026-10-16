/**
 * Публичный интерфейс модуля `news` (Этап 6).
 *
 * Новости заведения: таблицы, доступ к данным, правила и маршруты. Таблицы отдаются наружу для
 * миграций; другие модули работают с новостями через сервис.
 */

export { newsImage, newsItem } from './news.schema';
export { createNewsRepository, type NewsRecord, type NewsRepository } from './news.repository';
export {
  createNewsImageRepository,
  type NewsImageRecord,
  type NewsImageRepository,
} from './news.images.repository';
export {
  createNewsService,
  type NewsService,
  type NewsView,
  type NewsViewer,
} from './news.service';
export { createNewsModule } from './news.routes';
