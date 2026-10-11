/**
 * Код предмета для компактных плиток расписания.
 *
 * В месячной сетке места хватает на 2–4 символа, поэтому код вычисляется: если в
 * справочнике заполнено «Короткое имя» и оно укладывается в лимит — берём его,
 * иначе выводим код из названия. Жёсткого требования к справочнику нет: старые
 * предметы без короткого имени тоже получат код.
 */

/** Максимальная длина кода: больше не влезает в плитку месяца. */
export const SUBJECT_CODE_MAX_LENGTH = 4;

/** Что убираем из названия перед разбором на слова. */
const DROP_PATTERN = /[^\p{L}\p{N}\s-]/gu;

/**
 * Уточнения в скобках убираем: «Базы данных (профиль)» и «Базы данных» — один
 * предмет, и код у них должен совпадать, иначе плитки одного предмета разъедутся.
 */
function normalizeWords(value: string): string[] {
  return value
    .replace(/\([^)]*\)/g, ' ')
    .replace(DROP_PATTERN, ' ')
    .split(/[\s-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

/**
 * Код предмета: короткое имя, если оно подходит, иначе вывод из названия.
 *
 * - «Основы программирования» → «ОП» (по первым буквам слов);
 * - «Математика» → «МАТЕ» (одно слово: первые буквы);
 * - «Базы данных (профиль)» → «БД» (скобки не мешают);
 * - пустое название → пустая строка: интерфейс покажет название целиком.
 */
export function subjectCode(name: string, shortName?: string | null): string {
  const short = shortName?.trim() ?? '';
  if (short.length > 0 && short.length <= SUBJECT_CODE_MAX_LENGTH) {
    return short.toUpperCase();
  }

  const words = normalizeWords(name);
  if (words.length === 0) return '';

  // Несколько слов — код по первым буквам; одно слово — первые буквы самого слова.
  const code =
    words.length > 1
      ? words.map((word) => word[0] ?? '').join('')
      : (words[0] ?? '').slice(0, SUBJECT_CODE_MAX_LENGTH);

  return code.slice(0, SUBJECT_CODE_MAX_LENGTH).toUpperCase();
}
