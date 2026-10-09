/**
 * Политика паролей (SECURITY.md §3.1): минимум 10 символов, пароль не совпадает
 * с логином и не входит в список распространённых. Требований к «сложности»
 * (обязательные цифры и заглавные буквы) намеренно нет — они толкают к
 * предсказуемым паролям вида `Password1!`.
 */

export const DEFAULT_MIN_PASSWORD_LENGTH = 10;

/** Небольшой список самых частых паролей: основную работу делает длина. */
const COMMON_PASSWORDS = new Set([
  '123456789',
  '1234567890',
  '12345678',
  'qwertyuiop',
  'qwerty123',
  'password',
  'password1',
  'password123',
  'parol12345',
  'passw0rd',
  'letmein123',
  'iloveyou',
  'admin12345',
  'administrator',
  'welcome123',
  'kollekciya',
  'qazwsxedc',
  '1qaz2wsx3edc',
  'abc123456789',
  'student2025',
]);

export interface PasswordPolicyOptions {
  /** Логин, с которым сравнивается пароль. */
  username?: string | null;
  /** ФИО: пароль не должен целиком совпадать с ним. */
  fullName?: string | null;
  minLength?: number;
}

/** Возвращает список нарушений; пустой список — пароль допустим. */
export function validatePassword(password: string, options: PasswordPolicyOptions = {}): string[] {
  const issues: string[] = [];
  const minLength = options.minLength ?? DEFAULT_MIN_PASSWORD_LENGTH;
  const normalized = password.toLowerCase();

  if (password.length < minLength) {
    issues.push(`пароль короче ${minLength} символов`);
  }

  if (password.trim().length !== password.length) {
    issues.push('пароль не должен начинаться или заканчиваться пробелом');
  }

  if (COMMON_PASSWORDS.has(normalized)) {
    issues.push('пароль входит в список распространённых');
  }

  const username = options.username?.trim().toLowerCase();
  if (username !== undefined && username !== '') {
    if (normalized === username) {
      issues.push('пароль совпадает с логином');
    } else if (username.length >= 4 && normalized.includes(username)) {
      issues.push('пароль содержит логин');
    }
  }

  const fullName = options.fullName?.trim().toLowerCase();
  if (fullName !== undefined && fullName !== '' && normalized === fullName) {
    issues.push('пароль совпадает с ФИО');
  }

  if (new Set(password).size === 1 && password.length > 0) {
    issues.push('пароль состоит из одного повторяющегося символа');
  }

  return issues;
}

export function isPasswordAcceptable(
  password: string,
  options: PasswordPolicyOptions = {},
): boolean {
  return validatePassword(password, options).length === 0;
}
