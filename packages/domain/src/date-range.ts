/**
 * Отрезки календарных дат: учебные годы, периоды, зачисления и назначения.
 *
 * Отрезок — замкнутый интервал `[startsOn, endsOn]`: обе границы входят в него.
 * Открытый конец (`endsOn === null`) означает «действует до сих пор» — так
 * описывается текущее назначение преподавателя или активное зачисление.
 *
 * Часовых поясов здесь нет: все значения — строки `YYYY-MM-DD` (ADR-016).
 */

import { compareISODates, isISODate, isWithinRange } from './date';

export interface DateRange {
  startsOn: string;
  /** `null` — отрезок не ограничен справа. */
  endsOn: string | null;
}

/** Проверяет, что границы корректны и начало не позже окончания. */
export function isValidDateRange(range: DateRange): boolean {
  if (!isISODate(range.startsOn)) return false;
  if (range.endsOn !== null && !isISODate(range.endsOn)) return false;
  return endsOnOrAfter(range, range.startsOn);
}

/**
 * Сравнивает два отрезка: `-1` — левый раньше правого, `0` — совпадают,
 * `1` — левый позже правого. Открытый конец считается самым поздним.
 */
export function compareRanges(left: DateRange, right: DateRange): number {
  const byStart = compareISODates(left.startsOn, right.startsOn);
  if (byStart !== 0) return byStart;

  return compareOpenEnds(left.endsOn, right.endsOn);
}

/**
 * Пересекаются ли отрезки. Касание одной датой (`endsOn` левого равно
 * `startsOn` правого) — уже пересечение: в этот день обе записи действуют.
 */
export function rangesOverlap(left: DateRange, right: DateRange): boolean {
  return endsOnOrAfter(left, right.startsOn) && endsOnOrAfter(right, left.startsOn);
}

/** Входит ли дата в отрезок включительно. */
export function rangeContainsDate(range: DateRange, value: string): boolean {
  if (range.endsOn === null) return compareISODates(value, range.startsOn) >= 0;
  return isWithinRange(value, range.startsOn, range.endsOn);
}

/** Входит ли отрезок `inner` целиком в отрезок `outer` (границы включительно). */
export function rangeContainsRange(outer: DateRange, inner: DateRange): boolean {
  if (!rangeContainsDate(outer, inner.startsOn)) return false;
  if (inner.endsOn === null) return outer.endsOn === null;
  return rangeContainsDate(outer, inner.endsOn);
}

/** Пересечение двух отрезков или `null`, если они не пересекаются. */
export function intersectRanges(left: DateRange, right: DateRange): DateRange | null {
  if (!rangesOverlap(left, right)) return null;

  const start =
    compareISODates(left.startsOn, right.startsOn) >= 0 ? left.startsOn : right.startsOn;
  const endsOn = minEnd(left.endsOn, right.endsOn);

  return { startsOn: start, endsOn };
}

/** Действует ли отрезок на дату: то же, что `rangeContainsDate`, но с явным именем. */
export function isRangeActiveOn(range: DateRange, value: string): boolean {
  return rangeContainsDate(range, value);
}

/** Человекочитаемое описание отрезка для сообщений об ошибке. */
export function describeRange(range: DateRange): string {
  return range.endsOn === null
    ? `с ${range.startsOn} без даты окончания`
    : `с ${range.startsOn} по ${range.endsOn}`;
}

/** `-1`, `0` или `1` — сравнение концов отрезков (открытый конец — самый поздний). */
function compareOpenEnds(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return compareISODates(left, right);
}

/** Закончился ли отрезок не раньше указанной даты; открытый конец — всегда да. */
function endsOnOrAfter(range: DateRange, value: string): boolean {
  return range.endsOn === null || compareISODates(range.endsOn, value) >= 0;
}

function minEnd(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return compareISODates(left, right) <= 0 ? left : right;
}
