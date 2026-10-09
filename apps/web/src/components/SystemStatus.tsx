import type { HealthResponse } from '@edu-diary/contracts';

import type { HealthState } from '../lib/api';

const STATUS_LABELS: Record<HealthResponse['status'], string> = {
  ok: 'Сервер и база данных доступны',
  degraded: 'Сервер работает с ограничениями',
};

const DATABASE_LABELS: Record<HealthResponse['checks']['database']['status'], string> = {
  ok: 'подключение есть',
  error: 'нет подключения',
};

const MIGRATIONS_LABELS: Record<HealthResponse['checks']['migrations']['status'], string> = {
  ok: 'применены',
  pending: 'не применены',
  unknown: 'состояние неизвестно',
};

function Row({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-200 py-2 last:border-b-0">
      <dt className="text-slate-500">{title}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

export function SystemStatus({ state }: { state: HealthState }) {
  if (state.kind === 'loading') {
    return (
      <section
        data-testid="health-status"
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <p className="text-slate-600">Проверяем состояние системы…</p>
      </section>
    );
  }

  if (state.kind === 'unreachable') {
    return (
      <section
        data-testid="health-status"
        className="rounded-lg border border-red-300 bg-red-50 p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-red-800">Нет связи с сервером</h2>
        <p className="mt-1 text-sm text-red-700">{state.message}</p>
      </section>
    );
  }

  const { health } = state;
  const database = health.checks.database;
  const migrations = health.checks.migrations;

  return (
    <section
      data-testid="health-status"
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold">{STATUS_LABELS[health.status]}</h2>
      <p className="mt-1 text-sm text-slate-500">Версия API: {health.version}</p>

      <dl className="mt-4 text-sm">
        <Row
          title="База данных"
          value={`${DATABASE_LABELS[database.status]}${
            database.latencyMs === null ? '' : `, ${database.latencyMs} мс`
          }`}
        />
        <Row
          title="Миграции"
          value={`${MIGRATIONS_LABELS[migrations.status]} (применено: ${migrations.applied}, ожидает: ${migrations.pending})`}
        />
        <Row
          title="Первичная настройка"
          value={
            health.setup.initialized === null
              ? 'состояние неизвестно'
              : health.setup.initialized
                ? 'пройдена'
                : 'не пройдена'
          }
        />
        <Row title="Время работы API" value={`${health.uptimeSeconds} с`} />
      </dl>
    </section>
  );
}
