import { checkFile, extensionOf } from '@edu-diary/domain';

import { AppError } from '../../shared/errors';
import { detectType, objectKey, type StorageAdapter } from '../storage';

/**
 * Приём вложений: **общий** для всех, кому нужны файлы.
 *
 * Вынесен из модуля домашних заданий, когда файлы понадобились ещё и новостям. Сервис уже был
 * общим: он зависит только от интерфейса «приёмника» и не знает, к какому документу файл привяжут
 * позже. Копия разошлась бы с оригиналом при первой же правке проверок — а проверки здесь
 * защитные.
 *
 * Здесь сходятся три проверки, и ни одну нельзя пропустить:
 *
 * 1. **Размер** — ограничение из настроек, проверяет сервер (браузеру не верим);
 * 2. **Имя и расширение** — белый список с неизменяемым ядром запретов (домен);
 * 3. **Содержимое** — тип определяется по «магическим» байтам, а не по заголовку от клиента:
 *    под именем `смета.pdf` может прийти что угодно.
 *
 * Файл кладётся в хранилище под **случайным** ключом: по имени объекта нельзя определить ни
 * автора, ни содержимое, ни исходное имя файла.
 */

export interface UploadInput {
  fileName: string;
  /**
   * Имя, под которым файл хранится и показывается.
   *
   * Строится сервером из даты, логина и предмета — от клиентского имени берётся только расширение.
   * Так в имени не окажется пути, управляющих символов или чужой подписи.
   */
  displayName?: string | undefined;
  /**
   * Куда записать метаданные. Материалы задания, файлы решения и картинки новостей — **разные
   * таблицы**: это документы разного назначения и разного автора. Общий у них только приём.
   */
  repository: FileSink;
  body: Buffer;
  uploadedBy: string;
  maxFileMb: number;
  allowedExtensions: readonly string[];
}

/**
 * Минимум, нужный приёму файла: записать метаданные.
 *
 * Общий интерфейс для всех видов вложений: сервису приёма не нужно знать, к какому документу файл
 * привяжут потом.
 */
export interface FileSink {
  createPending(input: {
    storageKey: string;
    originalName: string;
    sizeBytes: number;
    mimeType: string;
    uploadedBy: string;
  }): Promise<{ id: string }>;
}

export interface FileService {
  upload(input: UploadInput): Promise<{
    id: string;
    originalName: string;
    sizeBytes: number;
    mimeType: string;
  }>;
  /** Выдать файл: право проверяет вызывающая сторона. */
  read(storageKey: string): Promise<Buffer | null>;
}

export function createFileService(dependencies: {
  /** Адаптер берём на каждый вызов: администратор может сменить хранилище без перезапуска. */
  adapter: () => Promise<StorageAdapter>;
}): FileService {
  const { adapter } = dependencies;

  return {
    async upload(input) {
      if (input.body.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'Файл пустой');
      }

      /** Слишком большой файл — это 413, а не «неверный запрос»: статус говорит клиенту правду. */
      if (input.body.length > input.maxFileMb * 1024 * 1024) {
        throw new AppError('PAYLOAD_TOO_LARGE', `Файл больше ${String(input.maxFileMb)} МБ`);
      }

      /** Проверки размера и расширения: те же правила, что на клиенте, но обязательные. */
      const verdict = checkFile({
        fileName: input.fileName,
        sizeBytes: input.body.length,
        maxFileMb: input.maxFileMb,
        allowedExtensions: input.allowedExtensions,
      });

      if (!verdict.allowed) {
        throw new AppError('VALIDATION_FAILED', verdict.reason ?? 'Файл не принят');
      }

      /**
       * Тип по содержимому. Если формат не распознан, файл принимаем как поток байтов: запрет
       * опасных типов уже сработал по расширению, а требовать распознавания для каждого формата
       * значило бы отклонять редкие, но допустимые файлы.
       */
      const detected = detectType(input.body);
      const mimeType = detected?.mimeType ?? 'application/octet-stream';

      const key = objectKey(extensionOf(input.fileName) || detected?.format || '');

      const storage = await adapter();
      await storage.put({ key, body: input.body, mimeType });

      /**
       * Пишем в **переданный** репозиторий, а не в свой.
       *
       * Здесь и была ошибка: материалы задания и файлы решения уходили в одну таблицу, потому что
       * сервис использовал репозиторий из зависимостей и не смотрел на `input.repository`.
       */
      const displayName = input.displayName ?? input.fileName;

      const created = await input.repository.createPending({
        storageKey: key,
        originalName: displayName,
        sizeBytes: input.body.length,
        mimeType,
        uploadedBy: input.uploadedBy,
      });

      return {
        id: created.id,
        originalName: displayName,
        sizeBytes: input.body.length,
        mimeType,
      };
    },

    async read(storageKey) {
      const storage = await adapter();
      const stored = await storage.get(storageKey);
      return stored === null ? null : stored.body;
    },
  };
}
