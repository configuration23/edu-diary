import type { SessionResponseDto } from '@edu-diary/contracts';

import { Card } from '../components/ui';
import { Page, PageHeader, QueryState } from '../components/layout';
import { useAbout, useNews } from '../lib/queries';
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
  const about = useAbout();

  /**
   * Блок «Об учебном заведении» показывается по **явной настройке** (чек-бокс в настройках):
   * «заполнено значит показать» не подходит — администратор мог заполнить текст, но не хотеть блок
   * на первой странице.
   *
   * Пустое содержимое всё равно не рисуем: пустая карточка выглядела бы недоделкой.
   */
  const aboutTitle = about.data?.title ?? null;
  const aboutText = about.data?.text ?? null;
  const aboutVisible = about.data?.visible ?? false;
  const hasAbout = (aboutTitle ?? '') !== '' || (aboutText ?? '') !== '';
  const showAbout = aboutVisible && hasAbout;

  const items = news.data?.items ?? [];
  const [latest, ...previous] = items;

  return (
    <Page>
      <PageHeader title="Новости" />

      {/*
        «О колледже» — заполняется в настройках администратором (решение владельца).
        Показываем **сверху новостей**: это постоянные сведения о заведении, а новости меняются.
      */}
      {showAbout && (
        <Card title={aboutTitle ?? 'Об учебном заведении'}>
          {aboutText !== null && <p className="whitespace-pre-wrap text-foreground">{aboutText}</p>}
        </Card>
      )}

      <QueryState
        isLoading={news.isLoading}
        error={news.error}
        isEmpty={items.length === 0}
        emptyText="Новостей пока нет."
        onRetry={() => void news.refetch()}
      >
        {latest !== undefined && <NewsArticle item={latest} />}

        {previous.length > 0 && (
          <Card title="Предыдущие новости">
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
