import { describe, expect, it } from 'vitest';

import {
  ATTENDANCE_STATUSES,
  attendanceBreakdown,
  countSigns,
  escalationState,
  isAttendanceStatus,
  isMarkSign,
  isMarkValue,
  markNumber,
  pendingApplications,
  weightedAverage,
  type AttendanceMark,
} from '../src/journal';

/**
 * Правила журнала: оценки, знаки и посещаемость.
 *
 * Тесты фиксируют то, что нельзя проверить в интерфейсе: как считаются средний балл
 * с весами, проценты посещаемости и идемпотентность правила «плюсы/точки → оценка».
 */

describe('оценки и знаки', () => {
  it('числовые оценки и знаки различаются', () => {
    expect(isMarkValue('5')).toBe(true);
    expect(isMarkValue('plus')).toBe(false);
    expect(isMarkSign('plus')).toBe(true);
    expect(isMarkSign('dot')).toBe(true);
    expect(isMarkSign('5')).toBe(false);
  });

  it('число есть только у оценки: у знака — null', () => {
    expect(markNumber('4')).toBe(4);
    expect(markNumber('plus')).toBeNull();
    expect(markNumber('dot')).toBeNull();
  });
});

describe('средний балл с весами', () => {
  it('считает среднее с учётом веса категории', () => {
    // 5 с весом 2 и 3 с весом 1 → (5*2 + 3*1) / 3 = 4.33
    expect(
      weightedAverage([
        { value: '5', weight: 2 },
        { value: '3', weight: 1 },
      ]),
    ).toBe(4.33);
  });

  it('знаки в средний балл не входят', () => {
    expect(
      weightedAverage([
        { value: '4', weight: 1 },
        { value: 'plus', weight: 1 },
        { value: 'dot', weight: 2 },
      ]),
    ).toBe(4);
  });

  it('без числовых оценок возвращает null, а не ноль', () => {
    expect(weightedAverage([{ value: 'plus', weight: 1 }])).toBeNull();
    expect(weightedAverage([])).toBeNull();
  });

  it('нулевой или отрицательный вес считается единицей', () => {
    expect(
      weightedAverage([
        { value: '5', weight: 0 },
        { value: '3', weight: 1 },
      ]),
    ).toBe(4);
  });
});

describe('посещаемость', () => {
  const marks = (statuses: AttendanceMark['status'][]): AttendanceMark[] =>
    statuses.map((status) => ({ status }));

  it('статусы проверяются по списку', () => {
    expect(isAttendanceStatus('present')).toBe(true);
    expect(isAttendanceStatus('опоздал')).toBe(false);
  });

  it('считает проценты по всем статусам и общий процент «был»', () => {
    const result = attendanceBreakdown(
      marks(['present', 'present', 'absent', 'sick', 'absent', 'present', 'excused', 'late']),
    );

    expect(result.total).toBe(8);
    // Был 3 из 8 → 37.5 %
    expect(result.percent).toBe(37.5);
    expect(result.byStatus.present.count).toBe(3);
    expect(result.byStatus.absent.percent).toBe(25);
    expect(result.byStatus.sick.percent).toBe(12.5);
    expect(Object.keys(result.byStatus).sort()).toEqual([...ATTENDANCE_STATUSES].sort());
  });

  it('без отметок проценты нулевые, а не деление на ноль', () => {
    const result = attendanceBreakdown([]);
    expect(result.total).toBe(0);
    expect(result.percent).toBe(0);
    expect(result.byStatus.present.percent).toBe(0);
  });
});

describe('правило «плюсы и точки → оценка»', () => {
  it('считает накопление знаков', () => {
    expect(
      countSigns([{ sign: 'plus' }, { sign: 'plus' }, { sign: 'dot' }, { sign: null }]),
    ).toEqual({ plus: 2, dot: 1 });
  });

  it('четыре плюса дают одно срабатывание, остаток — ноль', () => {
    expect(
      escalationState({ plus: 4, dot: 0 }, { sign: 'plus', threshold: 4, reward: '5' }),
    ).toEqual({ applications: 1, remaining: 0 });
  });

  it('лишние знаки переносятся в остаток', () => {
    expect(
      escalationState({ plus: 6, dot: 0 }, { sign: 'plus', threshold: 4, reward: '5' }),
    ).toEqual({ applications: 1, remaining: 2 });
  });

  it('плюсы и точки считаются раздельно', () => {
    const rule = { sign: 'dot', threshold: 3, reward: '3' } as const;
    const counts = { plus: 10, dot: 2 };
    expect(escalationState(counts, rule)).toEqual({ applications: 0, remaining: 2 });
  });

  it('повторный расчёт по тем же данным ничего не меняет', () => {
    const counts = { plus: 9, dot: 0 };
    const rule = { sign: 'plus', threshold: 4, reward: '5' } as const;

    const first = escalationState(counts, rule);
    const second = escalationState(counts, rule);

    expect(second).toEqual(first);
    // Уже записано одно срабатывание: пересчёт не создаёт второе.
    expect(pendingApplications(1, first)).toBe(1);

    // А если записаны оба — новых нет.
    expect(pendingApplications(2, first)).toBe(0);
  });

  it('порог меньше единицы не срабатывает никогда', () => {
    expect(
      escalationState({ plus: 10, dot: 0 }, { sign: 'plus', threshold: 0, reward: '5' }),
    ).toEqual({ applications: 0, remaining: 10 });
  });
});
