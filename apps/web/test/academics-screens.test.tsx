import type { SessionResponseDto } from '@edu-diary/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AcademicsScreen } from '../src/screens/AcademicsScreen';
import { AssignmentsScreen } from '../src/screens/AssignmentsScreen';
import { CatalogsScreen } from '../src/screens/CatalogsScreen';
import { GroupsScreen } from '../src/screens/GroupsScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { StudentsCard } from '../src/screens/StudentsCard';
import { UsersScreen } from '../src/screens/UsersScreen';
import { DashboardScreen } from '../src/screens/DashboardScreen';

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
    { permission: 'users:read', scope: 'all' },
    { permission: 'users:write', scope: 'all' },
    { permission: 'students:write', scope: 'all' },
  ],
};

describe('экраны Этапа 2 монтируются', () => {
  it('учебный год: форма создания и список', () => {
    const html = renderWithQueries(<AcademicsScreen />);

    expect(html).toContain('Новый учебный год');
    expect(html).toContain('Учебные годы');
    expect(html).toContain('Сделать активным');
  });

  it('группы: ученики первыми, затем группы', () => {
    const html = renderWithQueries(<GroupsScreen canManageStudents />);

    // Порядок отражает работу: сначала люди, потом группа из них.
    expect(html.indexOf('Новый ученик')).toBeGreaterThan(-1);
    expect(html.indexOf('Новый ученик')).toBeLessThan(html.indexOf('Новая группа'));
    expect(html).toContain('Ученики');
    expect(html).toContain('Поиск по названию');
    expect(html).toContain('Загружаем');
  });

  it('группы: преподавателю блоки учеников не показывают', () => {
    const html = renderWithQueries(<GroupsScreen />);

    expect(html).not.toContain('Новый ученик');
    expect(html).toContain('Новая группа');
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

  it('новый ученик: учётная запись по выбору, без обязательных пустых полей', () => {
    const html = renderWithQueries(<StudentsCard onNotice={() => {}} />);

    // Карточка ученика — основное действие, учётная запись — по выбору.
    expect(html).toContain('Новый ученик');
    expect(html).toContain('Сразу создать учётную запись');
    expect(html).toContain('Ученики');
    // Дата рождения и примечание — необязательные.
    expect(html).toContain('Необязательно');
  });

  it('роли ученика и родителя в общей форме не предлагаются', () => {
    // Роли приходят из API (в смоук-тесте данных нет), поэтому проверяем текст
    // подсказки: она объясняет, где заводить учеников и представителей.
    const html = renderWithQueries(<UsersScreen session={session} />);

    expect(html).toContain('Роли сотрудника');
    expect(html).toContain('Новый законный представитель');
    expect(html).toContain('Группы и ученики');
  });

  it('обзор: блок версии вместо обещаний этапов', () => {
    const html = renderWithQueries(
      <DashboardScreen
        session={{
          user: {
            id: 'u-1',
            username: 'admin',
            fullName: 'Админ Системы',
            email: null,
            phone: null,
            isActive: true,
            mustChangePassword: false,
            roles: [{ code: 'admin', title: 'Администратор' }],
          },
          permissions: [],
        }}
      />,
    );

    expect(html).toContain('О версии');
    expect(html).toContain('Версия API');
    expect(html).toContain('Версия интерфейса');
    expect(html).toContain('Схема БД (миграций)');
    expect(html).not.toContain('Что дальше');
  });
});
