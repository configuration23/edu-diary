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
  imagePosition: 'top',
  createdAt: '2026-10-05T10:00:00.000Z',
};

const IMAGE_URL = '/api/news/images/00000000-0000-7000-8000-000000000002';
const IMAGE_NAME = 'линейка.jpg';

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
      <NewsArticle item={{ ...item, imageUrl: IMAGE_URL, imageName: IMAGE_NAME }} />,
    );
    expect(withImage).toContain(IMAGE_URL);
    expect(withImage).toContain(IMAGE_NAME);
  });

  it('картинка оформлена сама: скругление, рамка и тень на ней', () => {
    /**
     * Просьба владельца: оформление должно быть **на самой картинке**, а не на блоке вокруг неё.
     *
     * Здесь была ошибка: эффект лежал на обёртке, и скругление с тенью были видны **вокруг**
     * картинки, а она оставалась голой внутри. Поэтому проверяем **классы тега `img`**, а не
     * страницы: иначе та же ошибка пройдёт незамеченной.
     */
    const html = render(<NewsArticle item={{ ...item, imageUrl: IMAGE_URL }} />);

    const imgTag = /<img[^>]*>/.exec(html)?.[0] ?? '';
    expect(imgTag).not.toBe('');

    expect(imgTag).toContain('rounded-md');
    expect(imgTag).toContain('shadow-sm');
    expect(imgTag).toContain('border');

    /** Снимок показываем целиком: обрезка хуже свободного места. */
    expect(imgTag).toContain('object-contain');

    /** Обёртки вокруг картинки быть не должно: иначе эффект снова окажется не на ней. */
    expect(html).not.toContain('--color-surface-muted');
  });

  it('картинка встаёт сверху или снизу текста — по выбору автора', () => {
    /**
     * Решение владельца: у новости есть **опция**, где показать картинку. Проверяем порядок в
     * разметке: фото с линейки уместнее сверху, а схема или таблица — под текстом. Если однажды
     * выбор перестанет применяться, картинка окажется не там, и это будет видно.
     */
    const top = render(
      <NewsArticle item={{ ...item, imageUrl: IMAGE_URL, imagePosition: 'top' }} />,
    );
    const bottom = render(
      <NewsArticle item={{ ...item, imageUrl: IMAGE_URL, imagePosition: 'bottom' }} />,
    );

    const bodyIndex = (html: string) => html.indexOf('В четверг в 18:00');
    const imageIndex = (html: string) => html.indexOf('<img');

    expect(imageIndex(top)).toBeGreaterThanOrEqual(0);
    expect(imageIndex(top)).toBeLessThan(bodyIndex(top));

    expect(imageIndex(bottom)).toBeGreaterThan(bodyIndex(bottom));
  });
});
