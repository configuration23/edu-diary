import type { ReactNode } from 'react';

import { useViewMode } from '../lib/view-mode';

/**
 * Спойлер: свёрнутый блок с кратким описанием.
 *
 * Требование владельца: большой блок прячется под спойлер **высотой в 3–4 строки**, в них —
 * краткое описание того, что внутри. По нажатию блок раскрывается полностью.
 *
 * Реализация на `<details>`/`<summary>`, а не на своём состоянии:
 *
 * - работает **без JavaScript** — если скрипт не загрузился, содержимое всё равно доступно;
 * - **клавиатура и поиск** по странице получают это бесплатно: браузер сам умеет сворачивать и
 *   разворачивать, и `Ctrl+F` находит текст внутри свёрнутого блока.
 *
 * Высота свёрнутого состояния задана **жёстко** (`SUMMARY_LINES`), а не «по содержимому»:
 * иначе блок сам решает, сколько ему места, и список спойлеров встаёт неровно. Описание, не
 * поместившееся в строки, обрезается — таково требование.
 */

/** Сколько строк занимает свёрнутый блок. Владелец: 3–4 строки. */
const SUMMARY_LINES = 3;

export function Spoiler({
  title,
  summary,
  /** Счётчик или значок рядом с заголовком: «12 работ», «не сдал». */
  meta,
  /** Раскрыт по умолчанию: нужен для **последней** новости, она показывается полностью. */
  defaultOpen = false,
  /** Действия блока: например «Добавить предмет». Видны в обоих режимах. */
  actions,
  children,
}: {
  title: string;
  /** Краткое описание: то, что видно в свёрнутом виде. */
  summary?: string;
  meta?: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const viewMode = useViewMode();

  /**
   * Развёрнутый вид: блоки идут подряд — заголовок, пояснение, содержимое.
   *
   * Это не «раскрытые спойлеры»: сводка и кнопка «Развернуть» на длинной странице занимают место
   * без пользы, если человек выбрал видеть всё сразу.
   */
  if (viewMode === 'expanded') {
    return (
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <header className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {summary !== undefined && (
              <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
            )}
          </div>
          {actions}
        </header>
        {children}
      </section>
    );
  }

  return (
    /**
     * Обёртка `<section>` у обоих видов: блок остаётся **разделом страницы** независимо от того,
     * свёрнут он или нет. На этом держатся и сквозные сценарии, которые находят блок по разделу.
     */
    <section>
      <details
        open={defaultOpen}
        className="group rounded-lg border border-border bg-card shadow-sm"
      >
        {/*
        `<summary>` — единственная нажимаемая часть. Убираем системный маркер (`list-none`) и
        рисуем свой, иначе у разных браузеров вид разный.
      */}
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
              {meta}
            </span>

            {/*
            Краткое описание. `line-clamp` обрезает по строкам, а не по символам: обрезка
            выглядит опрятно и одинаково на любой ширине экрана.
          */}
            {summary !== undefined && summary !== '' && (
              <span
                className="overflow-hidden text-sm text-muted-foreground group-open:hidden"
                style={{
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: SUMMARY_LINES,
                }}
              >
                {summary}
              </span>
            )}
          </span>

          {/* Подсказка меняется по состоянию: браузер сам знает, раскрыт блок или нет. */}
          <span className="shrink-0 pt-0.5 text-sm text-primary">
            <span className="group-open:hidden">Развернуть</span>
            <span className="hidden group-open:inline">Свернуть</span>
          </span>
        </summary>

        <div className="spoiler-content border-t border-border p-4">
          {/*
            Действия блока — здесь, а не в сводке: пока блок свёрнут, кнопки «Добавить …» быть не
            должно. Так же устроены «Настройки» и «Настройки обучения»: блок вложен, и его шапка с
            кнопками появляется вместе с содержимым.
          */}
          {actions !== undefined && <div className="mb-3 flex justify-end">{actions}</div>}
          {children}
        </div>
      </details>
    </section>
  );
}
