import { healthResponseSchema, type HealthResponse } from '@edu-diary/contracts';

import type { Database } from '../../shared/db/client';
import { readMigrationsState } from '../../shared/db/migrations-state';
import type { SettingsService } from '../settings';

/**
 * Сборка ответа `/api/health`: процесс, БД, состояние миграций, признак
 * пройденного мастера настройки.
 *
 * Правила кода ответа: БД недоступна → 503; БД доступна → 200, а отклонения
 * (неприменённые миграции) видны в поле `status: 'degraded'`.
 */

export interface HealthDependencies {
  db: Database;
  settings: SettingsService;
  version: string;
  startedAt: Date;
}

export interface HealthReport {
  httpStatus: number;
  body: HealthResponse;
}

export async function collectHealth(
  dependencies: HealthDependencies,
  now: Date = new Date(),
): Promise<HealthReport> {
  const { db, settings, version, startedAt } = dependencies;

  const ping = await db.ping({ timeoutMs: 2000 });

  const migrations = ping.ok
    ? await readMigrationsState(db)
    : ({ status: 'unknown', applied: 0, pending: 0 } as const);

  let initialized: boolean | null = null;
  if (ping.ok && migrations.status !== 'unknown') {
    try {
      initialized = await settings.isInitialized();
    } catch {
      initialized = null;
    }
  }

  const healthy = ping.ok && migrations.status !== 'pending';

  const body = healthResponseSchema.parse({
    status: healthy ? 'ok' : 'degraded',
    version,
    startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000)),
    checks: {
      database: {
        status: ping.ok ? 'ok' : 'error',
        latencyMs: ping.latencyMs,
        ...(ping.message === undefined ? {} : { message: ping.message }),
      },
      migrations,
    },
    setup: { initialized },
  } satisfies HealthResponse);

  return { httpStatus: ping.ok ? 200 : 503, body };
}
