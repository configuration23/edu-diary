import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILE_MB,
  FORBIDDEN_EXTENSIONS,
  MAX_FILE_MB,
  MEGABYTE,
  MIN_FILE_MB,
  checkFile,
  extensionOf,
  fitsDuration,
  isAssignmentVisible,
  isLateSubmission,
  maxVisibleUntil,
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

describe('видимость задания в уроках', () => {
  it('в своём уроке задание видно всегда', () => {
    const result = isAssignmentVisible({
      assignmentLessonId: 'урок-1',
      assignmentLessonDate: '2026-10-01',
      visibleUntil: null,
      lessonId: 'урок-1',
      lessonDate: '2026-10-01',
    });

    expect(result).toBe(true);
  });

  it('без «видно до» задание в других уроках не показывается', () => {
    const result = isAssignmentVisible({
      assignmentLessonId: 'урок-1',
      assignmentLessonDate: '2026-10-01',
      visibleUntil: null,
      lessonId: 'урок-2',
      lessonDate: '2026-10-08',
    });

    expect(result).toBe(false);
  });

  it('продолжительное задание видно в уроках до указанной даты', () => {
    const common = {
      assignmentLessonId: 'урок-1',
      assignmentLessonDate: '2026-10-01',
      visibleUntil: '2026-10-15',
    };

    // В день задания, в середине срока и в последний день — видно.
    expect(isAssignmentVisible({ ...common, lessonId: 'урок-2', lessonDate: '2026-10-01' })).toBe(
      true,
    );
    expect(isAssignmentVisible({ ...common, lessonId: 'урок-3', lessonDate: '2026-10-08' })).toBe(
      true,
    );
    expect(isAssignmentVisible({ ...common, lessonId: 'урок-4', lessonDate: '2026-10-15' })).toBe(
      true,
    );
    // После срока — уже нет.
    expect(isAssignmentVisible({ ...common, lessonId: 'урок-5', lessonDate: '2026-10-22' })).toBe(
      false,
    );
  });

  it('уроки до самого задания продолжительное задание не показывает', () => {
    const result = isAssignmentVisible({
      assignmentLessonId: 'урок-1',
      assignmentLessonDate: '2026-10-08',
      visibleUntil: '2026-10-20',
      lessonId: 'урок-назад',
      lessonDate: '2026-10-01',
    });

    // Задание нельзя «получить» раньше, чем его задали.
    expect(result).toBe(false);
  });
});

describe('срок сдачи и ограничение длительности', () => {
  it('сдача после срока помечается опозданием', () => {
    expect(isLateSubmission({ dueOn: '2026-10-10', submittedOn: '2026-10-11' })).toBe(true);
  });

  it('сдача в день срока опозданием не считается', () => {
    expect(isLateSubmission({ dueOn: '2026-10-10', submittedOn: '2026-10-10' })).toBe(false);
  });

  it('без срока опоздания не бывает', () => {
    expect(isLateSubmission({ dueOn: null, submittedOn: '2026-12-31' })).toBe(false);
  });

  it('предел продолжительности считается от даты урока', () => {
    expect(maxVisibleUntil('2026-10-01', 14)).toBe('2026-10-15');
    // Переход через месяц.
    expect(maxVisibleUntil('2026-10-25', 14)).toBe('2026-11-08');
  });

  it('слишком длинное задание не укладывается в предел', () => {
    expect(
      fitsDuration({ lessonDate: '2026-10-01', visibleUntil: '2026-10-15', maxDays: 14 }),
    ).toBe(true);
    expect(
      fitsDuration({ lessonDate: '2026-10-01', visibleUntil: '2026-10-16', maxDays: 14 }),
    ).toBe(false);
  });
});
