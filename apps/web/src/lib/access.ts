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

export const NAVIGATION: NavigationItem[] = [
  /**
   * Профиль доступен **каждому вошедшему**: это свои данные, свой пароль и свои права. Права на
   * раздел не требуется — требовать их было бы странно.
   */
  { to: '/profile', label: 'Профиль', visible: () => true },
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
     * Ученику и представителю этот раздел ни к чему — им нужен «Расписание» с готовыми
     * занятиями. Права `schedule:read` у них есть, поэтому раньше раздел был виден всем:
     * право отвечает на вопрос «можно ли читать расписание», а не «нужен ли инструмент
     * составления».
     */
    visible: (session) =>
      has(session, 'schedule:write') || hasScope(session, 'schedule:read', ['assigned', 'all']),
  },
  {
    to: '/lessons',
    label: 'Уроки',
    // Раздел рабочий: сетка периода, правка и замены. Ученику и родителю он не нужен —
    // у них есть «Расписание», поэтому оставляем его тем, кто ведёт занятия.
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

  /** Адрес, которого нет в приложении: закрыт так же, как недоступный раздел. */
  return false;
}
