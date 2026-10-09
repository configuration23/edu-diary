import type { HealthResponse } from '@edu-diary/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SystemStatus } from '../src/components/SystemStatus';

const healthyResponse: HealthResponse = {
  status: 'ok',
  version: '0.1.0',
  startedAt: '2025-01-15T10:00:00.000Z',
  uptimeSeconds: 42,
  checks: {
    database: { status: 'ok', latencyMs: 4 },
    migrations: { status: 'ok', applied: 1, pending: 0 },
  },
  setup: { initialized: false },
};

describe('SystemStatus', () => {
  it('показывает состояние загрузки', () => {
    const html = renderToStaticMarkup(<SystemStatus state={{ kind: 'loading' }} />);
    expect(html).toContain('Проверяем состояние системы');
  });

  it('показывает доступный сервер и базу данных', () => {
    const html = renderToStaticMarkup(
      <SystemStatus state={{ kind: 'ready', health: healthyResponse }} />,
    );

    expect(html).toContain('Сервер и база данных доступны');
    expect(html).toContain('подключение есть, 4 мс');
    expect(html).toContain('применены (применено: 1, ожидает: 0)');
    expect(html).toContain('не пройдена');
    expect(html).toContain('data-testid="health-status"');
  });

  it('объясняет недоступность сервера', () => {
    const html = renderToStaticMarkup(
      <SystemStatus state={{ kind: 'unreachable', message: 'сервер ответил 502' }} />,
    );

    expect(html).toContain('Нет связи с сервером');
    expect(html).toContain('сервер ответил 502');
  });

  it('показывает деградацию без БД', () => {
    const html = renderToStaticMarkup(
      <SystemStatus
        state={{
          kind: 'ready',
          health: {
            ...healthyResponse,
            status: 'degraded',
            checks: {
              database: { status: 'error', latencyMs: null, message: 'ECONNREFUSED' },
              migrations: { status: 'unknown', applied: 0, pending: 0 },
            },
            setup: { initialized: null },
          },
        }}
      />,
    );

    expect(html).toContain('Сервер работает с ограничениями');
    expect(html).toContain('нет подключения');
    expect(html).toContain('состояние неизвестно');
  });
});
