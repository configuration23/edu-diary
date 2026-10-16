import type { ReactNode } from 'react';

import { Alert, Button } from './ui';

/**
 * Каркас страницы и примитивы компоновки (Этап 6, шаг 0).
 *
 * Зачем это отдельно от `ui.tsx`. `ui.tsx` — элементы управления: кнопка, поле, значок.
 * Здесь — **как страница собирается**: где заголовок, где действия, где фильтры, где
 * результат. Без этого каждый экран придумывал каркас сам: на «Оценках и посещении» выходило
 * **десять карточек подряд**, и человек не понимал, где фильтры, а где результат. Секций
 * (`<section>`) на всех экранах не было **ни одной**.
 *
 * Правило этапа: экран **не выбирает** отступы, размеры и порядок блоков — он берёт их отсюда.
 */

/**
 * Страница: единый ритм и ограничение ширины.
 *
 * `width` — «форма» для анкет и настроек (читаемая строка), «широкая» для таблиц и сеток
 * (расписание, журнал).
 */
export function Page({
  children,
  width = 'wide',
}: {
  children: ReactNode;
  width?: 'form' | 'wide';
}) {
  return (
    <div className="mx-auto flex w-full flex-col gap-6 px-4 py-6 sm:px-6">
      <div
        className={
          width === 'form' ? 'mx-auto flex w-full max-w-3xl flex-col gap-6' : 'flex flex-col gap-6'
        }
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Шапка страницы: заголовок, пояснение и **действия раздела**.
 *
 * Действия стоят рядом с заголовком, а не в глубине экрана: человек ищет «что здесь можно
 * сделать» рядом с названием раздела.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description !== undefined && (
          <p className="max-w-3xl text-sm text-slate-500">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Секция: **опорная точка** на экране.
 *
 * Заменяет собой безымянные карточки подряд. `tone="plain"` — без рамки, когда секция нужна
 * только для заголовка и группировки, а не как отдельная поверхность.
 */
export function Section({
  title,
  description,
  actions,
  children,
  tone = 'surface',
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  tone?: 'surface' | 'plain';
}) {
  const frame =
    tone === 'surface'
      ? 'rounded-lg border border-slate-200 bg-[var(--color-surface)] p-4 shadow-sm'
      : '';

  return (
    <section className={`flex flex-col gap-4 ${frame}`}>
      {(title !== undefined || actions !== undefined) && (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            {title !== undefined && (
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            )}
            {description !== undefined && (
              <p className="max-w-3xl text-sm text-slate-500">{description}</p>
            )}
          </div>
          {actions !== undefined && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Панель фильтров: **одно место** для выбора группы, предмета, даты, периода.
 *
 * Раньше это было пять разных решений на пяти экранах. Правило: фильтры всегда сверху, всегда
 * в одной строке с переносом, и рядом с ними — сброс.
 */
export function Toolbar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-[var(--color-surface)] p-4 shadow-sm">
      {children}
      {actions !== undefined && (
        <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/**
 * Строка «кто × значение».
 *
 * Журнал, «Оценки», «Сданные работы» — везде нужен один и тот же вертикальный список учеников
 * напротив значения. До этого он рисовался **трижды** разной разметкой.
 *
 * `density="compact"` — для длинных списков: на экран попадает больше строк.
 */
export function PersonRow({
  name,
  meta,
  children,
  density = 'comfortable',
}: {
  name: string;
  /** Уточнение под именем: класс, статус. */
  meta?: ReactNode;
  /** Значение напротив имени: отметки, ответ, состояние. */
  children?: ReactNode;
  density?: 'comfortable' | 'compact';
}) {
  const minHeight =
    density === 'compact'
      ? 'min-h-[var(--row-height-compact)]'
      : 'min-h-[var(--row-height-comfortable)]';

  return (
    <li
      className={`flex flex-wrap items-center gap-3 border-b border-slate-100 py-2 last:border-0 ${minHeight}`}
    >
      <div className="flex min-w-40 flex-col">
        <span className="text-sm font-medium text-slate-900">{name}</span>
        {meta !== undefined && <span className="text-xs text-slate-500">{meta}</span>}
      </div>
      {children !== undefined && (
        <div className="flex flex-wrap items-center gap-2 text-sm">{children}</div>
      )}
    </li>
  );
}

/** Список строк «кто × значение»: общая рамка и разделители. */
export function PersonList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col">{children}</ul>;
}

/**
 * Состояние запроса: загрузка, пусто, **ошибка**.
 *
 * Ошибка здесь — не украшение, а исправление дефекта: на стенде ответ приходил с `400`, а на
 * экране было «заданий нет». Ошибка была **в теле ответа**, и интерфейс её не рисовал: **любая**
 * ошибка сервера выглядела как «данных нет», и человек искал причину не там.
 */
export function QueryState({
  isLoading,
  error,
  isEmpty,
  emptyText = 'Данных нет.',
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyText?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <p className="py-6 text-center text-sm text-slate-500" role="status">
        Загружаем…
      </p>
    );
  }

  if (error !== null && error !== undefined) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Alert tone="error">
          <span className="font-medium">Не удалось получить данные.</span> {errorMessageOf(error)}
        </Alert>
        {onRetry !== undefined && (
          <Button tone="secondary" onClick={onRetry}>
            Повторить
          </Button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return <p className="py-6 text-center text-sm text-slate-500">{emptyText}</p>;
  }

  return <>{children}</>;
}

/** Текст ошибки: показываем сообщение сервера, если оно есть. */
function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;

  return 'Повторите попытку. Если не помогает — сообщите администратору.';
}
