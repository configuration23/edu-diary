import { describe, expect, it } from 'vitest';

import {
  hasPermission,
  isAccessScope,
  isPermissionCode,
  mergePermissions,
  scopeCovers,
  type AccessScope,
} from '../src/access';

describe('области действия', () => {
  it('распознаёт допустимые области', () => {
    for (const scope of ['own', 'group', 'assigned', 'all']) {
      expect(isAccessScope(scope)).toBe(true);
    }
    expect(isAccessScope('everyone')).toBe(false);
    expect(isAccessScope('')).toBe(false);
    expect(isAccessScope(null)).toBe(false);
  });

  it('строит лестницу own ⊂ group ⊂ assigned ⊂ all', () => {
    expect(scopeCovers('all', 'own')).toBe(true);
    expect(scopeCovers('assigned', 'group')).toBe(true);
    expect(scopeCovers('group', 'own')).toBe(true);
    expect(scopeCovers('group', 'assigned')).toBe(false);
    expect(scopeCovers('own', 'group')).toBe(false);
    expect(scopeCovers('own', 'own')).toBe(true);
  });
});

describe('коды прав', () => {
  it('требует формат resource:action', () => {
    expect(isPermissionCode('grades:write')).toBe(true);
    expect(isPermissionCode('users:manage')).toBe(true);
    expect(isPermissionCode('audit_log:read')).toBe(true);
    expect(isPermissionCode('grades')).toBe(false);
    expect(isPermissionCode('Grades:Write')).toBe(false);
    expect(isPermissionCode(':read')).toBe(false);
  });
});

describe('свод прав', () => {
  it('оставляет максимальную область для повторяющегося права', () => {
    const merged = mergePermissions([
      { permission: 'grades:read', scope: 'own' },
      { permission: 'grades:read', scope: 'assigned' },
      { permission: 'users:read', scope: 'all' },
    ]);

    expect(merged.get('grades:read')).toBe('assigned');
    expect(merged.get('users:read')).toBe('all');
    expect(merged.size).toBe(2);
  });

  it('проверяет право с нужной областью', () => {
    const permissions: ReadonlyMap<string, AccessScope> = mergePermissions([
      { permission: 'grades:read', scope: 'assigned' },
    ]);

    expect(hasPermission(permissions, 'grades:read')).toBe(true);
    expect(hasPermission(permissions, 'grades:read', 'assigned')).toBe(true);
    expect(hasPermission(permissions, 'grades:read', 'all')).toBe(false);
    expect(hasPermission(permissions, 'grades:write')).toBe(false);
  });

  it('не выдаёт право при пустом наборе', () => {
    expect(hasPermission(mergePermissions([]), 'users:read', 'all')).toBe(false);
  });
});
