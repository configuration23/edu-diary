import { hasPermission } from '@edu-diary/domain';
import type { AccessScope } from '@edu-diary/domain';

/**
 * Контекст запроса: кто выполняет действие и что ему разрешено.
 *
 * Заполняется хуком в `app.ts` по cookie-сессии. Модули не проверяют сессию
 * сами — они используют `requireAuth`/`requirePermission` из `shared/guards`.
 */
export interface AuthRole {
  code: string;
  title: string;
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  /** Пароль выдан администратором и требует смены при первом входе. */
  mustChangePassword: boolean;
  /** Роли пользователя. */
  roles: readonly AuthRole[];
  /** Свод прав: `право → максимальная область действия`. */
  permissions: ReadonlyMap<string, AccessScope>;
}

export function authHasPermission(
  auth: AuthContext,
  permission: string,
  scope: AccessScope = 'own',
): boolean {
  return hasPermission(auth.permissions, permission, scope);
}
