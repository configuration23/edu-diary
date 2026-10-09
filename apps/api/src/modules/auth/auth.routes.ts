import {
  changePasswordRequestSchema,
  loginRequestSchema,
  sessionResponseSchema,
  type SessionResponseDto,
} from '@edu-diary/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { actorFromRequest, normalizeIp } from '../../shared/actor';
import type { AuthContext } from '../../shared/auth-context';
import { AppError } from '../../shared/errors';
import { authOf } from '../../shared/guards';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_HOURS,
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
    secure: request.protocol === 'https',
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

    reply.setCookie(
      SESSION_COOKIE_NAME,
      result.token,
      cookieOptions(request, SESSION_TTL_HOURS * 3600),
    );

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
