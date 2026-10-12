import { describe, expect, it } from 'vitest';

import { SUBJECT_CODE_MAX_LENGTH, subjectCode } from '../src/subject-code';

/**
 * Код предмета для плиток расписания: короткое имя из справочника или вывод из
 * названия. Тесты фиксируют поведение на реальных названиях СПО.
 */

describe('код предмета', () => {
  it('берёт короткое имя, если оно укладывается в лимит', () => {
    expect(subjectCode('Основы программирования', 'ОП')).toBe('ОП');
    expect(subjectCode('Базы данных', 'БД')).toBe('БД');
  });

  it('игнорирует короткое имя длиннее лимита и выводит код из названия', () => {
    expect(subjectCode('Базы данных', 'Базы данных профиль')).toBe('БД');
    expect(subjectCode('Математика', 'Математика')).toBe('МАТЕ');
  });

  it('выводит код по первым буквам слов', () => {
    expect(subjectCode('Основы программирования')).toBe('ОП');
    expect(subjectCode('Базы данных')).toBe('БД');
    expect(subjectCode('Технология машиностроения')).toBe('ТМ');
  });

  it('обрезает длинный код по числу слов', () => {
    const code = subjectCode('Архитектура вычислительных систем и сетей');
    expect(code.length).toBeLessThanOrEqual(SUBJECT_CODE_MAX_LENGTH);
    expect(code).toBe('АВСИ');
  });

  it('для одного слова берёт первые буквы', () => {
    expect(subjectCode('Математика')).toBe('МАТЕ');
    expect(subjectCode('Информатика')).toBe('ИНФО');
  });

  it('не спотыкается на скобках, знаках и лишних пробелах', () => {
    expect(subjectCode('Базы данных (профиль)')).toBe('БД');
    expect(subjectCode('  Основы   алгоритмов  ')).toBe('ОА');
    expect(subjectCode('Физика, часть 2')).toBe('ФЧ2');
  });

  it('возвращает пустую строку, если название пустое', () => {
    expect(subjectCode('')).toBe('');
    expect(subjectCode('   ', '  ')).toBe('');
  });

  it('приводит короткое имя к верхнему регистру', () => {
    expect(subjectCode('Основы программирования', 'оп')).toBe('ОП');
  });
});
