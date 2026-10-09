import { describe, expect, it } from 'vitest';

import {
  compareRanges,
  describeRange,
  intersectRanges,
  isRangeActiveOn,
  isValidDateRange,
  rangeContainsDate,
  rangeContainsRange,
  rangesOverlap,
  type DateRange,
} from '../src/date-range';

/**
 * Отрезки дат — основа проверок Этапа 2: периоды не должны перекрываться в
 * пределах года, период обязан помещаться в год, зачисление — в границы группы.
 */

const range = (startsOn: string, endsOn: string | null = null): DateRange => ({ startsOn, endsOn });

describe('isValidDateRange', () => {
  it('принимает корректные границы, в том числе одну и ту же дату', () => {
    expect(isValidDateRange(range('2025-09-01', '2026-06-30'))).toBe(true);
    expect(isValidDateRange(range('2025-09-01', '2025-09-01'))).toBe(true);
    expect(isValidDateRange(range('2025-09-01', null))).toBe(true);
  });

  it('отвергает даты не в формате и обратный порядок', () => {
    expect(isValidDateRange(range('01.09.2025', '2026-06-30'))).toBe(false);
    expect(isValidDateRange(range('2026-06-30', '2025-09-01'))).toBe(false);
    expect(isValidDateRange(range('2025-02-30', null))).toBe(false);
  });
});

describe('rangesOverlap', () => {
  it('находит пересечение и общий день на границе', () => {
    expect(
      rangesOverlap(range('2025-09-01', '2025-12-31'), range('2025-12-31', '2026-06-30')),
    ).toBe(true);
    expect(
      rangesOverlap(range('2025-09-01', '2025-10-31'), range('2025-10-01', '2025-11-30')),
    ).toBe(true);
  });

  it('не считает пересечением соседние дни', () => {
    expect(
      rangesOverlap(range('2025-09-01', '2025-10-31'), range('2025-11-01', '2025-12-31')),
    ).toBe(false);
  });

  it('открытый конец пересекается со всем, что начинается позже', () => {
    expect(rangesOverlap(range('2025-09-01', null), range('2030-01-01', '2030-06-30'))).toBe(true);
    expect(rangesOverlap(range('2025-09-01', null), range('2024-09-01', '2025-08-31'))).toBe(false);
  });

  it('два открытых конца всегда пересекаются', () => {
    expect(rangesOverlap(range('2025-09-01', null), range('2026-09-01', null))).toBe(true);
  });
});

describe('rangeContainsDate и rangeContainsRange', () => {
  it('проверяет дату по границам включительно', () => {
    const year = range('2025-09-01', '2026-06-30');

    expect(rangeContainsDate(year, '2025-09-01')).toBe(true);
    expect(rangeContainsDate(year, '2026-06-30')).toBe(true);
    expect(rangeContainsDate(year, '2026-07-01')).toBe(false);
  });

  it('для открытого конца сверяет только начало', () => {
    expect(rangeContainsDate(range('2025-09-01', null), '2031-01-01')).toBe(true);
    expect(rangeContainsDate(range('2025-09-01', null), '2025-08-31')).toBe(false);
  });

  it('принимает вложенный период и отвергает выходящий за год', () => {
    const year = range('2025-09-01', '2026-06-30');

    expect(rangeContainsRange(year, range('2025-09-01', '2025-12-31'))).toBe(true);
    expect(rangeContainsRange(year, range('2025-08-15', '2025-12-31'))).toBe(false);
    expect(rangeContainsRange(year, range('2026-06-01', '2026-08-31'))).toBe(false);
  });

  it('открытый конец не помещается в закрытый год', () => {
    expect(rangeContainsRange(range('2025-09-01', '2026-06-30'), range('2025-09-01', null))).toBe(
      false,
    );
  });
});

describe('intersectRanges', () => {
  it('возвращает общий отрезок', () => {
    expect(
      intersectRanges(range('2025-09-01', '2026-06-30'), range('2025-12-01', '2027-01-01')),
    ).toEqual({ startsOn: '2025-12-01', endsOn: '2026-06-30' });
  });

  it('возвращает null для непересекающихся', () => {
    expect(intersectRanges(range('2025-09-01', '2025-10-31'), range('2025-11-01', null))).toBe(
      null,
    );
  });
});

describe('compareRanges и вспомогательные функции', () => {
  it('сортирует по началу, затем по концу', () => {
    expect(
      compareRanges(range('2025-09-01', '2025-12-31'), range('2026-02-01', '2026-06-30')),
    ).toBe(-1);
    expect(compareRanges(range('2025-09-01', '2025-12-31'), range('2025-09-01', null))).toBe(-1);
    expect(compareRanges(range('2025-09-01', null), range('2025-09-01', null))).toBe(0);
  });

  it('isRangeActiveOn и describeRange дают ожидаемый результат', () => {
    expect(isRangeActiveOn(range('2025-09-01', '2025-12-31'), '2025-11-05')).toBe(true);
    expect(describeRange(range('2025-09-01', '2025-12-31'))).toBe('с 2025-09-01 по 2025-12-31');
    expect(describeRange(range('2025-09-01', null))).toBe('с 2025-09-01 без даты окончания');
  });
});
