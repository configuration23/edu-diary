/**
 * Домашние задания: правила сроков и файлов (Этап 5).
 *
 * Чистые функции без базы и HTTP: правила проверяются быстро и не зависят от окружения.
 * Всё, что здесь считается, сервер обязан проверять повторно — браузеру не доверяем.
 */

/** Размер в байтах по строке вида «10» (мегабайты). */
export const MEGABYTE = 1024 * 1024;

/** Пределы настройки размера файла: диапазон задан владельцем. */
export const MIN_FILE_MB = 1;
export const MAX_FILE_MB = 50;
export const DEFAULT_FILE_MB = 10;

/**
 * Ядро запретов: типы, которые не разрешаются **никогда**, даже если администратор
 * добавит их в белый список.
 *
 * Список типов — вопрос политики заведения («нужны ли архивы»), а запрет исполняемого и
 * несущего код — вопрос безопасности. Смешивать их в одном редактируемом списке нельзя:
 * иначе настройкой можно случайно открыть дыру.
 *
 * HTML и SVG запрещены, потому что это документы с исполняемым содержимым: открытые из
 * браузера, они могут выполнить скрипт в контексте нашего домена.
 */
export const FORBIDDEN_EXTENSIONS = [
  'exe',
  'dll',
  'bat',
  'cmd',
  'com',
  'msi',
  'scr',
  'sh',
  'bash',
  'ps1',
  'js',
  'mjs',
  'jar',
  'apk',
  'html',
  'htm',
  'svg',
  'xhtml',
] as const;

/** Разрешённые по умолчанию: документы, картинки, архивы, текст. */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'txt',
  'rtf',
  'csv',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'zip',
  'rar',
  '7z',
] as const;

/**
 * Расширение файла в нижнем регистре, без точки.
 *
 * Ведущая точка — признак **скрытого файла**, а не расширение: у `.gitignore` расширения
 * нет. Иначе скрытые файлы проходили бы проверку как «файл с расширением `gitignore`», и
 * смысл белого списка размывался бы.
 */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

export interface FileRuleResult {
  allowed: boolean;
  /** Причина отказа для человека: её показываем в интерфейсе. */
  reason: string | null;
}

/**
 * Можно ли принять файл.
 *
 * Проверяем **три** вещи: размер, расширение и запретное ядро. Тип по содержимому
 * определяет хранилище при приёме — заголовку от клиента не доверяем, поэтому здесь
 * только имя и размер.
 */
export function checkFile(input: {
  fileName: string;
  sizeBytes: number;
  maxFileMb: number;
  allowedExtensions: readonly string[];
}): FileRuleResult {
  const maxBytes = input.maxFileMb * MEGABYTE;

  if (input.sizeBytes <= 0) {
    return { allowed: false, reason: 'Файл пустой' };
  }

  if (input.sizeBytes > maxBytes) {
    return {
      allowed: false,
      reason: `Файл больше ${String(input.maxFileMb)} МБ`,
    };
  }

  const extension = extensionOf(input.fileName);

  if (extension === '') {
    return { allowed: false, reason: 'У файла нет расширения' };
  }

  /** Ядро запретов сильнее белого списка: его нельзя обойти настройкой. */
  if ((FORBIDDEN_EXTENSIONS as readonly string[]).includes(extension)) {
    return { allowed: false, reason: `Тип файла .${extension} запрещён` };
  }

  if (!input.allowedExtensions.includes(extension)) {
    return { allowed: false, reason: `Тип файла .${extension} не разрешён` };
  }

  return { allowed: true, reason: null };
}

/**
 * Привести настройку размера файла к допустимому диапазону.
 *
 * Диапазон 1–50 МБ задан владельцем, значение по умолчанию — 10 МБ. Приводим на сервере:
 * настройку можно изменить, и в неё попадёт заведомо неверное число.
 */
export function normalizeMaxFileMb(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FILE_MB;
  return Math.min(MAX_FILE_MB, Math.max(MIN_FILE_MB, Math.round(value)));
}

/**
 * Опоздала ли сдача.
 *
 * Сдавать после урока-срока **можно** (решение владельца): не наказываем за задержку, но
 * показываем факт. Сравниваем по календарным датам: сданное в день срока опозданием не
 * считается.
 */
export function isLateSubmission(input: {
  /** Дата урока-срока, к которому задано. */
  dueLessonDate: string;
  /** Дата сдачи. */
  submittedOn: string;
}): boolean {
  return input.submittedOn > input.dueLessonDate;
}

/** Дата без времени: из отметки времени берём календарный день. */
export function toIsoDate(value: string | Date): string {
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}
