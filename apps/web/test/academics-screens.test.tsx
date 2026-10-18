import type { SessionResponseDto } from '@edu-diary/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AcademicsScreen } from '../src/screens/AcademicsScreen';
import { AssignmentsScreen } from '../src/screens/AssignmentsScreen';
import { CatalogsScreen } from '../src/screens/CatalogsScreen';
import { GroupsScreen } from '../src/screens/GroupsScreen';
import { ProfileScreen } from '../src/screens/ProfileScreen';
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
    theme: 'system',
    viewMode: 'compact',
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
  it('учебный год: список и кнопка создания, форма скрыта', () => {
    const html = renderWithQueries(<AcademicsScreen />);

    /** Список — главное на странице; форма открывается кнопкой (решение владельца). */
    expect(html).toContain('Учебные годы');
    expect(html).toContain('Создать год');

    /** По умолчанию формы нет: иначе она снова займёт первый экран. */
    expect(html).not.toContain('Сделать активным');
  });

  it('группы: ученики первыми, затем группы; формы по кнопкам', () => {
    const html = renderWithQueries(<GroupsScreen canManageStudents />);

    // Порядок отражает работу: сначала люди, потом группа из них.
    expect(html.indexOf('Ученики')).toBeLessThan(html.indexOf('Группы'));

    /** Обе формы открываются кнопками, а не висят на странице. */
    expect(html).toContain('Завести ученика');
    expect(html).toContain('Создать группу');

    /** Поиска по названию группы больше нет: на его месте кнопка. */
    expect(html).not.toContain('Поиск по названию');
    expect(html).toContain('Загружаем');
  });

  it('группы: преподавателю блоки учеников не показывают', () => {
    const html = renderWithQueries(<GroupsScreen />);

    expect(html).not.toContain('Завести ученика');
    expect(html).toContain('Создать группу');
  });

  it('справочники: предметы, аудитории, причины оценок и знаки', () => {
    const html = renderWithQueries(<CatalogsScreen />);

    expect(html).toContain('Предметы');
    expect(html).toContain('Аудитории');
    // Причины оценок: причина обязательна при выставлении и задаёт вес.
    expect(html).toContain('Причины оценок');
    // Накопительные знаки: сколько плюсов и точек нужно для оценки.
    expect(html).toContain('Знаки: сколько нужно для оценки');
  });

  it('назначения: администратор видит кнопку создания, форма скрыта', () => {
    const html = renderWithQueries(<AssignmentsScreen session={session} />);

    /** Форма открывается кнопкой в шапке списка (решение владельца). */
    expect(html).toContain('Создать назначение');
    expect(html).toContain('Все группы');

    /** Фильтр по группе остался: это не действие, а отбор списка. */
    expect(html).not.toContain('Новое назначение');
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

  it('настройки: блоки свёрнуты, поля заведения на месте', () => {
    const html = renderWithQueries(<SettingsScreen />);

    /** Название блока живёт в сводке спойлера: внутри своего заголовка у него больше нет. */
    expect(html).toContain('Заведение');

    /** Все блоки настроек — под спойлерами, по умолчанию свёрнуты. */
    expect(html).toContain('<details');

    expect(html).toContain('Короткое название');
    expect(html).toContain('Логотип');
  });

  it('новый ученик: кнопка создания, форма скрыта до нажатия', () => {
    const html = renderWithQueries(<StudentsCard onNotice={() => {}} />);

    /** Форма открывается кнопкой «Завести ученика» в шапке блока «Ученики». */
    expect(html).toContain('Завести ученика');
    expect(html).toContain('Ученики');
    expect(html).not.toContain('Сразу создать учётную запись');
  });

  it('роли ученика и родителя в общей форме не предлагаются', () => {
    // Роли приходят из API (в смоук-тесте данных нет), поэтому проверяем текст
    // подсказки: она объясняет, где заводить учеников и представителей.
    const html = renderWithQueries(<UsersScreen session={session} />);

    expect(html).toContain('Роли сотрудника');
    expect(html).toContain('Новый законный представитель');
    expect(html).toContain('Группы и ученики');
  });

  it('обзор: новости заведения, без данных учётной записи и состояния системы', () => {
    /**
     * «Обзор» стал **новостями заведения** (Этап 6), а данные учётной записи и состояние системы
     * уехали в профиль. Проверяем обе стороны, иначе разделение разъедется молча.
     *
     * Название пункта меню при этом **не менялось**: владелец подтвердил, что меняется содержимое.
     */
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
            theme: 'system',
            viewMode: 'compact',
            roles: [{ code: 'admin', title: 'Администратор' }],
          },
          permissions: [],
        }}
      />,
    );

    /**
     * Заголовок страницы — просто «Новости» (правка владельца): и страница, и блок называются
     * одинаково, без поясняющей подписи.
     */
    expect(html).toContain('Новости');

    expect(html).not.toContain('Смена пароля');
    expect(html).not.toContain('Ваш доступ');
    expect(html).not.toContain('Схема БД (миграций)');
    expect(html).not.toContain('Сервер и база данных');
    expect(html).not.toContain('Что дальше');
  });

  it('профиль администратора: данные, пароль, права, состояние системы и версия', () => {
    /** Всё, что убрано с «Обзора», должно быть **найдено** в профиле, а не потеряно. */
    const html = renderWithQueries(
      <ProfileScreen
        session={{
          user: {
            id: 'u-1',
            username: 'admin',
            fullName: 'Админ Системы',
            email: 'admin@example.ru',
            phone: '+7 900 000-00-00',
            isActive: true,
            mustChangePassword: false,
            theme: 'system',
            viewMode: 'compact',
            roles: [{ code: 'admin', title: 'Администратор' }],
          },
          permissions: [{ permission: 'settings:write', scope: 'all' }],
        }}
      />,
    );

    expect(html).toContain('Данные профиля');
    expect(html).toContain('admin@example.ru');
    expect(html).toContain('Смена пароля');

    /**
     * Тема — личная настройка, поэтому живёт в профиле.
     *
     * Проверяем **три состояния**, а не два: «как в системе» — отдельное намерение, и без него
     * человек с тёмной ОС получал бы светлый дневник по умолчанию.
     */
    expect(html).toContain('Оформление');
    expect(html).toContain('Как в системе');
    expect(html).toContain('Светлая');
    expect(html).toContain('Тёмная');
    expect(html).toContain('Ваш доступ');
    expect(html).toContain('О версии');
    expect(html).toContain('Схема БД (миграций)');
  });

  it('профиль преподавателя: технических сведений нет', () => {
    /**
     * Решение владельца: «О версии» и состояние системы видит **только администратор**. Проверяем
     * на роли без общесистемных настроек — иначе блоки утекали бы всем, у кого есть профиль.
     */
    const html = renderWithQueries(
      <ProfileScreen
        session={{
          user: {
            id: 'u-2',
            username: 'prepod',
            fullName: 'Преподаватель Электронный',
            email: null,
            phone: null,
            isActive: true,
            mustChangePassword: false,
            theme: 'system',
            viewMode: 'compact',
            roles: [{ code: 'teacher', title: 'Преподаватель' }],
          },
          permissions: [{ permission: 'grades:write', scope: 'assigned' }],
        }}
      />,
    );

    expect(html).toContain('Данные профиля');
    expect(html).toContain('Смена пароля');
    expect(html).not.toContain('О версии');
    expect(html).not.toContain('Сервер и база данных');
  });
});
