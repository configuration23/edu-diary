/**
 * Имя загружаемого файла.
 *
 * Владелец: «дата_логинавтора_предмет.расширение», от исходного имени остаётся только расширение.
 *
 * Причина: имя приходит от клиента и хранится как есть — через него проходили `../`, управляющие
 * символы и просто нечитаемые имена. Здесь имя **строится** из известных серверу значений, поэтому
 * подставить в него что-то своё нельзя.
 */

/** Транслитерация для имени файла: кириллица в именах ломает архивы и часть клиентов. */
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
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * Безопасная часть имени: только латиница, цифры и дефис.
 *
 * Всё остальное — включая `.`, `/`, `\` и управляющие символы — схлопывается в дефис. Точка в
 * имени не остаётся никогда, поэтому `..%2f..%2fevil` превращается в `evil`, но не в путь.
 */
export function slugifyNamePart(value: string, fallback: string, maxLength = 40): string {
  const transliterated = [...value.toLowerCase()]
    .map((char) => TRANSLITERATION[char] ?? char)
    .join('');

  const slug = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');

  return slug === '' ? fallback : slug;
}

/** Расширение из имени клиента: только буквы и цифры, не длиннее восьми знаков. */
export function safeExtension(originalFileName: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(originalFileName.trim());
  const extension = match?.[1]?.toLowerCase() ?? '';

  return extension === '' ? 'bin' : extension;
}

export interface UploadNameInput {
  /** Когда файл загружен: дата входит в имя. */
  at: Date;
  /** Логин автора загрузки. */
  login: string;
  /** Предмет задания; если неизвестен — «bez-predmeta». */
  subjectName?: string | null;
  /** Имя, которое прислал клиент: берём **только** расширение. */
  originalFileName: string;
}

/**
 * Имя файла: `ГГГГ-ММ-ДД_логин_предмет.расширение`.
 *
 * Дата — по UTC: одинаковое имя не должно зависеть от часового пояса сервера.
 */
export function buildUploadName(input: UploadNameInput): string {
  const date = input.at.toISOString().slice(0, 10);
  const login = slugifyNamePart(input.login, 'avtor', 24);
  const subject = slugifyNamePart(input.subjectName ?? '', 'bez-predmeta', 40);
  const extension = safeExtension(input.originalFileName);

  return `${date}_${login}_${subject}.${extension}`;
}
