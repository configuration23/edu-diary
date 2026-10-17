import type { SessionResponseDto } from '@edu-diary/contracts';

/**
 * Правила доступа к разделам — **в одном месте**.
 *
 * Их читают двое: меню (`AppLayout`) и гейт маршрутов (`PageGuard`). Раньше правила жили
 * только в меню, и раздел, скрытый из списка, всё равно открывался по прямой ссылке: экран
 * монтировался, запросы уходили и получали `403`. Два списка правил разошлись бы снова,
 * поэтому источник один.
 *
 * Право с любой областью — `has`; право только с нужной областью — `hasScope`. Разница
 * важна: у ученика есть `lessons:read`, но с областью `own`, и «Уроки» ему не положены —
 * если проверять просто наличие права, гейт пропустит его и дыра останется.
 */

export interface NavigationItem {
  to: string;
  label: string;
  visible: (session: SessionResponseDto) => boolean;
}

/** Право выдано с любой областью действия. */
export function has(session: SessionResponseDto, permission: string): boolean {
  return session.permissions.some((grant) => grant.permission === permission);
}

/** Право выдано с одной из перечисленных областей. */
export function hasScope(
  session: SessionResponseDto,
  permission: string,
  scopes: string[],
): boolean {
  return session.permissions.some(
    (grant) => grant.permission === permission && scopes.includes(grant.scope),
  );
}

/**
 * Системный администратор — тот, у кого **общесистемные** настройки, а не настройки заведения.
 *
 * Нужно, чтобы отделить администратора от будущей роли **директора**: директор настраивает
 * заведение (брендинг, новости, справочники), но технические сведения — состояние сервера, версия
 * приложения, схема базы — ему не нужны и могут только путать.
 *
 * Проверяем **право**, а не код роли: право можно переназначить, и проверка по роли разошлась бы с
 * ним молча. Ровно по этой причине здесь нет сравнения с `admin`.
 */
export function isSystemAdmin(session: SessionResponseDto): boolean {
  return hasScope(session, 'settings:write', ['all']);
}

export const NAVIGATION: NavigationItem[] = [
  /**
   * Пункта «Профиль» **в меню нет** по решению владельца: единственный путь — нажать на своё ФИО
   * в шапке. Из меню раздел убран, потому что это не раздел приложения, а **личная страница**:
   * человек ищет её там, где видит своё имя, а в общем списке она только удлиняла меню.
   *
   * Маршрут `/profile` при этом существует и защищён сессией — просто в списке не объявлен.
   */
  { to: '/', label: 'Обзор', visible: () => true },
  /**
   * «Учебный процесс» — годы, группы, ученики и назначения одной страницей (решение владельца).
   *
   * Раньше это были три пункта меню, хотя работа идёт по одной цепочке: год → группы → ученики →
   * назначения. Три перехода между связанными разделами только мешали.
   */
  {
    to: '/academic-process',
    label: 'Учебный процесс',
    visible: (session) => has(session, 'academics:read') || has(session, 'assignments:read'),
  },
  {
    to: '/catalogs',
    label: 'Справочники',
    visible: (session) => has(session, 'academics:read'),
  },
  {
    to: '/schedule',
    label: 'Расписание',
    visible: (session) => has(session, 'schedule:read'),
  },
  {
    to: '/lessons',
    label: 'Уроки',
    // Раздел рабочий: сетка периода, правка и замены. Ученику и родителю он не нужен —
    // у них есть «Расписание», поэтому оставляем его тем, кто ведёт занятия.
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
    to: '/homework',
    label: 'Мои задания',
    /**
     * Раздел **ученика и представителя**: что задано и что сдано.
     *
     * Преподавателю он не нужен (решение владельца): задания он ставит в журнале урока, а
     * работы учеников смотрит в «Сданных работах». Раньше раздел показывался всем, у кого есть
     * `homework:read`, и у преподавателя это был список без дела.
     */
    visible: (session) => hasScope(session, 'homework:read', ['own']),
  },
  {
    to: '/submitted',
    label: 'Сданные работы',
    /**
     * Раздел **проверяющего**: таблица класса — напротив каждого ученика его ответ или пометка
     * «не сдал». Администратор видит и его, и «Мои задания».
     */
    visible: (session) => hasScope(session, 'homework:read', ['assigned', 'all']),
  },
  {
    to: '/analytics',
    label: 'Оценки и посещение',
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

/**
 * Можно ли открыть адрес.
 *
 * Журнал урока (`/lessons/:id`) в списке меню отсутствует — это не раздел, а экран
 * занятия, — поэтому у него отдельное правило: он доступен тем, кому доступны «Уроки»
 * либо «Расписание» (ученик и представитель смотрят занятия своих групп).
 */
export function canOpenRoute(session: SessionResponseDto, path: string): boolean {
  const item = NAVIGATION.find((entry) => entry.to === path);
  if (item !== undefined) return item.visible(session);

  if (path.startsWith('/lessons/')) {
    return (
      hasScope(session, 'lessons:read', ['all', 'assigned']) ||
      hasScope(session, 'schedule:read', ['own', 'all', 'assigned'])
    );
  }

  /**
   * Профиль: открыт **каждому вошедшему**, но пункта в меню нет — единственный путь туда это
   * своё ФИО в шапке.
   *
   * Правило нужно здесь отдельно: гейт берёт доступ из того же списка, что и меню, а из меню
   * профиль убран. Без этой строки адрес считался неизвестным, и человек по своему же имени
   * попадал на «Страница не найдена» — так и случилось при первой проверке.
   */
  if (path === '/profile') return true;

  /** Адрес, которого нет в приложении: закрыт так же, как недоступный раздел. */
  return false;
}
