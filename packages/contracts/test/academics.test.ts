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
import { requiredISODateSchema } from '../src/common';

describe('requiredISODateSchema (даты в формах)', () => {
  it('принимает существующие даты, включая високосный день', () => {
    expect(requiredISODateSchema.safeParse('2026-02-28').success).toBe(true);
    expect(requiredISODateSchema.safeParse('2024-02-29').success).toBe(true);
  });

  it('отвергает несуществующие даты, которые пропускал регексп', () => {
    // Раньше в формах стояла проверка вида ГГГГ-ММ-ДД: «31 февраля» проходило.
    const impossible = ['2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10', '2023-02-29'];

    for (const value of impossible) {
      const parsed = requiredISODateSchema.safeParse(value);
      expect(parsed.success, `${value} должна быть отвергнута`).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toContain('не существует');
      }
    }
  });

  it('отвергает пустое значение и другой формат', () => {
    for (const value of ['', '31.02.2026', '2026-2-1', 'вчера']) {
      expect(requiredISODateSchema.safeParse(value).success, `${value}`).toBe(false);
    }
  });

  it('требует строку', () => {
    expect(requiredISODateSchema.safeParse(undefined).success).toBe(false);
    expect(requiredISODateSchema.safeParse(20260228).success).toBe(false);
  });
});

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
  it('подставляет вес 1 и требует код до двух символов', () => {
    const parsed = createGradeCategoryRequestSchema.parse({
      code: 'Пр',
      title: 'Проект',
    });
    expect(parsed.weight).toBe(1);

    // Код длиннее двух символов не влезет в журнал рядом с оценкой.
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'Проект', title: 'Проект' }).success,
    ).toBe(false);
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'ДЗШ', title: 'Домашнее задание' })
        .success,
    ).toBe(false);
    // Один символ и цифры допустимы: «К», «1».
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'К', title: 'Контрольная' }).success,
    ).toBe(true);
    expect(createGradeCategoryRequestSchema.safeParse({ code: '1', title: 'Первый' }).success).toBe(
      true,
    );
    // Пробелы и знаки препинания в коде не нужны.
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'Д З', title: 'Домашнее' }).success,
    ).toBe(false);
  });

  it('ограничивает вес среднего балла целым от 1 до 5', () => {
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'Т', title: 'Тест', weight: 6 }).success,
    ).toBe(false);
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'Т', title: 'Тест', weight: 0 }).success,
    ).toBe(false);
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'Т', title: 'Тест', weight: 2.5 }).success,
    ).toBe(false);
    expect(
      createGradeCategoryRequestSchema.safeParse({ code: 'Т', title: 'Тест', weight: 5 }).success,
    ).toBe(true);
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
