import { describe, expect, it } from 'vitest';

import {
  createAssignmentRequestSchema,
  createGradeCategoryRequestSchema,
  createGroupRequestSchema,
  enrollStudentRequestSchema,
  studyGroupSchema,
  transferStudentRequestSchema,
  updateAssignmentRequestSchema,
  updateBrandingRequestSchema,
} from '../src/academics';

/**
 * Контракты Этапа 2: группы, зачисления, назначения, справочники и брендинг.
 * Проверяются ровно те границы, которые сервер обязан отвергать: даты, коды,
 * ссылки на изображения.
 *
 * Идентификаторы подставляет собственный счётчик, а не `node:crypto`: пакет
 * `contracts` общий для сервера и браузера, и типов Node в нём нет намеренно.
 */

let sequence = 0;

function id(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

describe('studyGroupSchema', () => {
  const valid = {
    id: id(),
    academicYearId: id(),
    name: 'ПКС-21',
    course: 2,
    specialty: 'Программирование в компьютерных системах',
    curatorUserId: null,
    startsOn: '2025-09-01',
    endsOn: '2026-06-30',
  };

  it('подставляет нулевое число учеников, если оно не передано', () => {
    const parsed = studyGroupSchema.parse(valid);
    expect(parsed.studentsCount).toBe(0);
  });

  it('отвергает дату не в календарном формате', () => {
    expect(studyGroupSchema.safeParse({ ...valid, startsOn: '01.09.2025' }).success).toBe(false);
  });

  it('требует действующий идентификатор года', () => {
    expect(studyGroupSchema.safeParse({ ...valid, academicYearId: 'year-1' }).success).toBe(false);
  });
});

describe('createGroupRequestSchema', () => {
  const base = {
    academicYearId: id(),
    name: 'ИС-31',
    startsOn: '2025-09-01',
    endsOn: '2026-06-30',
  };

  it('принимает минимальный набор полей', () => {
    expect(createGroupRequestSchema.safeParse(base).success).toBe(true);
  });

  it('отвергает курс вне допустимого диапазона', () => {
    expect(createGroupRequestSchema.safeParse({ ...base, course: 0 }).success).toBe(false);
    expect(createGroupRequestSchema.safeParse({ ...base, course: 7 }).success).toBe(false);
  });

  it('отвергает пустое имя и дату не в формате', () => {
    expect(createGroupRequestSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(createGroupRequestSchema.safeParse({ ...base, endsOn: '30.06.2026' }).success).toBe(
      false,
    );
  });
});

describe('зачисления и перевод', () => {
  it('требует ученика и дату зачисления', () => {
    expect(
      enrollStudentRequestSchema.safeParse({ studentId: id(), joinedOn: '2025-09-01' }).success,
    ).toBe(true);
    expect(enrollStudentRequestSchema.safeParse({ joinedOn: '2025-09-01' }).success).toBe(false);
  });

  it('для перевода требует группу и дату', () => {
    expect(
      transferStudentRequestSchema.safeParse({
        studyGroupId: id(),
        transferOn: '2026-01-12',
      }).success,
    ).toBe(true);
    expect(transferStudentRequestSchema.safeParse({ transferOn: '2026-01-12' }).success).toBe(
      false,
    );
  });
});

describe('назначения', () => {
  const base = {
    teacherUserId: id(),
    subjectId: id(),
    studyGroupId: id(),
    startsOn: '2025-09-01',
  };

  it('принимает назначение без даты окончания (действует до закрытия)', () => {
    const parsed = createAssignmentRequestSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it('отвергает окончание раньше начала', () => {
    const parsed = createAssignmentRequestSchema.safeParse({ ...base, endsOn: '2025-08-31' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['endsOn']);
  });

  it('принимает совпадение начала и окончания', () => {
    expect(createAssignmentRequestSchema.safeParse({ ...base, endsOn: '2025-09-01' }).success).toBe(
      true,
    );
  });

  it('отвергает пустую правку и ограничивает часы', () => {
    expect(updateAssignmentRequestSchema.safeParse({}).success).toBe(false);
    expect(updateAssignmentRequestSchema.safeParse({ hoursPlanned: 0 }).success).toBe(false);
    expect(updateAssignmentRequestSchema.safeParse({ hoursPlanned: 120 }).success).toBe(true);
  });
});

describe('createGradeCategoryRequestSchema', () => {
  it('подставляет вес 1 и проверяет код', () => {
    const parsed = createGradeCategoryRequestSchema.parse({
      code: 'project',
      title: 'Проект',
    });
    expect(parsed.weight).toBe(1);

    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'Проект', title: 'Проект' }).success,
    ).toBe(false);
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: '2project', title: 'Проект' }).success,
    ).toBe(false);
  });

  it('ограничивает вес среднего балла', () => {
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'test', title: 'Тест', weight: 11 })
        .success,
    ).toBe(false);
  });
});

describe('updateBrandingRequestSchema', () => {
  it('запрещает внешнюю ссылку вместо логотипа (ADR-019)', () => {
    expect(
      updateBrandingRequestSchema.safeParse({ logoDataUrl: 'https://cdn.example.ru/logo.png' })
        .success,
    ).toBe(false);
  });

  it('принимает data URL изображения и обычный текст', () => {
    expect(
      updateBrandingRequestSchema.safeParse({
        title: 'Колледж связи',
        logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }).success,
    ).toBe(true);
  });

  it('отвергает пустую правку', () => {
    expect(updateBrandingRequestSchema.safeParse({}).success).toBe(false);
  });
});
