import { useEffect, useRef } from 'react';

import type { SessionResponseDto } from '@edu-diary/contracts';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';

import { NAVIGATION } from '../lib/access';
import { Badge, Button } from './ui';
import { useLogout } from '../lib/queries';
import type { BrandingDto } from '@edu-diary/contracts';

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
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
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
            {/*
              Имя ведёт в профиль: человек ищет свои данные там, где видит своё имя. Ссылка, а не
              кнопка, — работает средней кнопкой мыши и открывается в новой вкладке.
            */}
            <Link
              to="/profile"
              className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
              activeProps={{ className: 'rounded-md px-2 py-1 bg-primary text-primary-foreground' }}
            >
              {session.user.fullName}
            </Link>
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
                  className="inline-block rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted"
                  activeProps={{
                    className:
                      'inline-block rounded-md px-3 py-1.5 bg-primary text-primary-foreground',
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
