import { randomUUID } from 'node:crypto';

import type { FastifyServerOptions } from 'fastify';

import type { AppEnv } from './env';

/**
 * Структурированные логи с идентификатором запроса (ROADMAP.md, Этап 0).
 *
 * Логи всегда JSON, кроме локальной разработки: `LOG_PRETTY=true` включает
 * читаемый вывод. В production pino-pretty не используется даже при флаге —
 * транспорт тянет лишнюю зависимость в рантайм.
 */
export function createLoggerOptions(env: AppEnv): FastifyServerOptions['logger'] {
  const options = {
    level: env.logLevel,
    base: { service: 'edu-diary-api', env: env.nodeEnv },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
  };

  if (env.logPretty && !env.isProduction) {
    return {
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service,env',
          singleLine: false,
        },
      },
    };
  }

  return options;
}

/**
 * Идентификатор запроса: значение из заголовка `x-request-id`, если оно
 * безопасно, иначе новый UUID. Заголовок приходит от клиента, поэтому
 * пропускаем только короткие символы `[A-Za-z0-9._-]`.
 */
export function resolveRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;

  if (typeof candidate === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(candidate)) {
    return candidate;
  }

  return randomUUID();
}
