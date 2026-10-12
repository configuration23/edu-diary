import { describe, expect, it } from 'vitest';

import {
  compareTimes,
  dayOfWeekOf,
  defaultPairTime,
  findSlotConflicts,
  isDayOfWeek,
  isPairNumber,
  isSameSlot,
  isTimeOfDay,
  isValidPairTime,
  weekdayName,
} from '../src/schedule';

/**
 * Правила расписания: пары, время и наложения.
 *
 * Домен отвечает на вопросы «корректно ли значение» и «сталкиваются ли занятия»;
 * проверка по данным заведения — задача сервиса (там известны существующие шаблоны).
 */

describe('пары и дни недели', () => {
  it('номер пары — от 1 до 8', () => {
    expect(isPairNumber(1)).toBe(true);
    expect(isPairNumber(8)).toBe(true);
    expect(isPairNumber(0)).toBe(false);
    expect(isPairNumber(9)).toBe(false);
    expect(isPairNumber(2.5)).toBe(false);
  });

  it('день недели — от 1 (понедельник) до 7 (воскресенье)', () => {
    expect(isDayOfWeek(1)).toBe(true);
    expect(isDayOfWeek(7)).toBe(true);
    expect(isDayOfWeek(0)).toBe(false);
    expect(isDayOfWeek(8)).toBe(false);
  });

  it('названия дней понятны человеку', () => {
    expect(weekdayName(1)).toBe('понедельник');
    expect(weekdayName(6)).toBe('суббота');
    expect(weekdayName(7)).toBe('воскресенье');
  });

  it('номер дня недели вычисляется по дате', () => {
    // 2026-09-01 — вторник; 2026-09-06 — воскресенье.
    expect(dayOfWeekOf('2026-09-01')).toBe(2);
    expect(dayOfWeekOf('2026-09-05')).toBe(6);
    expect(dayOfWeekOf('2026-09-06')).toBe(7);
    expect(dayOfWeekOf('не дата')).toBeNull();
  });
});

describe('время пары', () => {
  it('принимает только HH:MM в 24 часах', () => {
    expect(isTimeOfDay('08:00')).toBe(true);
    expect(isTimeOfDay('23:59')).toBe(true);
    expect(isTimeOfDay('24:00')).toBe(false);
    expect(isTimeOfDay('8:00')).toBe(false);
    expect(isTimeOfDay('08:60')).toBe(false);
    expect(isTimeOfDay('')).toBe(false);
  });

  it('начало раньше окончания', () => {
    expect(isValidPairTime('09:40', '11:10')).toBe(true);
    expect(isValidPairTime('11:10', '09:40')).toBe(false);
    // Пара нулевой длины смысла не имеет.
    expect(isValidPairTime('10:00', '10:00')).toBe(false);
  });

  it('сравнение времени не путает часы и минуты', () => {
    expect(compareTimes('09:00', '10:00')).toBe(-1);
    expect(compareTimes('10:00', '09:00')).toBe(1);
    expect(compareTimes('10:00', '10:00')).toBe(0);
  });

  it('типовое время подсказывается для существующих пар', () => {
    expect(defaultPairTime(1)).toEqual({ timeStart: '08:00', timeEnd: '09:30' });
    expect(defaultPairTime(8)).not.toBeNull();
    expect(defaultPairTime(9)).toBeNull();
  });
});

describe('наложения', () => {
  const slot = (dayOfWeek: number, pairNumber: number) => ({ dayOfWeek, pairNumber });
  const range = (startsOn: string, endsOn: string | null = null) => ({ startsOn, endsOn });

  it('одинаковые день и пара — одно и то же место в сетке', () => {
    expect(isSameSlot(slot(2, 3), slot(2, 3))).toBe(true);
    expect(isSameSlot(slot(2, 3), slot(2, 4))).toBe(false);
    expect(isSameSlot(slot(2, 3), slot(3, 3))).toBe(false);
  });

  it('находит занятость того же преподавателя в пересекающиеся периоды', () => {
    const existing = [
      {
        item: 'вторник, ОП в ПКС-21',
        slot: slot(2, 3),
        range: range('2026-09-01', '2026-12-31'),
        resourceId: 'teacher-1',
      },
    ];

    const conflicts = findSlotConflicts(
      {
        item: 'вторник, БД в ПКС-22',
        slot: slot(2, 3),
        range: range('2026-11-01', '2027-01-31'),
        resourceId: 'teacher-1',
      },
      existing,
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.item).toBe('вторник, ОП в ПКС-21');
  });

  it('не считает наложением другой день, другую пару, другого человека и разное время', () => {
    const existing = [
      {
        item: 'А',
        slot: slot(2, 3),
        range: range('2026-09-01', '2026-12-31'),
        resourceId: 'teacher-1',
      },
    ];

    const candidate = (overrides: Partial<(typeof existing)[number]>) => ({
      item: 'Б',
      slot: slot(2, 3),
      range: range('2026-09-01', '2026-12-31'),
      resourceId: 'teacher-1',
      ...overrides,
    });

    expect(findSlotConflicts(candidate({ slot: slot(2, 4) }), existing)).toHaveLength(0);
    expect(findSlotConflicts(candidate({ slot: slot(3, 3) }), existing)).toHaveLength(0);
    expect(findSlotConflicts(candidate({ resourceId: 'teacher-2' }), existing)).toHaveLength(0);
    // Периоды не пересекаются: первый закончился в декабре, второй начинается позже.
    expect(
      findSlotConflicts(candidate({ range: range('2027-01-01', '2027-06-30') }), existing),
    ).toHaveLength(0);
  });

  it('бессрочный шаблон конфликтует с любым пересекающимся периодом', () => {
    const conflicts = findSlotConflicts(
      {
        item: 'новый',
        slot: slot(4, 2),
        range: range('2026-09-01', '2026-10-31'),
        resourceId: 'room-1',
      },
      [
        {
          item: 'бессрочный',
          slot: slot(4, 2),
          range: range('2020-01-01', null),
          resourceId: 'room-1',
        },
      ],
    );

    expect(conflicts).toHaveLength(1);
  });
});
