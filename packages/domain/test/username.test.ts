import { describe, expect, it } from 'vitest';

import {
  baseUsernameFromFullName,
  MAX_USERNAME_ATTEMPTS,
  suggestUsername,
  transliterate,
} from '../src/username';

/**
 * Логины из ФИО: правило должно быть предсказуемым, а занятые логины — не
 * ломать создание пользователя, а получать цифровой суффикс.
 */

describe('transliterate', () => {
  it('переводит кириллицу в латиницу', () => {
    expect(transliterate('Чумаков')).toBe('chumakov');
    expect(transliterate('Сергей')).toBe('sergey');
    expect(transliterate('Юлия')).toBe('yuliya');
    expect(transliterate('Щёголев')).toBe('schegolev');
  });

  it('отбрасывает всё, что недопустимо в логине', () => {
    expect(transliterate('Петров-Водкин')).toBe('petrovvodkin');
    expect(transliterate('Анна Мария')).toBe('annamariya');
    expect(transliterate('  ')).toBe('');
  });
});

describe('baseUsernameFromFullName', () => {
  it('строит логин из фамилии и инициалов', () => {
    expect(baseUsernameFromFullName('Чумаков Сергей Петрович')).toBe('chumakovsp');
    expect(baseUsernameFromFullName('Чумаков Сергей')).toBe('chumakovs');
    expect(baseUsernameFromFullName('Чумаков')).toBe('chumakov');
  });

  it('работает с латиницей и лишними пробелами', () => {
    expect(baseUsernameFromFullName('  Ivanov   Petr  ')).toBe('ivanovp');
  });

  it('возвращает null, если логин не получается', () => {
    expect(baseUsernameFromFullName('')).toBeNull();
    expect(baseUsernameFromFullName('Я')).toBeNull();
    expect(baseUsernameFromFullName('Ъ Ь')).toBeNull();
  });
});

describe('suggestUsername', () => {
  it('отдаёт базовый логин, если он свободен', () => {
    const result = suggestUsername('Чумаков Сергей Петрович', () => false);

    expect(result.username).toBe('chumakovsp');
    expect(result.taken).toEqual([]);
  });

  it('добавляет цифру, если логин занят', () => {
    const busy = new Set(['chumakovsp', 'chumakovsp1']);

    const result = suggestUsername('Чумаков Сергей Петрович', (name) => busy.has(name));

    expect(result.username).toBe('chumakovsp2');
    expect(result.taken).toEqual(['chumakovsp', 'chumakovsp1']);
  });

  it('сдаётся, когда свободных вариантов нет', () => {
    const result = suggestUsername('Чумаков Сергей Петрович', () => true);

    expect(result.username).toBeNull();
    expect(result.taken).toHaveLength(MAX_USERNAME_ATTEMPTS + 1);
  });

  it('не предлагает логин из неподходящего ФИО', () => {
    expect(suggestUsername('Я', () => false)).toEqual({ username: null, taken: [] });
  });
});
