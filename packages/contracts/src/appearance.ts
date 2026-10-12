import { z } from 'zod';

/**
 * Оформление, которое настраивает администратор.
 *
 * Цвет в интерфейсе означает **предмет**, а события (замена, отмена) показываются
 * значками — так интерфейс перестаёт быть пёстрым: одно средство несёт один смысл.
 * Значения по умолчанию живут в коде, изменённые — в настройках (ADR-003).
 */

/**
 * Набор значков: выбор только из него.
 *
 * Значение попадает в интерфейс, поэтому произвольная строка недопустима. Каждый
 * элемент набора — ровно один видимый символ (см. `isSingleEmoji`).
 */
export const MARKER_SYMBOLS = ['🔄', '❎', '⛔', '✅', '🚫', '⚠', '❗', '➡', '🕒', '⏸'] as const;

export type MarkerSymbol = (typeof MARKER_SYMBOLS)[number];

/** Событие, которое обозначается значком. Перенос значком не обозначаем. */
export const MARKER_EVENTS = ['replaced', 'cancelled'] as const;

export type MarkerEvent = (typeof MARKER_EVENTS)[number];

export const DEFAULT_MARKERS: Record<MarkerEvent, MarkerSymbol> = {
  replaced: '🔄',
  cancelled: '❎',
};

export const DEFAULT_APPEARANCE = {
  markersEnabled: true,
  markers: DEFAULT_MARKERS,
  /** Цвета предметов: заливка плиток и маркер рядом с названием в строках. */
  colorsEnabled: true,
} as const;

/**
 * Ровно один видимый символ.
 *
 * Эмодзи может состоять из нескольких кодовых точек (⚠️ — это ⚠ плюс стилизующий
 * вариант), поэтому считаем не кодовые точки, а графемы. Если движок не умеет
 * `Intl.Segmenter`, считаем кодовые точки — набор значков всё равно проверяем
 * списком, так что безопасность не страдает.
 */
export function isSingleEmoji(value: string): boolean {
  if (value.length === 0) return false;

  const segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locales?: string,
        options?: object,
      ) => { segment(v: string): Iterable<unknown> };
    }
  ).Segmenter;

  if (segmenter === undefined) return [...value].length === 1;

  const segments = new segmenter('ru', { granularity: 'grapheme' });
  return [...segments.segment(value)].length === 1;
}

const markerSymbolSchema = z
  .string()
  .refine((value) => (MARKER_SYMBOLS as readonly string[]).includes(value), {
    message: 'Значок выбирается из списка',
  })
  .refine(isSingleEmoji, { message: 'Значок — ровно один символ' });

export const appearanceSchema = z.object({
  markersEnabled: z.boolean(),
  markers: z.object({
    replaced: markerSymbolSchema,
    cancelled: markerSymbolSchema,
  }),
  colorsEnabled: z.boolean(),
});

export type AppearanceDto = z.infer<typeof appearanceSchema>;

export const updateAppearanceRequestSchema = z.object({
  markersEnabled: z.boolean().optional(),
  markers: z
    .object({
      replaced: markerSymbolSchema.optional(),
      cancelled: markerSymbolSchema.optional(),
    })
    .optional(),
  colorsEnabled: z.boolean().optional(),
});

export type UpdateAppearanceRequest = z.infer<typeof updateAppearanceRequestSchema>;
