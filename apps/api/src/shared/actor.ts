import type { FastifyRequest } from 'fastify';

/** Кто выполняет действие: для журнала аудита и событий безопасности. */

export interface AuditActor {
  userId: string | null;
  /** Снимок имени: запись остаётся читаемой после переименования или деактивации. */
  name: string | null;
  ip: string | null;
}

/** Действие системного процесса (мастер настройки, регламентная команда). */
export const SYSTEM_ACTOR: AuditActor = { userId: null, name: 'system', ip: null };

const IP_PATTERN = /^[0-9a-fA-F.:]+$/;

/** Приводит адрес к виду, допустимому для колонки `inet`. */
export function normalizeIp(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || !IP_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function actorFromRequest(request: FastifyRequest): AuditActor {
  const auth = request.auth;
  return {
    userId: auth?.userId ?? null,
    name: auth?.fullName ?? null,
    ip: normalizeIp(request.ip),
  };
}
