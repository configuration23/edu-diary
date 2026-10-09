import { useEffect, useState } from 'react';

import { SystemStatus } from './components/SystemStatus';
import { fetchHealth, type HealthState } from './lib/api';

export function App() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetchHealth(controller.signal)
      .then(setState)
      .catch(() => {
        setState({ kind: 'unreachable', message: 'не удалось получить состояние системы' });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Электронный дневник</h1>
        <p className="mt-1 text-sm text-slate-500">
          Этап 0 — фундамент: каркас API, миграции, проверки качества и сборки.
        </p>
      </header>

      <SystemStatus state={state} />
    </main>
  );
}
