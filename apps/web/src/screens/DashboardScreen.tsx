import type { SessionResponseDto } from '@edu-diary/contracts';
import { SystemStatus, type HealthState } from '../components/SystemStatus';
import { useHealth } from '../lib/queries';

/**
 * «Обзор» — состояние системы.
 *
 * **Страница сейчас пустая по решению владельца.** Всё, что на ней было, — смена пароля, «Ваш
 * доступ» и «О версии» — уехало в **профиль**: это данные учётной записи, а не обзор заведения.
 *
 * Здесь остаётся **только состояние системы**: доступен ли сервер, цела ли схема базы. Это не
 * «данные заведения», а признак того, что приложение работает, и его место — на первой странице:
 * при сбое человек должен видеть причину сразу, а не догадываться.
 *
 * Дальше страница станет **новостями заведения** — владелец подтвердил, что название пункта меню
 * **«Обзор» остаётся**, меняется содержимое.
 */

function healthState(query: ReturnType<typeof useHealth>): HealthState {
  if (query.isLoading) return { kind: 'loading' };
  if (query.isError || query.data === undefined) {
    return { kind: 'unreachable', message: 'сервер не ответил' };
  }

  return { kind: 'ready', health: query.data };
}

export function DashboardScreen(_props: { session: SessionResponseDto }) {
  const health = useHealth();

  return (
    <div className="flex flex-col gap-6">
      <SystemStatus state={healthState(health)} />
    </div>
  );
}
