/**
 * Права и область действия (ARCHITECTURE.md §8).
 *
 * Право — строка `resource:action` (`grades:write`, `users:manage`, …).
 * Область действия (scope) ограничивает выборку: `own` — только своё,
 * `group` — своя группа, `assigned` — свои назначения (может охватывать
 * несколько групп), `all` — всё.
 *
 * Области образуют лестницу `own ⊂ group ⊂ assigned ⊂ all`: она нужна, чтобы
 * одним сравнением отвечать на вопрос «покрывает ли выданная область требуемую».
 * Инварианты приватности (ADR-005) обеспечиваются фильтрацией в репозиториях,
 * а не этой лестницей.
 */

export const ACCESS_SCOPES = ['own', 'group', 'assigned', 'all'] as const;

export type AccessScope = (typeof ACCESS_SCOPES)[number];

const SCOPE_LEVEL: Readonly<Record<AccessScope, number>> = {
  own: 1,
  group: 2,
  assigned: 3,
  all: 4,
};

const PERMISSION_PATTERN = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;

export function isAccessScope(value: unknown): value is AccessScope {
  return typeof value === 'string' && (ACCESS_SCOPES as readonly string[]).includes(value);
}

export function isPermissionCode(value: unknown): value is string {
  return typeof value === 'string' && PERMISSION_PATTERN.test(value);
}

/** Покрывает ли выданная область требуемую. */
export function scopeCovers(granted: AccessScope, required: AccessScope): boolean {
  return SCOPE_LEVEL[granted] >= SCOPE_LEVEL[required];
}

export interface PermissionGrant {
  permission: string;
  scope: AccessScope;
}

/** Сводит выданные права в карту «право → максимальная область». */
export function mergePermissions(
  grants: Iterable<PermissionGrant>,
): ReadonlyMap<string, AccessScope> {
  const merged = new Map<string, AccessScope>();

  for (const grant of grants) {
    const current = merged.get(grant.permission);
    if (current === undefined || SCOPE_LEVEL[grant.scope] > SCOPE_LEVEL[current]) {
      merged.set(grant.permission, grant.scope);
    }
  }

  return merged;
}

/** Есть ли право с достаточной областью действия. */
export function hasPermission(
  permissions: ReadonlyMap<string, AccessScope>,
  permission: string,
  required: AccessScope = 'own',
): boolean {
  const granted = permissions.get(permission);
  return granted !== undefined && scopeCovers(granted, required);
}
