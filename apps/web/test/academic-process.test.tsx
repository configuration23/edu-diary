import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SessionResponseDto } from '@edu-diary/contracts';

import { AcademicProcessScreen } from '../src/screens/AcademicProcessScreen';

/**
 * «Учебный процесс»: три страницы одной, каждый раздел — спойлер.
 *
 * Решение владельца: «Учебный год», «Группы и ученики» и «Назначения» объединены. Каждый раздел
 * **свёрнут** и имеет описание в одну-две строки — иначе объединение дало бы ту же простыню, от
 * которой уходили.
 */

function render(session: SessionResponseDto): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AcademicProcessScreen session={session} />
    </QueryClientProvider>,
  );
}

const admin: SessionResponseDto = {
  user: {
    id: 'u-1',
    username: 'admin',
    fullName: 'Администратор',
    email: null,
    phone: null,
    isActive: true,
    mustChangePassword: false,
    roles: [{ code: 'admin', title: 'Администратор' }],
  },
  permissions: [
    { permission: 'academics:read', scope: 'all' },
    { permission: 'academics:write', scope: 'all' },
    { permission: 'assignments:read', scope: 'all' },
    { permission: 'students:write', scope: 'all' },
  ],
};

const teacher: SessionResponseDto = {
  ...admin,
  user: { ...admin.user, id: 'u-2', roles: [{ code: 'teacher', title: 'Преподаватель' }] },
  /** У преподавателя нет права заводить учеников: блок «Ученики» ему не показываем. */
  permissions: [
    { permission: 'academics:read', scope: 'assigned' },
    { permission: 'assignments:read', scope: 'assigned' },
  ],
};

describe('страница «Учебный процесс»', () => {
  it('все четыре раздела на месте и свёрнуты', () => {
    const html = render(admin);

    expect(html).toContain('Учебные годы');
    expect(html).toContain('Группы');
    expect(html).toContain('Ученики');
    expect(html).toContain('Назначения');

    /**
     * Спойлер свёрнут по умолчанию: в разметке нет `open`. Если разделы окажутся раскрытыми,
     * страница снова станет простынёй — это и была причина объединения.
     */
    expect(html).not.toContain('<details open');
  });

  it('у каждого раздела есть короткое описание', () => {
    const html = render(admin);

    /** Описания в одну-две строки: по ним человек решает, раскрывать ли раздел. */
    expect(html).toContain('На активный год ориентируются группы и назначения');
    expect(html).toContain('зачисление и отчисление');
    expect(html).toContain('Урока без назначения не бывает');
  });

  it('преподавателю блок учеников не показывают', () => {
    const html = render(teacher);

    /** Заводить учеников вправе не все: блок скрыт, остальные разделы на месте. */
    expect(html).not.toContain('Карточки учеников');
    expect(html).toContain('Учебные годы');
    expect(html).toContain('Назначения');
  });
});
