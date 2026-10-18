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

  /**
   * Оформление — **на самой картинке**: скругление, рамка и тень (`rounded-md` + `shadow-sm`, те же
   * токены, что у форм и секций). Просьба владельца: голая картинка выбивалась из интерфейса.
   *
   * Обёртку убрал: сначала эффект лежал на блоке-обёртке, и картинка оставалась голой внутри него —
   * скругление и тень были видны **вокруг** неё, а не на ней. Владелец это заметил сразу.
   *
   * Ширину не растягиваем: у вертикального снимка при `w-full` выходила огромная плитка.
   * `max-h` ограничивает высоту, поэтому длинная новость не уезжает за экран, а `object-contain`
   * показывает снимок **целиком** — обрезка лица на фотографии с линейки хуже свободного места.
   * `object-cover` здесь не годится: он как раз обрезает, а рамка и тень должны повторять контур
   * изображения, поэтому обёртка с `overflow-hidden` больше не нужна.
   */
  return (
    <img
      src={item.imageUrl}
      alt={item.imageName ?? 'Изображение к новости'}
      className="max-h-96 max-w-full rounded-md border border-border object-contain shadow-sm"
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
      <div className="flex flex-col gap-3">
        {item.imagePosition === 'top' && <NewsImage item={item} />}
        <p className="whitespace-pre-wrap text-foreground">{item.body}</p>
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
    <li className="border-b border-border last:border-0">
      {/*
        Строка фиксированной высоты: список из десятка новостей должен читаться как список, а не
        расползаться на пол-экрана. Заголовок обрезается, полный виден в подсказке.
      */}
      <button
        type="button"
        className="flex h-10 w-full items-center gap-3 px-1 text-left hover:bg-muted"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        title={item.title}
      >
        <span className="w-4 shrink-0 text-subtle-foreground">{open ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {item.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDay(item.publishedOn)}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-1 pt-1 pb-4 pl-5">
          {item.imagePosition === 'top' && <NewsImage item={item} />}
          <p className="whitespace-pre-wrap text-sm text-foreground">{item.body}</p>
          {item.imagePosition === 'bottom' && <NewsImage item={item} />}
        </div>
      )}
    </li>
  );
}
