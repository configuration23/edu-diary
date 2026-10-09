import { describe, expect, it } from 'vitest';

import { isPasswordAcceptable, validatePassword } from '../src/password';

describe('политика паролей', () => {
  it('принимает длинный пароль без совпадений', () => {
    expect(validatePassword('tihiy-les-2025')).toEqual([]);
    expect(isPasswordAcceptable('tihiy-les-2025')).toBe(true);
  });

  it('требует минимум 10 символов', () => {
    expect(validatePassword('korotkiy')).toEqual(['пароль короче 10 символов']);
  });

  it('отвергает распространённые пароли', () => {
    expect(validatePassword('password123')).toContain('пароль входит в список распространённых');
    expect(validatePassword('QWERTY123')).toContain('пароль входит в список распространённых');
  });

  it('отвергает пароль, совпадающий с логином или содержащий его', () => {
    expect(validatePassword('ivanov.ivan', { username: 'ivanov.ivan' })).toContain(
      'пароль совпадает с логином',
    );
    expect(validatePassword('ivanov.ivan-2025', { username: 'ivanov.ivan' })).toContain(
      'пароль содержит логин',
    );
    expect(validatePassword('ivanov.ivan-2025', { username: 'iv' })).toEqual([]);
  });

  it('отвергает пароль, совпадающий с ФИО', () => {
    expect(validatePassword('иванов иван', { fullName: 'Иванов Иван' })).toContain(
      'пароль совпадает с ФИО',
    );
  });

  it('отвергает повторяющийся символ и пробелы по краям', () => {
    expect(validatePassword('aaaaaaaaaaaa')).toContain(
      'пароль состоит из одного повторяющегося символа',
    );
    expect(validatePassword(' tihiy-les-2025')).toContain(
      'пароль не должен начинаться или заканчиваться пробелом',
    );
  });

  it('собирает все нарушения сразу', () => {
    const issues = validatePassword('secret', { username: 'secret' });
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it('позволяет изменить минимальную длину', () => {
    expect(validatePassword('korotkiy', { minLength: 4 })).toEqual([]);
  });
});
