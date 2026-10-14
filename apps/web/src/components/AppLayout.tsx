import { useEffect, useRef } from 'react';

import type { SessionResponseDto } from '@edu-diary/contracts';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';

import { Badge, Button } from './ui';
import { useLogout } from '../lib/queries';
import type { BrandingDto } from '@edu-diary/contracts';

interface NavigationItem {
  to: string;
  label: string;
  visible: (session: SessionResponseDto) => boolean;
}

const NAVIGATION: NavigationItem[] = [
  { to: '/', label: 'Обзор', visible: () => true },
  {
    to: '/academics',
    label: 'Учебный год',
    visible: (session) => has(session, 'academics:read'),
  },
  {
    to: '/groups',
    label: 'Группы и ученики',
    visible: (session) => has(session, 'academics:read'),
  },
  {
    to: '/catalogs',
    label: 'Справочники',
    visible: (session) => has(session, 'academics:read'),
  },
  {
    to: '/assignments',
    label: 'Назначения',
    visible: (session) => has(session, 'assignments:read'),
  },
  {
    to: '/schedule',
    label: 'Расписание',
    visible: (session) => has(session, 'schedule:read'),
  },
  {
    to: '/schedule/template',
    label: 'Сетка (шаблон)',
    /**
     * Только те, кто составляет расписание: администратор и преподаватель.
     *
     * Ученику и представителю этот раздел ни к чему — им нужен «Расписание» с
     * готовыми занятиями. Права `schedule:read` у них есть, поэтому раньше раздел был
     * виден всем: право отвечает на вопрос «можно ли читать расписание», а не «нужен
     * ли инструмент составления».
     */
    visible: (session) =>
      has(session, 'schedule:write') || hasScope(session, 'schedule:read', ['assigned', 'all']),
  },
  {
    to: '/lessons',
    label: 'Уроки',
    // Раздел рабочий: сетка периода, правка и замены. Ученику и родителю он не
    // нужен — у них есть «Расписание», поэтому оставляем его тем, кто ведёт
    // занятия (администратор и преподаватель).
    visible: (session) => hasScope(session, 'lessons:read', ['all', 'assigned']),
  },
  {
    to: '/substitutions',
    label: 'Замены',
    visible: (session) => hasScope(session, 'lessons:read', ['all', 'assigned']),
  },
  {
    to: '/users',
    label: 'Учётные записи и роли',
    visible: (session) => has(session, 'users:read'),
  },
  {
    to: '/privacy',
    label: 'Согласия и политика',
    visible: (session) => has(session, 'consents:read'),
  },
  {
    to: '/audit',
    label: 'Аудит',
    visible: (session) => has(session, 'audit:read'),
  },
  {
    to: '/security',
    label: 'Безопасность',
    visible: (session) => has(session, 'security:read'),
  },
  {
    to: '/analytics',
    label: 'Аналитика',
    /**
     * Видна всем ролям: у администратора и преподавателя это отчёт по группе, у ученика и
     * законного представителя — «Мои оценки». Право `analytics:read` есть у всех четырёх
     * ролей, разница только в области.
     */
    visible: (session) => has(session, 'analytics:read'),
  },
  {
    to: '/settings',
    label: 'Настройки',
    visible: (session) => has(session, 'settings:write'),
  },
];

/** Раздел виден, если право выдано с любой областью действия. */
function has(session: SessionResponseDto, permission: string): boolean {
  return session.permissions.some((grant) => grant.permission === permission);
}

/**
 * Раздел виден, только если право выдано с одной из перечисленных областей.
 *
 * Нужно, чтобы отличать роли: у преподавателя и администратора `lessons:read`
 * приходит с областью `assigned`, а у ученика и родителя — с `own`.
 */
function hasScope(session: SessionResponseDto, permission: string, scopes: string[]): boolean {
  return session.permissions.some(
    (grant) => grant.permission === permission && scopes.includes(grant.scope),
  );
}

/**
 * После выхода возвращаем приложение на стартовый экран.
 *
 * Приложение — одна страница: выход её не перезагружает, и маршрут остаётся прежним.
 * Зашли преподавателем, открыли журнал, вышли **прямо с этого экрана** и вошли другим
 * — открывался тот же журнал. Доступ к чужому уроку сервер закрывает, но выглядит это
 * как чужой журнал, а в адресе остаётся идентификатор чужих данных.
 *
 * Живёт в компоненте, а не в `useLogout`: переход по маршрутам — дело интерфейса, а
 * импорт маршрутизатора в запросы замкнул бы файлы друг на друга (`queries` ← экраны
 * ← `App`, где маршрутизатор и создаётся).
 */
function useReturnHomeAfterLogout(succeeded: boolean): void {
  const navigate = useNavigate();
  const moved = useRef(false);

  useEffect(() => {
    if (!succeeded || moved.current) return;
    moved.current = true;
    void navigate({ to: '/' });
  }, [succeeded, navigate]);
}

export function AppLayout({
  session,
  branding,
}: {
  session: SessionResponseDto;
  branding: BrandingDto;
}) {
  const logout = useLogout();
  useReturnHomeAfterLogout(logout.isSuccess);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            {branding.logoDataUrl !== null && (
              <img src={branding.logoDataUrl} alt="" className="h-8 w-8 object-contain" />
            )}
            <span className="font-semibold">
              {branding.shortName ?? branding.title ?? 'Электронный дневник'}
            </span>
          </div>

          <div className="flex items-center gap-3 text-sm">
            {/*
              Переключатель группы в шапке скрыт по решению владельца: группа выбирается
              на каждом экране, и общий выбор только путал — казалось, что он влияет на
              всё приложение, а влиял на три раздела. Компонент `GroupSwitcher` и общий
              контекст (`AcademicContext`) целы: чтобы вернуть переключатель, достаточно
              поставить его сюда обратно.
            */}
            <span className="text-slate-600">{session.user.fullName}</span>
            {session.user.roles.map((role) => (
              <Badge key={role.code}>{role.title}</Badge>
            ))}
            <Button
              tone="secondary"
              onClick={() => void logout.mutateAsync()}
              disabled={logout.isPending}
            >
              Выйти
            </Button>
          </div>
        </div>

        <nav className="mx-auto max-w-5xl px-4">
          <ul className="flex flex-wrap gap-1 pb-2 text-sm">
            {NAVIGATION.filter((item) => item.visible(session)).map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="inline-block rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                  activeProps={{
                    className: 'inline-block rounded-md px-3 py-1.5 bg-slate-900 text-white',
                  }}
                  // Точное совпадение пути: иначе «Расписание» подсвечивалось бы и
                  // на «Сетке (шаблон)» — она вложена в тот же путь.
                  activeOptions={{ exact: true }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
