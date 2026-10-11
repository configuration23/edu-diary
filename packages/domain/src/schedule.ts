/**
 * Расписание: пары, время и наложения.
 *
 * Расписание описывается двумя сущностями: шаблон (`schedule_entry`) — «в какой
 * день недели, какой парой и в какое время» — и исключение (`schedule_exception`)
 * на конкретную дату. Урок (`lesson`) порождается из шаблона на дату.
 *
 * Здесь только чистые правила: номера пар, время, пересечение периодов действия и
 * поиск наложений. Проверка по существующим данным (кто уже занят в это время)
 * живёт в сервисе — домен об этом ничего не знает.
 *
 * Часовых поясов нет: время — строка `HH:MM` местного времени заведения (ADR-016).
 */

import { rangesOverlap, type DateRange } from './date-range';

/** Пар в учебном дне: больше восьми не бывает даже в две смены. */
export const MIN_PAIR_NUMBER = 1;
export const MAX_PAIR_NUMBER = 8;
export const PAIR_NUMBERS: readonly number[] = Array.from(
  { length: MAX_PAIR_NUMBER },
  (_, index) => index + 1,
);

/**
 * Дни недели: 1 — понедельник, 7 — воскресенье (как в ISO 8601).
 *
 * Суббота и воскресенье допустимы: в колледжах бывают занятия по субботам.
 */
export const MIN_DAY_OF_WEEK = 1;
export const MAX_DAY_OF_WEEK = 7;

export interface WeekdayTime {
  dayOfWeek: number;
  pairNumber: number;
}

/** Строка времени в формате `HH:MM` (24 часа). */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isPairNumber(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PAIR_NUMBER && value <= MAX_PAIR_NUMBER;
}

export function isDayOfWeek(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_DAY_OF_WEEK && value <= MAX_DAY_OF_WEEK;
}

export function isTimeOfDay(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** Сравнивает время: `-1` — левое раньше, `0` — совпадает, `1` — позже. */
export function compareTimes(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Время начала раньше времени окончания. */
export function isValidPairTime(timeStart: string, timeEnd: string): boolean {
  if (!isTimeOfDay(timeStart) || !isTimeOfDay(timeEnd)) return false;
  return compareTimes(timeStart, timeEnd) < 0;
}

/** Один и тот же день недели и одна и та же пара. */
export function isSameSlot(left: WeekdayTime, right: WeekdayTime): boolean {
  return left.dayOfWeek === right.dayOfWeek && left.pairNumber === right.pairNumber;
}

/**
 * Занятия в одно и то же время, но в разных группах.
 *
 * Наложение — это когда один преподаватель (или одна аудитория) оказывается в
 * двух местах в одну пару, и при этом периоды действия шаблонов пересекаются.
 * Возвращаются пары «что с чем столкнулось», чтобы объяснить отказ в интерфейсе.
 */
export interface SlotOccupancy<T> {
  item: T;
  slot: WeekdayTime;
  /** Период действия шаблона: `endsOn === null` — бессрочно. */
  range: DateRange;
  /** Занятость одного ресурса: преподаватель или аудитория. */
  resourceId: string;
}

export function findSlotConflicts<T>(
  candidate: SlotOccupancy<T>,
  existing: readonly SlotOccupancy<T>[],
): SlotOccupancy<T>[] {
  return existing.filter(
    (other) =>
      other.resourceId === candidate.resourceId &&
      isSameSlot(other.slot, candidate.slot) &&
      rangesOverlap(other.range, candidate.range),
  );
}

/**
 * Типовое время пары: используется как подсказка в форме, а не как правило.
 *
 * Сетка звонков различается между заведениями, поэтому хранится в шаблоне, а это
 * значение лишь помогает не заполнять поле с нуля.
 */
export function defaultPairTime(pairNumber: number): { timeStart: string; timeEnd: string } | null {
  if (!isPairNumber(pairNumber)) return null;

  const slots: readonly { timeStart: string; timeEnd: string }[] = [
    { timeStart: '08:00', timeEnd: '09:30' },
    { timeStart: '09:40', timeEnd: '11:10' },
    { timeStart: '11:30', timeEnd: '13:00' },
    { timeStart: '13:10', timeEnd: '14:40' },
    { timeStart: '14:50', timeEnd: '16:20' },
    { timeStart: '16:30', timeEnd: '18:00' },
    { timeStart: '18:10', timeEnd: '19:40' },
    { timeStart: '19:50', timeEnd: '21:20' },
  ];

  return slots[pairNumber - 1] ?? null;
}

const WEEKDAY_NAMES: readonly string[] = [
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
  'воскресенье',
];

/** Название дня недели для сообщений: «вторник». */
export function weekdayName(dayOfWeek: number): string {
  return WEEKDAY_NAMES[dayOfWeek - 1] ?? `день ${dayOfWeek}`;
}

/** Номер дня недели (1 — понедельник) для даты `YYYY-MM-DD`. */
export function dayOfWeekOf(isoDate: string): number | null {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  // getUTCDay: 0 — воскресенье, поэтому сдвигаем к ISO-нумерации.
  const weekday = parsed.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}
