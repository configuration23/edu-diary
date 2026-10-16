import type { SessionResponseDto } from '@edu-diary/contracts';

import { Card } from '../components/ui';
import { Page, PageHeader, QueryState } from '../components/layout';
import { useNews } from '../lib/queries';
import { NewsArticle, NewsCollapsedItem } from '../components/NewsList';

/**
 * «Обзор» — новости заведения.
 *
 * Решения владельца: последняя новость показывается **полностью**, предыдущие **сворачиваются до
 * одной строки** — виден только заголовок. Разворачиваются нажатием.
 *
 * Название пункта меню **«Обзор» остаётся**: владелец подтвердил, что менялось содержимое, а не
 * название.
 *
 * Список приходит от свежих к старым, поэтому «последняя» — это первая: интерфейс ничего не
 * выбирает сам и не может разойтись с порядком на сервере.
 */
export function DashboardScreen(_props: { session: SessionResponseDto }) {
  const news = useNews();

  const items = news.data?.items ?? [];
  const [latest, ...previous] = items;

  return (
    <Page>
      <PageHeader
        title="Новости заведения"
        description="Что нового в колледже. Предыдущие новости свёрнуты — нажмите, чтобы прочитать."
      />

      <QueryState
        isLoading={news.isLoading}
        error={news.error}
        isEmpty={items.length === 0}
        emptyText="Новостей пока нет."
        onRetry={() => void news.refetch()}
      >
        {latest !== undefined && <NewsArticle item={latest} />}

        {previous.length > 0 && (
          <Card title="Ранее">
            <ul className="flex flex-col">
              {previous.map((item) => (
                <NewsCollapsedItem key={item.id} item={item} />
              ))}
            </ul>
          </Card>
        )}
      </QueryState>
    </Page>
  );
}
