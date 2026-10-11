import { describe, expect, it } from 'vitest';

import {
  createScheduleEntryRequestSchema,
  createSubstitutionRequestSchema,
  generateLessonsRequestSchema,
  listScheduleQuerySchema,
  scheduleEntrySchema,
  updateLessonRequestSchema,
} from '../src/schedule';

/**
 * Контракты расписания: проверяются границы, которые сервер обязан отвергать
 * (время, номера пар, порядок дат), и обязательность полей замены.
 */

const uuid = (suffix: string) => `01a12c00-0000-7000-8000-0000000000${suffix}`;

describe('createScheduleEntryRequestSchema', () => {
  const valid = {
    assignmentId: uuid('01'),
    dayOfWeek: 2,
    pairNumber: 3,
    timeStart: '11:30',
    timeEnd: '13:00',
    validFrom: '2026-09-01',
  };

  it('принимает корректный шаблон', () => {
    expect(createScheduleEntryRequestSchema.safeParse(valid).success).toBe(true);
    // Аудитория и конец периода необязательны.
    expect(
      createScheduleEntryRequestSchema.safeParse({ ...valid, roomId: null, validTo: null }).success,
    ).toBe(true);
  });

  it('отвергает время наоборот и неверный формат', () => {
    expect(
      createScheduleEntryRequestSchema.safeParse({ ...valid, timeStart: '13:00', timeEnd: '11:30' })
        .success,
    ).toBe(false);
    expect(
      createScheduleEntryRequestSchema.safeParse({ ...valid, timeStart: '9:30' }).success,
    ).toBe(false);
    expect(createScheduleEntryRequestSchema.safeParse({ ...valid, timeEnd: '25:00' }).success).toBe(
      false,
    );
  });

  it('отвергает пару вне 1–8 и день вне 1–7', () => {
    expect(createScheduleEntryRequestSchema.safeParse({ ...valid, pairNumber: 0 }).success).toBe(
      false,
    );
    expect(createScheduleEntryRequestSchema.safeParse({ ...valid, pairNumber: 9 }).success).toBe(
      false,
    );
    expect(createScheduleEntryRequestSchema.safeParse({ ...valid, dayOfWeek: 8 }).success).toBe(
      false,
    );
  });

  it('отвергает период действия наоборот', () => {
    expect(
      createScheduleEntryRequestSchema.safeParse({
        ...valid,
        validFrom: '2026-12-01',
        validTo: '2026-09-01',
      }).success,
    ).toBe(false);
  });
});

describe('generateLessonsRequestSchema', () => {
  it('период генерации: начало не позже окончания', () => {
    expect(
      generateLessonsRequestSchema.safeParse({ from: '2026-09-01', to: '2026-09-30' }).success,
    ).toBe(true);
    expect(
      generateLessonsRequestSchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success,
    ).toBe(false);
  });
});

describe('createSubstitutionRequestSchema', () => {
  it('замена на один урок — достаточно урока и причины', () => {
    expect(
      createSubstitutionRequestSchema.safeParse({
        lessonId: uuid('02'),
        substituteUserId: uuid('03'),
        reason: 'Болезнь преподавателя',
      }).success,
    ).toBe(true);
  });

  it('замена на период требует назначение и дату начала', () => {
    expect(
      createSubstitutionRequestSchema.safeParse({
        assignmentId: uuid('04'),
        substituteUserId: uuid('03'),
        reason: 'Отпуск',
      }).success,
    ).toBe(false);

    expect(
      createSubstitutionRequestSchema.safeParse({
        assignmentId: uuid('04'),
        substituteUserId: uuid('03'),
        startsOn: '2026-10-01',
        endsOn: '2026-10-14',
        reason: 'Отпуск',
      }).success,
    ).toBe(true);
  });

  it('без урока и назначения замена бессмысленна', () => {
    expect(
      createSubstitutionRequestSchema.safeParse({
        substituteUserId: uuid('03'),
        reason: 'Неизвестно что заменяем',
      }).success,
    ).toBe(false);
  });

  it('причина обязательна: история «почему» — часть решения (ADR-009)', () => {
    expect(
      createSubstitutionRequestSchema.safeParse({
        lessonId: uuid('02'),
        substituteUserId: uuid('03'),
        reason: '',
      }).success,
    ).toBe(false);
  });
});

describe('прочие схемы расписания', () => {
  it('шаблон в ответе содержит имена: интерфейсу не нужны дополнительные запросы', () => {
    const parsed = scheduleEntrySchema.safeParse({
      id: uuid('05'),
      assignmentId: uuid('01'),
      studyGroupId: uuid('06'),
      groupName: 'ПКС-21',
      subjectId: uuid('07'),
      subjectName: 'Основы программирования',
      teacherUserId: uuid('08'),
      teacherName: 'Никитин Пётр Олегович',
      roomId: null,
      roomName: null,
      dayOfWeek: 2,
      pairNumber: 3,
      timeStart: '11:30',
      timeEnd: '13:00',
      validFrom: '2026-09-01',
      validTo: null,
    });

    expect(parsed.success).toBe(true);
  });

  it('правка урока требует хотя бы одно поле', () => {
    expect(updateLessonRequestSchema.safeParse({}).success).toBe(false);
    expect(updateLessonRequestSchema.safeParse({ topic: 'Введение' }).success).toBe(true);
  });

  it('список расписания фильтруется по группе, преподавателю или ученику', () => {
    expect(listScheduleQuerySchema.safeParse({}).success).toBe(true);
    expect(listScheduleQuerySchema.safeParse({ studyGroupId: uuid('06') }).success).toBe(true);
    expect(listScheduleQuerySchema.safeParse({ studyGroupId: 'не-uuid' }).success).toBe(false);
  });
});
