import type { AccessScope } from '@edu-diary/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { authHasPermission, type AuthContext } from './auth-context';
import { AppError } from './errors';

/** Проверки доступа для маршрутов: одна строка вместо повторяемого кода. */

export function requireAuth(): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest): Promise<void> => {
    if (request.auth === null) {
      throw new AppError('UNAUTHORIZED', 'Требуется вход в систему');
    }
  };
}

export function requirePermission(
  permission: string,
  scope: AccessScope = 'own',
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest): Promise<void> => {
    const auth = request.auth;

    if (auth === null) {
      throw new AppError('UNAUTHORIZED', 'Требуется вход в систему');
    }

    if (!authHasPermission(auth, permission, scope)) {
      throw new AppError('FORBIDDEN', `Недостаточно прав: ${permission}`);
    }
  };
}

/** Контекст, гарантированно заполненный (после `requireAuth`). */
export function authOf(request: FastifyRequest): AuthContext {
  if (request.auth === null) {
    throw new AppError('UNAUTHORIZED', 'Требуется вход в систему');
  }
  return request.auth;
}
