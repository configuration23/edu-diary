import { errorResponseSchema } from '@edu-diary/contracts';
import type { z } from 'zod';

/**
 * Клиент API.
 *
 * Ответы проверяются теми же Zod-схемами, что и на сервере
 * (`packages/contracts`), поэтому расхождение контракта видно сразу.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(input: { code: string; message: string; status: number; details?: unknown }) {
    super(input.message);
    this.name = 'ApiError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request(url: string, options: RequestOptions = {}): Promise<unknown> {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    credentials: 'same-origin',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  if (response.status === 204) return null;

  const text = await response.text();
  const payload: unknown = text === '' ? null : safeJson(text);

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(payload);
    throw new ApiError({
      code: parsed.success ? parsed.data.error.code : 'NETWORK_ERROR',
      message: parsed.success ? parsed.data.error.message : `Сервер ответил ${response.status}`,
      status: response.status,
      details: parsed.success ? parsed.data.error.details : undefined,
    });
  }

  return payload;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Запрос с проверкой ответа схемой. */
export async function apiRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const payload = await request(url, options);
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError({
      code: 'CONTRACT_MISMATCH',
      message: 'Ответ сервера не соответствует контракту',
      status: 0,
      details: parsed.error.issues,
    });
  }

  return parsed.data;
}

/** Запрос без разбора тела: ответ `{ ok: true }` или пустой. */
export async function apiSend(url: string, options: RequestOptions = {}): Promise<void> {
  await request(url, options);
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Неизвестная ошибка';
}
