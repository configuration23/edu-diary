import type { ReactNode } from 'react';

import type { SessionResponseDto } from '@edu-diary/contracts';
import { useLocation } from '@tanstack/react-router';

import { canOpenRoute } from '../lib/access';
import { Card, EmptyState } from './ui';

/**
 * Один и тот же ответ на «нет такого адреса» и «раздел есть, но прав нет».
 *
 * Решение владельца: разные ответы рассказывают злоумышленнику о том, какие разделы
 * существуют. Поэтому и неизвестный адрес, и закрытый раздел выглядят **одинаково** — так
 * же, как сервер отвечает `404` на чужой урок вместо `403`.
 */
export function NotFoundPage() {
  return (
    <Card>
      <EmptyState>
        Страница не найдена. Проверьте адрес — возможно, ссылка устарела или в ней опечатка.
      </EmptyState>
    </Card>
  );
}

/**
 * Гейт маршрута: проверяет доступ **до** отрисовки экрана.
 *
 * Без него закрытый раздел открывался по прямой ссылке: экран монтировался, уходили
 * запросы и получали `403` — человек видел заголовок, описание и фильтры чужого раздела.
 * Теперь экран не монтируется вовсе, поэтому и лишних запросов нет.
 *
 * Правило берётся из общего списка (`lib/access`): он же питает меню, чтобы видимость
 * пункта и доступ к адресу не разошлись.
 */
export function PageGuard({
  session,
  children,
}: {
  session: SessionResponseDto;
  children: ReactNode;
}) {
  const location = useLocation();

  if (!canOpenRoute(session, location.pathname)) return <NotFoundPage />;

  return <>{children}</>;
}
