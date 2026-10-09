import type { SessionResponseDto } from '@edu-diary/contracts';
import { Link, Outlet } from '@tanstack/react-router';

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
    to: '/users',
    label: 'Пользователи и роли',
    visible: (session) => session.permissions.some((grant) => grant.permission === 'users:read'),
  },
  {
    to: '/privacy',
    label: 'Согласия и политика',
    visible: (session) => session.permissions.some((grant) => grant.permission === 'consents:read'),
  },
  {
    to: '/audit',
    label: 'Аудит',
    visible: (session) => session.permissions.some((grant) => grant.permission === 'audit:read'),
  },
  {
    to: '/security',
    label: 'Безопасность',
    visible: (session) => session.permissions.some((grant) => grant.permission === 'security:read'),
  },
];

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
