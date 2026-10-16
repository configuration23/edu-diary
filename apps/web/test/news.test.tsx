import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NewsArticle, NewsCollapsedItem } from '../src/components/NewsList';
import type { NewsItemDto } from '@edu-diary/contracts';

/**
 * Новости: свежая показывается целиком, предыдущие — **одной строкой**.
 *
 * Требование владельца: свёрнутая новость занимает **одну строку** и содержит только заголовок.
 * Проверяем ровно это: в свёрнутом виде текста новости нет, а заголовок и дата есть. Если однажды
 * кто-то решит «показать кусочек текста», строка перестанет быть строкой — тест это заметит.
 */

function render(node: React.ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const item: NewsItemDto = {
  id: '00000000-0000-7000-8000-000000000001',
  title: 'Родительское собрание',
  body: 'В четверг в 18:00 в актовом зале.',
  publishedOn: '2026-10-05',
  visibleUntil: null,
  imageUrl: null,
  imageName: null,
  createdAt: '2026-10-05T10:00:00.000Z',
};

describe('новости', () => {
  it('свежая новость показывается целиком', () => {
    const html = render(<NewsArticle item={item} />);

    expect(html).toContain('Родительское собрание');
    expect(html).toContain('В четверг в 18:00 в актовом зале.');
    expect(html).toContain('05.10.2026');
  });

  it('свёрнутая новость — одна строка: заголовок и дата, без текста', () => {
    const html = render(<NewsCollapsedItem item={item} />);

    expect(html).toContain('Родительское собрание');
    expect(html).toContain('05.10.2026');

    /** Тела новости в свёрнутом виде быть не должно: иначе это уже не одна строка. */
    expect(html).not.toContain('В четверг в 18:00 в актовом зале.');
  });

  it('картинка показывается, только когда она есть', () => {
    const withoutImage = render(<NewsArticle item={item} />);
    expect(withoutImage).not.toContain('<img');

    const withImage = render(
      <NewsArticle
        item={{
          ...item,
          imageUrl: '/api/news/images/00000000-0000-7000-8000-000000000002',
          imageName: 'линейка.jpg',
        }}
      />,
    );
    expect(withImage).toContain('/api/news/images/00000000-0000-7000-8000-000000000002');
    expect(withImage).toContain('линейка.jpg');
  });
});
