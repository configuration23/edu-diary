import { describe, expect, it } from 'vitest';

import {
  addDays,
  compareISODates,
  daysBetween,
  isISODate,
  isWithinRange,
  parseLocalDate,
  toLocalISODate,
  todayISODate,
} from '../src/date';

describe('isISODate', () => {
  it('принимает существующие календарные даты', () => {
    expect(isISODate('2025-01-15')).toBe(true);
    expect(isISODate('2024-02-29')).toBe(true);
  });

  it('отвергает несуществующие даты и неверный формат', () => {
    expect(isISODate('2025-02-30')).toBe(false);
    expect(isISODate('2025-13-01')).toBe(false);
    expect(isISODate('2025-00-10')).toBe(false);
    expect(isISODate('2023-02-29')).toBe(false);
    expect(isISODate('2025-1-1')).toBe(false);
    expect(isISODate('15.01.2025')).toBe(false);
    expect(isISODate('2025-01-15T00:00:00Z')).toBe(false);
    expect(isISODate('')).toBe(false);
    expect(isISODate(undefined)).toBe(false);
    expect(isISODate(20250115)).toBe(false);
  });
});

describe('toLocalISODate', () => {
  it('не съезжает на следующий день вечером (регрессия ADR-016)', () => {
    const lateEvening = new Date(2025, 0, 15, 22, 30, 0);
    expect(toLocalISODate(lateEvening)).toBe('2025-01-15');
  });

  it('не съезжает на предыдущий день рано утром', () => {
    const earlyMorning = new Date(2025, 0, 15, 0, 30, 0);
    expect(toLocalISODate(earlyMorning)).toBe('2025-01-15');
  });

  it('дополняет месяц и день нулями', () => {
    expect(toLocalISODate(new Date(2025, 8, 5, 12, 0, 0))).toBe('2025-09-05');
  });

  it('падает на Invalid Date', () => {
    expect(() => toLocalISODate(new Date('не дата'))).toThrow(TypeError);
  });
});

describe('parseLocalDate', () => {
  it('возвращает местную полночь', () => {
    const date = parseLocalDate('2025-01-15');
    expect(date.getFullYear()).toBe(2025);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
  });

  it('сохраняет день недели (регрессия ADR-016)', () => {
    // 15 января 2025 — среда. `new Date('2025-01-15')` разбирается как UTC и в
    // часовых поясах западнее нулевого меридиана даёт предыдущий день.
    expect(parseLocalDate('2025-01-15').getDay()).toBe(3);
  });

  it('падает на некорректной дате', () => {
    expect(() => parseLocalDate('2025-02-30')).toThrow(TypeError);
  });
});

describe('todayISODate', () => {
  it('использует переданный момент времени', () => {
    expect(todayISODate(new Date(2025, 11, 31, 23, 59, 59))).toBe('2025-12-31');
  });
});

describe('addDays', () => {
  it('переходит через границы месяца и года', () => {
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
  });

  it('не зависит от перехода на летнее время', () => {
    expect(addDays('2025-03-29', 1)).toBe('2025-03-30');
    expect(addDays('2025-10-25', 1)).toBe('2025-10-26');
  });

  it('требует целое число дней', () => {
    expect(() => addDays('2025-01-01', 1.5)).toThrow(TypeError);
  });
});

describe('daysBetween', () => {
  it('считает разницу в днях', () => {
    expect(daysBetween('2025-01-01', '2025-01-31')).toBe(30);
    expect(daysBetween('2025-01-31', '2025-01-01')).toBe(-30);
    expect(daysBetween('2025-01-01', '2025-01-01')).toBe(0);
  });

  it('учитывает високосный год', () => {
    expect(daysBetween('2024-02-01', '2024-03-01')).toBe(29);
    expect(daysBetween('2025-02-01', '2025-03-01')).toBe(28);
  });
});

describe('compareISODates и isWithinRange', () => {
  it('сравнивает даты', () => {
    expect(compareISODates('2025-01-01', '2025-01-02')).toBe(-1);
    expect(compareISODates('2025-01-02', '2025-01-01')).toBe(1);
    expect(compareISODates('2025-01-01', '2025-01-01')).toBe(0);
  });

  it('проверяет попадание в период включительно', () => {
    expect(isWithinRange('2025-09-01', '2025-09-01', '2025-12-31')).toBe(true);
    expect(isWithinRange('2025-12-31', '2025-09-01', '2025-12-31')).toBe(true);
    expect(isWithinRange('2026-01-01', '2025-09-01', '2025-12-31')).toBe(false);
  });
});
