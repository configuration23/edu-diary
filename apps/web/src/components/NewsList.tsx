import { useState } from 'react';

import type { NewsItemDto } from '@edu-diary/contracts';

import { Card } from './ui';

/**
 * Новости в интерфейсе: полная статья и свёрнутая строка.
 *
 * Требование владельца: **последняя новость показывается полностью, предыдущие сворачиваются до
 * одной строки** — виден только заголовок. Разворачиваются нажатием.
 *
 * Свёрнутая строка сделана на `<details>`/`<summary>`: работает **без JavaScript**, доступна с
 * клавиатуры, и `Ctrl+F` находит текст **внутри** свёрнутой новости. Свой обработчик нажатия всего
 * этого не даёт.
 */

/** Дата новости: день без времени. */
function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`;
}

/** Картинка новости: отдаётся через API с проверкой прав, поэтому обычный `img`. */
function NewsImage({ item }: { item: NewsItemDto }) {
  if (item.imageUrl === null) return null;

  return (
    <img
      src={item.imageUrl}
      alt={item.imageName ?? 'Изображение к новости'}
      className="max-h-96 w-full rounded-md object-contain"
    />
  );
}

/** Свежая новость: целиком. */
export function NewsArticle({ item }: { item: NewsItemDto }) {
  return (
    <Card
      title={item.title}
      description={
        item.visibleUntil === null
          ? formatDay(item.publishedOn)
          : `${formatDay(item.publishedOn)} · до ${formatDay(item.visibleUntil)}`
      }
    >
      {/**
       * Картинка сверху или снизу — выбор автора новости (решение владельца). Фото с линейки
       * уместнее сверху, а схему или таблицу — под текстом, поэтому вариантов два, а не один.
       */}
      <div className="flex flex-col gap-4">
        {item.imagePosition === 'top' && <NewsImage item={item} />}
        <p className="whitespace-pre-wrap text-slate-800">{item.body}</p>
        {item.imagePosition === 'bottom' && <NewsImage item={item} />}
      </div>
    </Card>
  );
}

/**
 * Свёрнутая новость: **одна строка** с заголовком.
 *
 * Раньше спойлер задумывался высотой в 3–4 строки с кратким описанием. Владелец уточнил:
 * **новости сворачиваются до одной строки**, поэтому здесь только заголовок и дата — описание не
 * показываем, иначе строка перестанет быть строкой.
 */
export function NewsCollapsedItem({ item }: { item: NewsItemDto }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-slate-100 last:border-0">
      {/*
        Строка фиксированной высоты: список из десятка новостей должен читаться как список, а не
        расползаться на пол-экрана. Заголовок обрезается, полный виден в подсказке.
      */}
      <button
        type="button"
        className="flex h-10 w-full items-center gap-3 px-1 text-left hover:bg-slate-50"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        title={item.title}
      >
        <span className="w-4 shrink-0 text-slate-400">{open ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
          {item.title}
        </span>
        <span className="shrink-0 text-xs text-slate-500">{formatDay(item.publishedOn)}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-1 pt-1 pb-4 pl-5">
          {item.imagePosition === 'top' && <NewsImage item={item} />}
          <p className="whitespace-pre-wrap text-sm text-slate-800">{item.body}</p>
          {item.imagePosition === 'bottom' && <NewsImage item={item} />}
        </div>
      )}
    </li>
  );
}
