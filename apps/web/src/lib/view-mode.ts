import type { ViewMode } from '@edu-diary/contracts';

import { useSession } from './queries';

/**
 * Вид страницы для текущего человека.
 *
 * Пока сессии нет (загрузка, экран входа, тесты без данных) — `compact`: это прежнее поведение
 * спойлеров, и оно не «прыгает» при первой отрисовке.
 */
export function useViewMode(): ViewMode {
  const session = useSession();

  return session.data?.user.viewMode ?? 'compact';
}
