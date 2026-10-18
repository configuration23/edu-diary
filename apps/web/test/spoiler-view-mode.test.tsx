import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SessionResponseDto, ViewMode } from '@edu-diary/contracts';

import { Spoiler } from '../src/components/Spoiler';

function render(viewMode: ViewMode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  /** Сессия уже в кэше: спойлер решает по ней, как выглядеть. */
  client.setQueryData<SessionResponseDto>(['session'], {
    user: {
      id: 'u-1',
      username: 'user',
      fullName: 'Пользователь',
      email: null,
      phone: null,
      isActive: true,
      mustChangePassword: false,
      theme: 'system',
      viewMode,
      roles: [{ code: 'admin', title: 'Администратор' }],
    },
    permissions: [{ permission: 'academics:read', scope: 'all' }],
  });

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Spoiler
        title="Предметы"
        summary="По предмету ставятся оценки."
        actions={<button>Добавить</button>}
      >
        <p>Содержимое блока</p>
      </Spoiler>
    </QueryClientProvider>,
  );
}

describe('вид страниц', () => {
  it('компактно: блок свёрнут в спойлер', () => {
    const html = render('compact');

    expect(html).toContain('<details');
    expect(html).toContain('Развернуть');
    expect(html).toContain('Содержимое блока');
  });

  it('компактно: действие блока видно, не раскрывая спойлер', () => {
    /**
     * Иначе вместе с раскрытием пропадает кнопка «Добавить предмет», и функция становится
     * недоступной — так и случилось при первой попытке.
     */
    const html = render('compact');

    expect(html).toContain('Добавить');
  });

  it('развёрнуто: блок идёт подряд, без «Развернуть»', () => {
    const html = render('expanded');

    expect(html).not.toContain('<details');
    expect(html).not.toContain('Развернуть');
    expect(html).toContain('Содержимое блока');
    expect(html).toContain('Добавить');
  });
});
