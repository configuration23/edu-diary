import { useState } from 'react';

import { errorMessage } from '../lib/api-client';
import { useAcknowledgeEvent, useSecurityEvents } from '../lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Table,
  TextInput,
  formatDateTime,
} from '../components/ui';

const SEVERITY_TONES = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
} as const;

export function SecurityScreen() {
  const [acknowledged, setAcknowledged] = useState<'all' | 'pending' | 'done'>('pending');
  const [resolution, setResolution] = useState('');

  const events = useSecurityEvents({
    ...(acknowledged === 'pending' ? { acknowledged: false } : {}),
    ...(acknowledged === 'done' ? { acknowledged: true } : {}),
  });
  const acknowledge = useAcknowledgeEvent();

  return (
    <Card
      title="Безопасность"
      description="События, требующие внимания: всплеск неудачных входов, блокировки, изменение прав, доступ вне области действия."
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-700">Показать</span>
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={acknowledged}
            onChange={(event) => setAcknowledged(event.target.value as typeof acknowledged)}
          >
            <option value="pending">Неразобранные</option>
            <option value="done">Разобранные</option>
            <option value="all">Все</option>
          </select>
        </label>
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-slate-700">Комментарий к разбору</span>
          <TextInput
            value={resolution}
            placeholder="Что сделано по событию"
            onChange={(event) => setResolution(event.target.value)}
          />
        </label>
      </div>

      {events.isLoading && <EmptyState>Загружаем…</EmptyState>}
      {events.isError && <Alert tone="error">{errorMessage(events.error)}</Alert>}
      {events.data !== undefined && events.data.items.length === 0 && (
        <EmptyState>Событий нет</EmptyState>
      )}

      {events.data !== undefined && events.data.items.length > 0 && (
        <Table head={['Когда', 'Тип', 'Важность', 'Кто', 'Подробности', '']}>
          {events.data.items.map((event) => (
            <tr key={event.id} className="border-b border-slate-100 align-top">
              <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                {formatDateTime(event.detectedAt)}
              </td>
              <td className="px-3 py-2 font-medium">{event.kind}</td>
              <td className="px-3 py-2">
                <Badge
                  tone={SEVERITY_TONES[event.severity as keyof typeof SEVERITY_TONES] ?? 'neutral'}
                >
                  {event.severity}
                </Badge>
              </td>
              <td className="px-3 py-2">
                {event.actorName ?? 'система'}
                {event.ip !== null && (
                  <span className="block text-xs text-slate-400">{event.ip}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {event.details === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <pre className="max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                )}
                {event.resolution !== null && (
                  <p className="mt-1 text-xs text-slate-500">Разбор: {event.resolution}</p>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {event.acknowledgedAt === null && (
                  <Button
                    tone="secondary"
                    disabled={acknowledge.isPending}
                    onClick={() =>
                      void acknowledge.mutateAsync({
                        eventId: event.id,
                        ...(resolution.trim() === '' ? {} : { resolution: resolution.trim() }),
                      })
                    }
                  >
                    Разобрано
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {acknowledge.isError && <Alert tone="error">{errorMessage(acknowledge.error)}</Alert>}
    </Card>
  );
}
