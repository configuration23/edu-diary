import type { SessionResponseDto } from '@edu-diary/contracts';
import { Link, Outlet } from '@tanstack/react-router';

import { Badge, Button } from './ui';
import { GroupSwitcher } from './AcademicContext';
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
    visible: (session) => has(session, 'schedule:read'),
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

export function AppLayout({
  session,
  branding,
}: {
  session: SessionResponseDto;
  branding: BrandingDto;
}) {
  const logout = useLogout();

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
            <GroupSwitcher />
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
