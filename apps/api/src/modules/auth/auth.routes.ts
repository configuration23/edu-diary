import {
  changePasswordRequestSchema,
  updateThemeRequestSchema,
  updateViewModeRequestSchema,
  loginRequestSchema,
  sessionResponseSchema,
  type SessionResponseDto,
  listSessionsResponseSchema,
  revokeOtherSessionsResponseSchema,
} from '@edu-diary/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { actorFromRequest, normalizeIp } from '../../shared/actor';
import type { AuthContext } from '../../shared/auth-context';
import { AppError } from '../../shared/errors';
import { authOf } from '../../shared/guards';
import {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MINUTES,
  type AuthService,
  type SessionMeta,
} from './auth.service';

function toSessionDto(context: AuthContext): SessionResponseDto {
  return sessionResponseSchema.parse({
    user: {
      id: context.userId,
      username: context.username,
      fullName: context.fullName,
      email: context.email,
      phone: context.phone,
      isActive: context.isActive,
      mustChangePassword: context.mustChangePassword,
      theme: context.theme,
      viewMode: context.viewMode,
      roles: context.roles,
    },
    permissions: [...context.permissions].map(([permission, scope]) => ({ permission, scope })),
  });
}

/**
 * `Secure` выставляется по фактической схеме запроса: за Caddy по HTTPS — да,
 * на стенде по HTTP — нет, иначе браузер просто не отправит cookie.
 */
function cookieOptions(request: FastifyRequest, maxAgeSeconds: number) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    /**
     * `Secure` включается и тогда, когда TLS снимается раньше приложения (роутер, внешний прокси):
     * в этом случае `request.protocol` всегда `http`, и флаг иначе не появится никогда.
     */
    secure: request.protocol === 'https' || process.env.COOKIE_SECURE === 'true',
    maxAge: maxAgeSeconds,
  };
}

function sessionMeta(request: FastifyRequest): SessionMeta {
  const userAgent = request.headers['user-agent'];
  return {
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 400) : null,
    ip: normalizeIp(request.ip),
  };
}

function sessionToken(request: FastifyRequest): string {
  const token = request.cookies[SESSION_COOKIE_NAME];
  return typeof token === 'string' ? token : '';
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  app.post('/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginRequestSchema.parse(request.body);

    const result = await auth.login({
      username: body.username,
      password: body.password,
      meta: sessionMeta(request),
    });

    /**
     * Срок cookie — по абсолютному пределу: сервер всё равно закроет сессию по простою, а браузер
     * не должен терять cookie раньше, чем истечёт жёсткий срок.
     */
    const maxAgeSeconds = Math.max(
      60,
      Math.floor((result.absoluteExpiresAt.getTime() - Date.now()) / 1000),
    );

    reply.setCookie(SESSION_COOKIE_NAME, result.token, cookieOptions(request, maxAgeSeconds));

    return toSessionDto(result.auth);
  });

  app.post('/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth !== null) {
      await auth.logout(sessionToken(request), actorFromRequest(request));
    }

    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions(request, 0));
    return { ok: true };
  });

  app.get('/auth/me', async (request: FastifyRequest) => {
    if (request.auth === null) {
      throw new AppError('UNAUTHORIZED', 'Требуется вход в систему');
    }

    return toSessionDto(request.auth);
  });

  /** Тема оформления: личная настройка, применяется при следующей загрузке сессии. */
  app.put('/auth/theme', async (request: FastifyRequest) => {
    const context = authOf(request);
    const body = updateThemeRequestSchema.parse(request.body);

    await auth.changeTheme(context.userId, body.theme);

    return { ok: true };
  });

  /** Вид страниц: компактно (спойлеры) или развёрнуто (блоки подряд). */
  app.put('/auth/view-mode', async (request: FastifyRequest) => {
    const context = authOf(request);
    const body = updateViewModeRequestSchema.parse(request.body);

    await auth.changeViewMode(context.userId, body.viewMode);

    return { ok: true };
  });

  /**
   * Свои устройства и входы.
   *
   * Человеку нужно видеть, откуда он вошёл, и уметь закрыть лишнее — это и есть управление
   * сессиями без администратора.
   */
  app.get('/auth/sessions', async (request: FastifyRequest) => {
    const context = authOf(request);

    const items = await auth.listSessions(context.userId, context.sessionId);

    return listSessionsResponseSchema.parse({ items, idleMinutes: SESSION_IDLE_MINUTES });
  });

  /** Завершить выбранную свою сессию. */
  app.delete('/auth/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const context = authOf(request);
    const { id } = request.params as { id: string };

    await auth.revokeSession(context.userId, id, actorFromRequest(request));

    reply.status(204);
    return null;
  });

  /** Завершить все сессии, кроме текущей. */
  app.delete('/auth/sessions', async (request: FastifyRequest) => {
    const context = authOf(request);
    const removed = await auth.revokeOtherSessions(
      context.userId,
      context.sessionId,
      actorFromRequest(request),
    );

    return revokeOtherSessionsResponseSchema.parse({ removed });
  });

  app.post('/auth/change-password', async (request: FastifyRequest) => {
    const context = authOf(request);
    const body = changePasswordRequestSchema.parse(request.body);

    await auth.changePassword(
      {
        userId: context.userId,
        sessionId: context.sessionId,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      },
      actorFromRequest(request),
    );

    return { ok: true };
  });
}
