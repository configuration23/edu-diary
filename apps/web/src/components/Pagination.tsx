import { useState } from 'react';

import { Button, EmptyState, Field } from './ui';

/**
 * Постраничный вывод длинных списков.
 *
 * Правило общее для всего приложения: администратор выбирает, сколько строк
 * показывать, и переключает страницы. Выбор размера хранится в браузере — иначе
 * его приходилось бы задавать заново при каждом переходе между разделами.
 *
 * Список сам считает страницы по `total` с сервера, поэтому нумерация не зависит
 * от того, сколько строк реально пришло в ответе.
 */

export const PAGE_SIZES = [5, 10, 20, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

const STORAGE_KEY = 'edu-diary.page-size';

/** Выбранный размер страницы: значение по умолчанию и сохранённое в браузере. */
export function usePageSize(defaultSize: PageSize = 10): [PageSize, (size: PageSize) => void] {
  const [size, setSize] = useState<PageSize>(() => {
    if (typeof window === 'undefined') return defaultSize;
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(stored) ? (stored as PageSize) : defaultSize;
  });

  return [
    size,
    (next: PageSize) => {
      setSize(next);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      }
    },
  ];
}

export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  /** Номер страницы с единицы: так его видит человек. */
  page: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
      <Field label="Строк на странице">
        <select
          name="pageSize"
          className="rounded-md border border-border px-3 py-2 text-sm"
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number(event.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={String(size)}>
              {size}
            </option>
          ))}
        </select>
      </Field>

      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            tone="secondary"
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            ← Назад
          </Button>
          <span className="text-sm text-muted-foreground">
            Страница {page} из {pages} · всего {total}
          </span>
          <Button
            tone="secondary"
            type="button"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            Вперёд →
          </Button>
        </div>
      )}

      {pages === 1 && total > 0 && (
        <span className="text-sm text-muted-foreground">Всего: {total}</span>
      )}
    </div>
  );
}

/**
 * Список со страницами и поиском: заголовок, поле поиска и сам список.
 *
 * Компонент не хранит данные — он принимает уже загруженную страницу и сообщает,
 * что делать при смене страницы, размера или поиска.
 */
export function PaginatedList<T>({
  items,
  total,
  page,
  pageSize,
  search,
  onSearchChange,
  onPageChange,
  onPageSizeChange,
  searchPlaceholder,
  emptyText,
  children,
}: {
  items: T[];
  total: number;
  page: number;
  pageSize: PageSize;
  search?: string;
  onSearchChange?: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  searchPlaceholder?: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      {onSearchChange !== undefined && (
        <div className="mb-3">
          <Field label="Поиск">
            <input
              name="search"
              className="w-full rounded-md border border-border px-3 py-2 text-sm sm:max-w-xs"
              placeholder={searchPlaceholder ?? 'Начните вводить'}
              value={search ?? ''}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </Field>
        </div>
      )}

      {items.length === 0 ? <EmptyState>{emptyText}</EmptyState> : children}

      {total > 0 && (
        <Pagination
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={(size) => {
            onPageSizeChange(size);
            onPageChange(1);
          }}
        />
      )}
    </div>
  );
}
