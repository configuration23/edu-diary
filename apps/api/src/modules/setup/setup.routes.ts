import {
  setupCompleteRequestSchema,
  setupCompleteResponseSchema,
  setupStatusResponseSchema,
  type SetupCompleteResponseDto,
} from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { normalizeIp } from '../../shared/actor';
import type { AuthService } from '../auth';
import { SESSION_COOKIE_NAME, SESSION_TTL_HOURS } from '../auth';
import type { SetupService } from './setup.service';

/**
 * Маршруты мастера доступны до настройки системы: гейт `SETUP_REQUIRED` их
 * пропускает (см. `app.ts`).
 */
export function registerSetupRoutes(
  app: FastifyInstance,
  setup: SetupService,
  auth: AuthService,
): void {
  app.get('/setup/status', async () => setupStatusResponseSchema.parse(await setup.status()));

  app.post('/setup/complete', async (request, reply) => {
    const body = setupCompleteRequestSchema.parse(request.body);
    const userAgent = request.headers['user-agent'];

    const actor = {
      userId: null,
      name: `мастер настройки (${body.admin.username})`,
      ip: normalizeIp(request.ip),
    };

    const { adminUserId } = await setup.complete(body, actor);

    // Администратор сразу входит: мастер заканчивается рабочим входом.
    const session = await auth.createSessionFor(adminUserId, {
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 400) : null,
      ip: normalizeIp(request.ip),
    });

    reply.setCookie(SESSION_COOKIE_NAME, session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: request.protocol === 'https',
      maxAge: SESSION_TTL_HOURS * 3600,
    });

    const response: SetupCompleteResponseDto = setupCompleteResponseSchema.parse({
      initialized: true,
      session: {
        user: {
          id: session.auth.userId,
          username: session.auth.username,
          fullName: session.auth.fullName,
          email: session.auth.email,
          phone: session.auth.phone,
          isActive: session.auth.isActive,
          mustChangePassword: session.auth.mustChangePassword,
          roles: session.auth.roles,
        },
        permissions: [...session.auth.permissions].map(([permission, scope]) => ({
          permission,
          scope,
        })),
      },
    });

    reply.status(201);
    return response;
  });
}
