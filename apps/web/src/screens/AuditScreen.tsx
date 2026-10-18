import { useState } from 'react';

import { Pagination, usePageSize } from '../components/Pagination';
import { errorMessage } from '../lib/api-client';
import { useAudit } from '../lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Table,
  TextInput,
  formatDateTime,
} from '../components/ui';

const ACCESS_ACTIONS = new Set(['access', 'export']);

export function AuditScreen({ heading = true }: { heading?: boolean } = {}) {
  const [entityKind, setEntityKind] = useState('');
  const [action, setAction] = useState('');
  const [accessOnly, setAccessOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(20);

  /**
   * Журнал только растёт, поэтому без страниц он быстро превращается в
   * бесконечную ленту. Размер по умолчанию больше, чем в списках людей: записи
   * короткие, и разбирать их удобнее пачками.
   */
  const audit = useAudit({
    ...(entityKind === '' ? {} : { entityKind }),
    ...(action === '' ? {} : { action }),
    ...(accessOnly ? { accessOnly: true } : {}),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  /** Любой фильтр меняет выборку: возвращаемся на первую страницу. */
  const withReset = (apply: () => void): void => {
    apply();
    setPage(1);
  };

  return (
    <Card
      title={heading ? 'Журнал изменений и доступа' : undefined}
      description={
        heading
          ? 'Записи только добавляются: изменить или удалить их через API невозможно.'
          : undefined
      }
    >
      {/*
        Фильтры — на примитивах: `Field` даёт подпись и подсказку, `Checkbox` — нажимаемую подпись
        вместе с флажком. Раньше подпись была отдельным `<span>` рядом с `<label>`, и подпись с
        флажком не связывалась.
      */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Сущность">
          <TextInput
            placeholder="student, user, role…"
            value={entityKind}
            onChange={(event) => withReset(() => setEntityKind(event.target.value))}
            className="w-44"
          />
        </Field>
        <Field label="Действие">
          <TextInput
            placeholder="create, update, access…"
            value={action}
            onChange={(event) => withReset(() => setAction(event.target.value))}
            className="w-44"
          />
        </Field>
        <div className="pb-2">
          <Checkbox
            label="только доступ к персональным данным"
            checked={accessOnly}
            onChange={(event) => withReset(() => setAccessOnly(event.target.checked))}
          />
        </div>
        <Button
          tone="secondary"
          onClick={() =>
            withReset(() => {
              setEntityKind('');
              setAction('');
              setAccessOnly(false);
            })
          }
        >
          Сбросить
        </Button>
      </div>

      {audit.isLoading && <EmptyState>Загружаем…</EmptyState>}
      {audit.isError && <Alert tone="error">{errorMessage(audit.error)}</Alert>}
      {audit.data !== undefined && audit.data.items.length === 0 && (
        <EmptyState>Записей нет</EmptyState>
      )}

      {audit.data !== undefined && audit.data.items.length > 0 && (
        <Table head={['Когда', 'Кто', 'Действие', 'Сущность', 'Изменения']}>
          {audit.data.items.map((entry) => (
            <tr key={entry.id} className="border-b border-border align-top">
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {formatDateTime(entry.createdAt)}
              </td>
              <td className="px-3 py-2">
                {entry.actorName ?? 'система'}
                {entry.actorIp !== null && (
                  <span className="block text-xs text-subtle-foreground">{entry.actorIp}</span>
                )}
              </td>
              <td className="px-3 py-2">
                {entry.action}
                {entry.isAccess && (
                  <span className="ml-1">
                    <Badge tone="warning">доступ</Badge>
                  </span>
                )}
                {ACCESS_ACTIONS.has(entry.action) && !entry.isAccess && (
                  <span className="ml-1">
                    <Badge>чтение</Badge>
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {entry.entityKind}
                {entry.entityId !== null && (
                  <span className="block text-xs text-subtle-foreground">
                    {entry.entityId.slice(0, 8)}…
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {entry.before === null && entry.after === null && entry.context === null ? (
                  <span className="text-subtle-foreground">—</span>
                ) : (
                  <details>
                    <summary className="cursor-pointer text-primary hover:no-underline">
                      показать
                    </summary>
                    <pre className="mt-2 max-w-xl overflow-x-auto rounded bg-muted p-2 text-xs">
                      {JSON.stringify(
                        { before: entry.before, after: entry.after, context: entry.context },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {audit.data !== undefined && audit.data.total > 0 && (
        <Pagination
          total={audit.data.total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </Card>
  );
}
