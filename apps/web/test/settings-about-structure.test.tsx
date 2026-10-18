import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NewsSettingsCard } from '../src/components/NewsSettingsCard';

/**
 * Структура блока настроек страницы «Обзор».
 *
 * Требование владельца: один общий блок **«Настройки страницы Обзор»**, внутри — **два саб-блока**:
 * сверху «Об учебном заведении», под ним «Новости». Раньше описание заведения стояло **после**
 * подписи блока новостей, и связь терялась: непонятно, к чему относится.
 *
 * Проверяем **порядок в разметке**, а не просто наличие слов: ошибку «подпись новостей выше
 * описания заведения» видно только по порядку, и глазами её замечают не сразу.
 */

function render(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NewsSettingsCard />
    </QueryClientProvider>,
  );
}

describe('настройки страницы «Обзор»', () => {
  it('общий блок называется «Настройки страницы Обзор»', () => {
    const html = render();

    expect(html).toContain('Настройки страницы Обзор');
  });

  it('два саб-блока: «Об учебном заведении» выше «Новостей»', () => {
    const html = render();

    const about = html.indexOf('Об учебном заведении');
    const news = html.indexOf('<h3 class="text-base font-semibold text-foreground">Новости</h3>');

    expect(about).toBeGreaterThanOrEqual(0);
    expect(news).toBeGreaterThanOrEqual(0);

    /** Описание заведения — **выше** новостей: владелец поправил именно это. */
    expect(about).toBeLessThan(news);
  });

  it('подписи «Последняя новость показывается на «Обзоре» полностью» больше нет', () => {
    /**
     * Подпись описывала поведение, которое видно на самой странице, и стояла между заголовком и
     * содержимым. Владелец просил убрать.
     */
    const html = render();

    expect(html).not.toContain('Последняя новость показывается на «Обзоре» полностью');
  });
});
