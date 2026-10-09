import type { ErrorCode, ErrorResponse } from '@edu-diary/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Единый формат ошибок API: `{ error: { code, message, details? } }`
 * (ARCHITECTURE.md §10).
 */

const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  SETUP_REQUIRED: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Коды ошибок Fastify, у которых есть точное соответствие в нашем контракте. */
const FASTIFY_CODE_MAP: Readonly<Record<string, ErrorCode>> = {
  FST_ERR_VALIDATION: 'VALIDATION_FAILED',
  FST_ERR_CTP_BODY_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'VALIDATION_FAILED',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'VALIDATION_FAILED',
  FST_ERR_NOT_FOUND: 'NOT_FOUND',
  FST_ERR_BAD_URL: 'VALIDATION_FAILED',
};

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
}

/** Ошибка приложения: код из контракта, сообщение для человека, HTTP-статус. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = HTTP_STATUS_BY_CODE[code];
    this.details = options.details;
  }
}

function isFastifyValidationError(error: FastifyError): boolean {
  return Array.isArray(error.validation) && error.validation.length > 0;
}

/** Приводит любую ошибку к контрактному ответу; неизвестные ошибки не раскрывают деталей. */
export function toErrorResponse(error: unknown): { statusCode: number; body: ErrorResponse } {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }

  if (typeof error === 'object' && error !== null) {
    const fastifyError = error as FastifyError;
    const codeFromFastify =
      fastifyError.code === undefined ? undefined : FASTIFY_CODE_MAP[fastifyError.code];

    if (codeFromFastify !== undefined) {
      return {
        statusCode: HTTP_STATUS_BY_CODE[codeFromFastify],
        body: {
          error: {
            code: codeFromFastify,
            message:
              codeFromFastify === 'PAYLOAD_TOO_LARGE'
                ? 'Тело запроса слишком большое'
                : 'Запрос не прошёл проверку',
            ...(isFastifyValidationError(fastifyError) ? { details: fastifyError.validation } : {}),
          },
        },
      };
    }
  }

  return {
    statusCode: HTTP_STATUS_BY_CODE.INTERNAL_ERROR,
    body: {
      error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' },
    },
  };
}

/** Регистрирует обработчики ошибок и 404. Вызывается до регистрации модулей. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const path = request.url.split('?')[0] ?? request.url;
    reply.status(HTTP_STATUS_BY_CODE.NOT_FOUND).send({
      error: { code: 'NOT_FOUND', message: `Маршрут ${request.method} ${path} не найден` },
    } satisfies ErrorResponse);
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const { statusCode, body } = toErrorResponse(error);

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'необработанная ошибка запроса');
    }

    reply.status(statusCode).send(body);
  });
}
