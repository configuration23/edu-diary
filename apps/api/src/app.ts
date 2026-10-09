import Fastify, { type FastifyInstance } from 'fastify';

import { createHealthModule } from './modules/health';
import { createSettingsRepository, createSettingsService } from './modules/settings';
import type { Database } from './shared/db/client';
import type { AppEnv } from './shared/env';
import { registerErrorHandling } from './shared/errors';
import { createLoggerOptions, resolveRequestId } from './shared/logger';
import { applicationVersion } from './shared/paths';

/**
 * Сборка приложения: инфраструктура → модули.
 *
 * Модули получают зависимости явно, поэтому приложение целиком поднимается в
 * тестах без сети и без глобального состояния.
 */

export interface BuildAppOptions {
  env: AppEnv;
  db: Database;
  version?: string;
}

export async function buildApp({ env, db, version }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: createLoggerOptions(env),
    genReqId: (request) => resolveRequestId(request.headers['x-request-id']),
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  registerErrorHandling(app);

  const settings = createSettingsService(createSettingsRepository(db));

  await app.register(
    createHealthModule({ db, settings, version: version ?? applicationVersion() }),
    {
      prefix: '/api',
    },
  );

  return app;
}
