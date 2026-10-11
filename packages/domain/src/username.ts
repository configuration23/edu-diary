/**
 * Логины из ФИО: транслитерация и подбор свободного варианта.
 *
 * Правило простое и предсказуемое: фамилия + инициалы имени и отчества
 * («Чумаков Сергей Петрович» → `chumakovsp`). Если такой логин занят, к нему
 * добавляется цифра: `chumakovsp1`, `chumakovsp2`, … Правило живёт в домене, а
 * не в интерфейсе, чтобы одинаково работать и для ручного ввода, и для импорта.
 */

/** ГОСТ-подобная транслитерация: кириллица → латиница. */
const TRANSLITERATION: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Минимальная длина логина: короче не проходит проверку контракта. */
export const MIN_USERNAME_LENGTH = 3;
/** Сколько цифр перебираем, прежде чем сдаться. */
export const MAX_USERNAME_ATTEMPTS = 20;

/** Переводит строку в латиницу, оставляя только допустимые символы логина. */
export function transliterate(value: string): string {
  const lower = value.toLowerCase();
  let result = '';

  for (const char of lower) {
    const mapped = TRANSLITERATION[char];
    if (mapped !== undefined) {
      result += mapped;
      continue;
    }

    // Латиница и цифры переносятся как есть; всё прочее (пробелы, дефисы,
    // знаки) отбрасываем — логин состоит только из допустимых символов.
    if (/[a-z0-9]/.test(char)) result += char;
  }

  return result;
}

/**
 * Базовый логин по ФИО без учёта занятости.
 *
 * Фамилия берётся целиком, от имени и отчества — только первые буквы. Если
 * отчество не указано, логин короче: «Чумаков Сергей» → `chumakovs`.
 * `null` — если после транслитерации не осталось допустимых символов.
 */
export function baseUsernameFromFullName(fullName: string): string | null {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '');

  if (parts.length === 0) return null;

  const [surname, ...rest] = parts as [string, ...string[]];
  const initials = rest.map((part) => part.slice(0, 1)).join('');
  const candidate = `${transliterate(surname)}${transliterate(initials)}`;

  return candidate.length >= MIN_USERNAME_LENGTH ? candidate : null;
}

/**
 * Подбирает свободный логин по ФИО, зная список занятых.
 *
 * Список передаётся готовым: занятость проверяет хранилище (один запрос к базе),
 * а правило подбора остаётся чистым и проверяемым. `null` — из ФИО логин не
 * получается или заняты все варианты до `MAX_USERNAME_ATTEMPTS`: тогда
 * администратор вводит логин сам.
 */
export function suggestUsername(
  fullName: string,
  takenUsernames: Iterable<string>,
): { username: string | null; taken: string[] } {
  const base = baseUsernameFromFullName(fullName);
  if (base === null) return { username: null, taken: [] };

  const taken = new Set([...takenUsernames].map((name) => name.toLowerCase()));
  const skipped: string[] = [];

  if (!taken.has(base)) return { username: base, taken: skipped };

  skipped.push(base);

  for (let index = 1; index <= MAX_USERNAME_ATTEMPTS; index += 1) {
    const candidate = `${base}${index}`;
    if (!taken.has(candidate)) return { username: candidate, taken: skipped };
    skipped.push(candidate);
  }

  return { username: null, taken: skipped };
}

/**
 * Возвращает `base` и все варианты с цифрами — их и запрашиваем у хранилища,
 * чтобы одним запросом узнать занятость.
 */
export function usernameCandidates(fullName: string): string[] {
  const base = baseUsernameFromFullName(fullName);
  if (base === null) return [];

  const candidates = [base];
  for (let index = 1; index <= MAX_USERNAME_ATTEMPTS; index += 1) {
    candidates.push(`${base}${index}`);
  }

  return candidates;
}
