import type { SessionResponseDto } from '@edu-diary/contracts';
import { describe, expect, it } from 'vitest';

import { NAVIGATION, canOpenRoute, has, hasScope, isSystemAdmin } from '../src/lib/access';

/**
 * Правила доступа — **в одном месте** (`lib/access`), и их читают двое: меню и гейт маршрута.
 *
 * Здесь закреплено то, что уже один раз разъехалось: профиль **убран из меню**, и гейт, который
 * берёт правила из того же списка, стал считать адрес неизвестным. Человек нажимал на своё имя в
 * шапке и попадал на «Страница не найдена».
 */

function sessionOf(
  permissions: SessionResponseDto['permissions'],
  roles: SessionResponseDto['user']['roles'] = [],
): SessionResponseDto {
  return {
    user: {
      id: 'u-1',
      username: 'user',
      fullName: 'Пользователь Тестовый',
      email: null,
      phone: null,
      isActive: true,
      mustChangePassword: false,
      roles,
    },
    permissions,
  };
}

const ADMIN = sessionOf(
  [
    { permission: 'settings:write', scope: 'all' },
    { permission: 'users:read', scope: 'all' },
  ],
  [{ code: 'admin', title: 'Администратор' }],
);

const TEACHER = sessionOf(
  [
    { permission: 'grades:write', scope: 'assigned' },
    { permission: 'homework:read', scope: 'assigned' },
  ],
  [{ code: 'teacher', title: 'Преподаватель' }],
);

const STUDENT = sessionOf(
  [
    { permission: 'homework:read', scope: 'own' },
    { permission: 'lessons:read', scope: 'own' },
  ],
  [{ code: 'student', title: 'Ученик' }],
);

describe('правила доступа', () => {
  it('профиль доступен каждому вошедшему, хотя пункта в меню нет', () => {
    /**
     * Дефект, найденный владельцем: пункт убран из меню, а правило для гейта убралось вместе с
     * ним. Адрес стал «неизвестным», и своя же страница отвечала «Страница не найдена».
     */
    expect(NAVIGATION.some((item) => item.to === '/profile')).toBe(false);
    expect(canOpenRoute(ADMIN, '/profile')).toBe(true);
    expect(canOpenRoute(TEACHER, '/profile')).toBe(true);
    expect(canOpenRoute(STUDENT, '/profile')).toBe(true);
  });

  it('неизвестный адрес закрыт так же, как недоступный раздел', () => {
    // Разные ответы рассказывали бы, какие разделы существуют.
    expect(canOpenRoute(ADMIN, '/nesushchestvuyushchiy')).toBe(false);
    expect(canOpenRoute(STUDENT, '/users')).toBe(false);
  });

  it('область важнее наличия права', () => {
    /**
     * У ученика есть `homework:read`, но с областью `own`: «Мои задания» ему положены, а
     * «Сданные работы» — нет. Проверка по одному наличию права пропустила бы его в чужой раздел.
     */
    expect(has(STUDENT, 'homework:read')).toBe(true);
    expect(hasScope(STUDENT, 'homework:read', ['own'])).toBe(true);
    expect(hasScope(STUDENT, 'homework:read', ['assigned', 'all'])).toBe(false);
    expect(canOpenRoute(STUDENT, '/submitted')).toBe(false);
    expect(canOpenRoute(TEACHER, '/submitted')).toBe(true);
  });

  it('системный администратор — по праву, а не по коду роли', () => {
    /**
     * Разделение нужно для будущей роли **директора**: он настраивает заведение, но технические
     * сведения ему не нужны. Проверяем право, потому что право можно переназначить, и проверка по
     * коду роли разошлась бы с ним молча.
     */
    expect(isSystemAdmin(ADMIN)).toBe(true);
    expect(isSystemAdmin(TEACHER)).toBe(false);

    /** Роль с тем же правом, но суженной областью — уже не системный администратор. */
    const narrow = sessionOf(
      [{ permission: 'settings:write', scope: 'group' }],
      [{ code: 'admin', title: 'Администратор' }],
    );
    expect(isSystemAdmin(narrow)).toBe(false);
  });
});
