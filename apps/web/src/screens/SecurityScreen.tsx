import { useState } from 'react';

import { errorMessage } from '../lib/api-client';
import { useAcknowledgeEvent, useSecurityEvents } from '../lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Segmented,
  Table,
  TextInput,
  formatDateTime,
} from '../components/ui';

const SEVERITY_TONES = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
} as const;

export function SecurityScreen({ heading = true }: { heading?: boolean } = {}) {
  const [acknowledged, setAcknowledged] = useState<'all' | 'pending' | 'done'>('pending');
  const [resolution, setResolution] = useState('');

  const events = useSecurityEvents({
    ...(acknowledged === 'pending' ? { acknowledged: false } : {}),
    ...(acknowledged === 'done' ? { acknowledged: true } : {}),
  });
  const acknowledge = useAcknowledgeEvent();

  return (
    <Card
      title={heading ? 'Безопасность' : undefined}
      description={
        heading
          ? 'События, требующие внимания: всплеск неудачных входов, блокировки, изменение прав, доступ вне области действия.'
          : undefined
      }
    >
      {/*
        Выбор из трёх состояний — переключатель, а не выпадающий список: варианты короткие и
        постоянные, и человеку полезно видеть их все сразу. `Segmented` заодно перестал быть
        «чёрной кнопкой», которая спорила с главным действием.
      */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="pb-2">
          <Segmented
            label="Показать события"
            value={acknowledged}
            onChange={(next) => setAcknowledged(next)}
            options={[
              { value: 'pending', label: 'Неразобранные' },
              { value: 'done', label: 'Разобранные' },
              { value: 'all', label: 'Все' },
            ]}
          />
        </div>
        <Field label="Комментарий к разбору" className="flex-1">
          <TextInput
            value={resolution}
            placeholder="Что сделано по событию"
            onChange={(event) => setResolution(event.target.value)}
          />
        </Field>
      </div>

      {events.isLoading && <EmptyState>Загружаем…</EmptyState>}
      {events.isError && <Alert tone="error">{errorMessage(events.error)}</Alert>}
      {events.data !== undefined && events.data.items.length === 0 && (
        <EmptyState>Событий нет</EmptyState>
      )}

      {events.data !== undefined && events.data.items.length > 0 && (
        <Table head={['Когда', 'Тип', 'Важность', 'Кто', 'Подробности', '']}>
          {events.data.items.map((event) => (
            <tr key={event.id} className="border-b border-border align-top">
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
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
                  <span className="block text-xs text-subtle-foreground">{event.ip}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {event.details === null ? (
                  <span className="text-subtle-foreground">—</span>
                ) : (
                  <pre className="max-w-md overflow-x-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                )}
                {event.resolution !== null && (
                  <p className="mt-1 text-xs text-muted-foreground">Разбор: {event.resolution}</p>
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
