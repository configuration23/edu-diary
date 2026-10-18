import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SessionResponseDto } from '@edu-diary/contracts';

import { ScheduleScreen } from '../src/screens/ScheduleScreen';

function sessionOf(
  permissions: SessionResponseDto['permissions'],
  roles: Array<{ code: string; title: string }>,
): SessionResponseDto {
  return {
    user: {
      id: 'u-1',
      username: 'user',
      fullName: 'Пользователь',
      email: null,
      phone: null,
      isActive: true,
      mustChangePassword: false,
      theme: 'system',
      viewMode: 'compact',
      roles,
    },
    permissions,
  };
}

function render(session: SessionResponseDto): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ScheduleScreen session={session} />
    </QueryClientProvider>,
  );
}

const STUDENT = sessionOf(
  [
    { permission: 'schedule:read', scope: 'own' },
    { permission: 'grades:read', scope: 'own' },
    { permission: 'homework:read', scope: 'own' },
  ],
  [{ code: 'student', title: 'Ученик' }],
);

const PARENT = sessionOf(
  [
    { permission: 'schedule:read', scope: 'own' },
    { permission: 'grades:read', scope: 'own' },
  ],
  [{ code: 'parent', title: 'Родитель' }],
);

const ADMIN = sessionOf(
  [
    { permission: 'schedule:read', scope: 'all' },
    { permission: 'schedule:write', scope: 'all' },
    { permission: 'academics:read', scope: 'all' },
  ],
  [{ code: 'admin', title: 'Администратор' }],
);

describe('выбор группы в расписании', () => {
  it('ученику список групп не показывается', () => {
    const html = render(STUDENT);

    /** Выбирать нечего: у ученика одна группа, и она его собственная. */
    expect(html).not.toContain('Все доступные группы');
    expect(html).not.toContain('«Все доступные» — занятия по всем группам');
  });

  it('родителю список групп не показывается', () => {
    const html = render(PARENT);

    expect(html).not.toContain('Все доступные группы');
  });

  it('администратор список групп видит', () => {
    /**
     * Без этой проверки предыдущие проходили бы и после того, как выбор убрали у всех: тест
     * «скрыто у ученика» сам по себе ничего не доказывает.
     */
    const html = render(ADMIN);

    expect(html).toContain('Все доступные группы');
    expect(html).toContain('«Все доступные» — занятия по всем группам');
  });

  it('ученику не показывают подсказку «выберите группу»', () => {
    /** Она предлагает действие, которого у ученика нет. */
    const html = render(STUDENT);

    expect(html).not.toContain('Выберите группу, чтобы увидеть её занятия на день.');
  });
});
