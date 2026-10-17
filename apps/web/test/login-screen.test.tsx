import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LoginScreen } from '../src/screens/LoginScreen';

/**
 * Экран входа.
 *
 * Владелец поправил подсказку: человеку на экране входа нужно **действие**, а не объяснение
 * устройства системы. «Учётных записей по умолчанию нет» описывало отсутствие, но не подсказывало,
 * что делать.
 */

function render(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LoginScreen
        branding={{
          title: 'Колледж',
          shortName: 'К',
          signature: 'Дневник',
          logoDataUrl: null,
          aboutTitle: null,
          aboutText: null,
          aboutVisible: true,
        }}
      />
    </QueryClientProvider>,
  );
}

describe('экран входа', () => {
  it('подсказывает обратиться к администратору', () => {
    const html = render();

    expect(html).toContain('Для получения доступа обратитесь к администратору');
  });

  it('прежней формулировки про учётные записи нет', () => {
    const html = render();

    expect(html).not.toContain('Учётных записей по умолчанию нет');
  });
});
