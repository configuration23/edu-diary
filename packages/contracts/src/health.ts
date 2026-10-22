import { z } from 'zod';

/**
 * Ответ `GET /api/health`: процесс, подключение к БД и состояние миграций
 * (ROADMAP.md, Этап 0).
 *
 * `status: 'ok'` — БД доступна и все миграции применены.
 * `status: 'degraded'` — процесс жив, но есть отклонения (обычно миграции не применены).
 * HTTP-код при этом 200, пока БД доступна; недоступная БД даёт 503.
 */
export const healthStatusSchema = z.enum(['ok', 'degraded']);

export const databaseCheckSchema = z.object({
  status: z.enum(['ok', 'error']),
  latencyMs: z.number().nonnegative().nullable(),
  message: z.string().optional(),
});

export const migrationsCheckSchema = z.object({
  status: z.enum(['ok', 'pending', 'unknown']),
  applied: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});

export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  /**
   * Технические подробности отдаются только вошедшим: версия, uptime и состояние миграций —
   * разведданные для атакующего (находка F-09). Снаружи виден лишь `status`.
   */
  version: z.string().optional(),
  startedAt: z.string().optional(),
  uptimeSeconds: z.number().nonnegative().optional(),
  checks: z
    .object({
      database: databaseCheckSchema,
      migrations: migrationsCheckSchema,
    })
    .optional(),
  setup: z
    .object({
      /** null — состояние неизвестно (БД недоступна или миграции не применены). */
      initialized: z.boolean().nullable(),
    })
    .optional(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
export type DatabaseCheck = z.infer<typeof databaseCheckSchema>;
export type MigrationsCheck = z.infer<typeof migrationsCheckSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
