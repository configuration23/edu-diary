import type { SessionResponseDto } from '@edu-diary/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AcademicsScreen } from '../src/screens/AcademicsScreen';
import { AssignmentsScreen } from '../src/screens/AssignmentsScreen';
import { CatalogsScreen } from '../src/screens/CatalogsScreen';
import { GroupsScreen } from '../src/screens/GroupsScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';

/**
 * Смоук-тесты экранов Этапа 2.
 *
 * Проверяется, что раздел монтируется и показывает свои ключевые элементы с
 * правами и без данных: запросы в этот момент ещё не выполнены, поэтому экран
 * обязан отрисовать каркас, а не упасть. Ошибки импортов и разметки ловятся
 * здесь, а не в браузере.
 */

function renderWithQueries(node: React.ReactElement): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const session: SessionResponseDto = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'admin',
    fullName: 'Администратор Системы',
    email: null,
    phone: null,
    isActive: true,
    mustChangePassword: false,
    roles: [{ code: 'admin', title: 'Администратор' }],
  },
  permissions: [
    { permission: 'academics:read', scope: 'all' },
    { permission: 'assignments:read', scope: 'all' },
    { permission: 'assignments:write', scope: 'all' },
  ],
};

describe('экраны Этапа 2 монтируются', () => {
  it('учебный год: форма создания и список', () => {
    const html = renderWithQueries(<AcademicsScreen />);

    expect(html).toContain('Новый учебный год');
    expect(html).toContain('Учебные годы');
    expect(html).toContain('Сделать активным');
  });

  it('группы: форма создания, поиск и состав', () => {
    const html = renderWithQueries(<GroupsScreen />);

    expect(html).toContain('Новая группа');
    expect(html).toContain('Поиск по названию');
    // Пока список не загрузился, показывается состояние загрузки.
    expect(html).toContain('Загружаем');
  });

  it('справочники: предметы, аудитории и категории', () => {
    const html = renderWithQueries(<CatalogsScreen />);

    expect(html).toContain('Предметы');
    expect(html).toContain('Аудитории');
    expect(html).toContain('Категории оценок');
  });

  it('назначения: администратор видит форму создания', () => {
    const html = renderWithQueries(<AssignmentsScreen session={session} />);

    expect(html).toContain('Новое назначение');
    expect(html).toContain('Все группы');
  });

  it('назначения: преподавателю форму не показывают', () => {
    const teacher: SessionResponseDto = {
      ...session,
      user: {
        ...session.user,
        roles: [{ code: 'teacher', title: 'Преподаватель' }],
      },
      permissions: [
        { permission: 'academics:read', scope: 'all' },
        { permission: 'assignments:read', scope: 'assigned' },
      ],
    };

    const html = renderWithQueries(<AssignmentsScreen session={teacher} />);

    expect(html).not.toContain('Новое назначение');
    expect(html).toContain('видны только ваши назначения');
  });

  it('настройки: поля брендинга и загрузка логотипа', () => {
    const html = renderWithQueries(<SettingsScreen />);

    expect(html).toContain('Настройки заведения');
    expect(html).toContain('Короткое название');
    expect(html).toContain('Логотип');
  });
});
