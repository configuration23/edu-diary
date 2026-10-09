/**
 * Календарные даты без времени и часовых поясов (ADR-016).
 *
 * Все календарные значения в системе — строки вида `YYYY-MM-DD`. Преобразование
 * Date → строка выполняется только через `toLocalISODate`: `toISOString()` для
 * календарных полей запрещён, потому что после 21:00 по местному времени он
 * отдаёт «завтрашний» день.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

/** Проверяет, что значение — существующая календарная дата в формате `YYYY-MM-DD`. */
export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}

/**
 * Разбирает `YYYY-MM-DD` в Date на местную полночь.
 *
 * `new Date('2025-03-01')` разбирается как UTC и в западных часовых поясах
 * сдвигает день недели — здесь этот способ намеренно не используется.
 */
export function parseLocalDate(value: string): Date {
  if (!isISODate(value)) {
    throw new TypeError(`Ожидалась календарная дата в формате YYYY-MM-DD, получено: ${value}`);
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return new Date(year, month - 1, day);
}

/** Преобразует Date в календарную строку по местному времени. */
export function toLocalISODate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Некорректная дата: Invalid Date');
  }

  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Календарная дата «сегодня» по местному времени. */
export function todayISODate(now: Date = new Date()): string {
  return toLocalISODate(now);
}

/** Сдвигает календарную дату на указанное число дней (может быть отрицательным). */
export function addDays(value: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new TypeError(`Число дней должно быть целым, получено: ${days}`);
  }

  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return toLocalISODate(date);
}

/** Число дней от `from` до `to` (положительное, если `to` позже). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toEpochDay(to) - toEpochDay(from)) / MILLISECONDS_PER_DAY);
}

/** Сравнение календарных дат: -1, 0 или 1. */
export function compareISODates(left: string, right: string): number {
  assertISODate(left);
  assertISODate(right);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** true, если дата входит в отрезок `[from, to]` включительно. */
export function isWithinRange(value: string, from: string, to: string): boolean {
  return compareISODates(value, from) >= 0 && compareISODates(value, to) <= 0;
}

function assertISODate(value: string): void {
  if (!isISODate(value)) {
    throw new TypeError(`Ожидалась календарная дата в формате YYYY-MM-DD, получено: ${value}`);
  }
}

function toEpochDay(value: string): number {
  assertISODate(value);
  return Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  );
}
