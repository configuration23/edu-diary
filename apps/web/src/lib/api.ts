import { healthResponseSchema, type HealthResponse } from '@edu-diary/contracts';

/**
 * Состояние связи с сервером.
 *
 * Ответ проверяется той же Zod-схемой, что и на сервере (`packages/contracts`),
 * поэтому расхождение контракта видно сразу, а не превращается в ошибку
 * отображения.
 */
export type HealthState =
  | { kind: 'loading' }
  | { kind: 'ready'; health: HealthResponse }
  | { kind: 'unreachable'; message: string };

export async function fetchHealth(signal?: AbortSignal): Promise<HealthState> {
  let response: Response;

  try {
    response = await fetch('/api/health', {
      headers: { accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    return {
      kind: 'unreachable',
      message: error instanceof Error ? error.message : 'сеть недоступна',
    };
  }

  const payload: unknown = await response.json().catch(() => null);
  const parsed = healthResponseSchema.safeParse(payload);

  if (parsed.success) {
    // 503 от сервера тоже содержит корректный контракт: показываем состояние как есть.
    return { kind: 'ready', health: parsed.data };
  }

  return {
    kind: 'unreachable',
    message: `сервер ответил ${response.status}, ответ не соответствует контракту`,
  };
}
