import { useRevokeOtherSessions, useRevokeSession, useSessions } from '../lib/queries';
import { Alert, Badge, Button, EmptyState, formatDateTime } from './ui';
import { Section } from './layout';
import { errorMessage } from '../lib/api-client';

/**
 * Устройства и входы.
 *
 * Человек видит, откуда вошёл, и может закрыть лишнее. Это заменяет администратора: «уволился,
 * потерял телефон» решается без смены пароля.
 *
 * Данные о сессиях уже хранились (`ip`, `userAgent`, `last_seen_at`) — раньше их некому было
 * показать.
 */
export function SessionsCard() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const items = sessions.data?.items ?? [];
  const idleMinutes = sessions.data?.idleMinutes;
  const current = items.find((item) => item.current);

  /** Подсказка о сроках: числа приходят с сервера, чтобы текст не разошёлся с поведением. */
  const hint =
    idleMinutes === undefined
      ? 'Сессия завершается после бездействия.'
      : `Сессия завершается после ${idleMinutes} минут бездействия.${
          current === undefined
            ? ''
            : ` Текущая сессия закроется не позже ${formatDateTime(current.absoluteExpiresAt)} — этот срок активность не продлевает.`
        }`;

  return (
    <Section title="Устройства и входы" description={hint}>
      {sessions.isLoading && <EmptyState>Загружаем…</EmptyState>}
      {sessions.isError && <Alert tone="error">{errorMessage(sessions.error)}</Alert>}

      {sessions.data !== undefined && items.length === 0 && (
        <EmptyState>Активных сессий нет.</EmptyState>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 border-b border-border py-2 last:border-0"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.device}</span>
                  {item.current && <Badge tone="success">это устройство</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {item.ip ?? 'адрес неизвестен'} · последняя активность{' '}
                  {formatDateTime(item.lastSeenAt)}
                </span>
              </span>

              <Button
                tone="ghost"
                disabled={revoke.isPending}
                onClick={() => void revoke.mutateAsync(item.id).catch(() => undefined)}
              >
                Завершить
              </Button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            Завершение других сессий оставит вас в системе здесь.
          </span>
          <Button
            tone="secondary"
            disabled={revokeOthers.isPending}
            onClick={() => void revokeOthers.mutateAsync().catch(() => undefined)}
          >
            {revokeOthers.isPending ? 'Завершаем…' : 'Завершить все другие'}
          </Button>
        </div>
      )}

      {revoke.isError && <Alert tone="error">{errorMessage(revoke.error)}</Alert>}
      {revokeOthers.isError && <Alert tone="error">{errorMessage(revokeOthers.error)}</Alert>}
      {revokeOthers.isSuccess && (
        <Alert tone="success">
          {revokeOthers.data.removed === 0
            ? 'Других активных сессий не было.'
            : `Завершено сессий: ${revokeOthers.data.removed}.`}
        </Alert>
      )}
    </Section>
  );
}
