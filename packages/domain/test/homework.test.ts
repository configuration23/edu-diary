import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILE_MB,
  FORBIDDEN_EXTENSIONS,
  MAX_FILE_MB,
  MEGABYTE,
  MIN_FILE_MB,
  checkFile,
  extensionOf,
  isLateSubmission,
  normalizeMaxFileMb,
  DEFAULT_ALLOWED_EXTENSIONS,
} from '../src/homework';

/**
 * Правила домашних заданий: сроки, опоздание и приём файлов.
 *
 * Здесь проверяются решения, которые сервер обязан соблюдать сам: браузеру не доверяем, а
 * запрет опасных типов не должен обходиться настройкой.
 */

describe('приём файлов', () => {
  const base = {
    maxFileMb: 10,
    allowedExtensions: DEFAULT_ALLOWED_EXTENSIONS,
  };

  it('обычный документ принимается', () => {
    const result = checkFile({ ...base, fileName: 'задача.docx', sizeBytes: MEGABYTE });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('файл больше лимита отклоняется с понятной причиной', () => {
    const result = checkFile({
      ...base,
      fileName: 'скан.pdf',
      sizeBytes: 11 * MEGABYTE,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('больше 10 МБ');
  });

  it('ровно на границе лимита файл проходит', () => {
    const result = checkFile({
      ...base,
      fileName: 'ровно.pdf',
      sizeBytes: 10 * MEGABYTE,
    });

    expect(result.allowed).toBe(true);
  });

  it('пустой файл отклоняется', () => {
    const result = checkFile({ ...base, fileName: 'пусто.txt', sizeBytes: 0 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('пустой');
  });

  it('файл без расширения отклоняется', () => {
    const result = checkFile({ ...base, fileName: 'документ', sizeBytes: 100 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('расширения');
  });

  it('тип вне белого списка отклоняется', () => {
    const result = checkFile({ ...base, fileName: 'чертёж.dwg', sizeBytes: 100 });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('не разрешён');
  });

  it('запретное ядро нельзя обойти настройкой', () => {
    /**
     * Администратор добавил `.exe` в белый список — приём всё равно должен отказать:
     * список типов это политика заведения, а запрет исполняемого — безопасность.
     */
    const result = checkFile({
      fileName: 'программа.exe',
      sizeBytes: 100,
      maxFileMb: 10,
      allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS, 'exe'],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('запрещён');
  });

  it('все запрещённые типы отклоняются, даже если их разрешить', () => {
    for (const extension of FORBIDDEN_EXTENSIONS) {
      const result = checkFile({
        fileName: `файл.${extension}`,
        sizeBytes: 100,
        maxFileMb: 10,
        allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS, extension],
      });

      expect(result.allowed, `.${extension} должен быть запрещён`).toBe(false);
    }
  });

  it('регистр расширения не важен', () => {
    const result = checkFile({ ...base, fileName: 'ФОТО.JPG', sizeBytes: 100 });

    expect(result.allowed).toBe(true);
  });

  it('расширение определяется по последней точке', () => {
    expect(extensionOf('архив.tar.gz')).toBe('gz');
    expect(extensionOf('без_точки')).toBe('');
    /**
     * Ведущая точка — признак скрытого файла, а не расширение. Иначе `.gitignore`
     * прошёл бы проверку как «файл с расширением gitignore», и белый список потерял бы
     * смысл: под скрытым именем можно было бы протащить что угодно.
     */
    expect(extensionOf('.скрытый')).toBe('');
  });
});

describe('настройка размера файла', () => {
  it('приводится к диапазону 1–50 МБ', () => {
    expect(normalizeMaxFileMb(0)).toBe(MIN_FILE_MB);
    expect(normalizeMaxFileMb(100)).toBe(MAX_FILE_MB);
    expect(normalizeMaxFileMb(10.4)).toBe(10);
    expect(normalizeMaxFileMb(Number.NaN)).toBe(DEFAULT_FILE_MB);
  });
});

describe('срок сдачи и опоздание', () => {
  it('сдача после урока-срока помечается опозданием', () => {
    /**
     * Задание к занятию 15-го, принесли 16-го — это опоздание. Принимаем, но помечаем:
     * решение владельца.
     */
    expect(isLateSubmission({ dueLessonDate: '2026-10-15', submittedOn: '2026-10-16' })).toBe(true);
  });

  it('сдача в день урока-срока опозданием не считается', () => {
    expect(isLateSubmission({ dueLessonDate: '2026-10-15', submittedOn: '2026-10-15' })).toBe(
      false,
    );
  });

  it('сдача раньше срока опозданием не считается', () => {
    // Сдать раньше — нормально: задание на 15-е можно принести 10-го.
    expect(isLateSubmission({ dueLessonDate: '2026-10-15', submittedOn: '2026-10-10' })).toBe(
      false,
    );
  });
});
