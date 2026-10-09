import { describe, expect, it } from 'vitest';

import { errorResponseSchema } from '../src/error';
import { healthResponseSchema } from '../src/health';

describe('errorResponseSchema', () => {
  it('принимает контракт целиком', () => {
    const parsed = errorResponseSchema.safeParse({
      error: { code: 'NOT_FOUND', message: 'Не найдено', details: { id: 'x' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('требует известный код', () => {
    expect(errorResponseSchema.safeParse({ error: { code: 'OOPS', message: 'x' } }).success).toBe(
      false,
    );
  });

  it('не принимает лишнюю обёртку', () => {
    expect(errorResponseSchema.safeParse({ code: 'NOT_FOUND', message: 'x' }).success).toBe(false);
  });
});

describe('healthResponseSchema', () => {
  it('принимает полный ответ', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      startedAt: '2025-01-15T10:00:00.000Z',
      uptimeSeconds: 12.5,
      checks: {
        database: { status: 'ok', latencyMs: 3 },
        migrations: { status: 'ok', applied: 1, pending: 0 },
      },
      setup: { initialized: false },
    });
    expect(parsed.success).toBe(true);
  });

  it('допускает неизвестное состояние настройки', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'degraded',
      version: '0.1.0',
      startedAt: '2025-01-15T10:00:00.000Z',
      uptimeSeconds: 0,
      checks: {
        database: { status: 'error', latencyMs: null, message: 'нет связи' },
        migrations: { status: 'unknown', applied: 0, pending: 0 },
      },
      setup: { initialized: null },
    });
    expect(parsed.success).toBe(true);
  });

  it('требует неотрицательный счётчик миграций', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      startedAt: '2025-01-15T10:00:00.000Z',
      uptimeSeconds: 0,
      checks: {
        database: { status: 'ok', latencyMs: 1 },
        migrations: { status: 'ok', applied: -1, pending: 0 },
      },
      setup: { initialized: false },
    });
    expect(parsed.success).toBe(false);
  });
});
