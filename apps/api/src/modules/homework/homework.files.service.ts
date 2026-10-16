import { checkFile, extensionOf } from '@edu-diary/domain';

import { AppError } from '../../shared/errors';
import { detectType, objectKey, type StorageAdapter } from '../storage';
import type { AssignmentFileRepository, PendingFileRecord } from './homework.files.repository';

/**
 * Приём вложений.
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
   * Куда записать метаданные: материалы задания и файлы решения — разные таблицы, потому что
   * это документы разного автора. Общий у них только приём: дальше пути расходятся.
   */
  repository: FileSink;
  body: Buffer;
  uploadedBy: string;
  maxFileMb: number;
  allowedExtensions: readonly string[];
}

/**
 * Минимум, нужный приёмy файла: записать метаданные и найти их обратно.
 *
 * Общий интерфейс для материалов задания и файлов решения: сервису приёма не нужно знать,
 * к какому документу файл привяжут потом.
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
  repository: AssignmentFileRepository;
  /** Адаптер берём на каждый вызов: администратор может сменить хранилище без перезапуска. */
  adapter: () => Promise<StorageAdapter>;
}): FileService {
  const { repository, adapter } = dependencies;

  return {
    async upload(input) {
      if (input.body.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'Файл пустой');
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
       * Тип по содержимому. Если формат не распознан, файл принимаем как поток байтов:
       * запрет опасных типов уже сработал по расширению, а требовать распознавания для
       * каждого формата значило бы отклонять редкие, но допустимые файлы.
       */
      const detected = detectType(input.body);
      const mimeType = detected?.mimeType ?? 'application/octet-stream';

      const key = objectKey(extensionOf(input.fileName) || detected?.format || '');

      const storage = await adapter();
      await storage.put({ key, body: input.body, mimeType });

      const created = await repository.createPending({
        storageKey: key,
        originalName: input.fileName,
        sizeBytes: input.body.length,
        mimeType,
        uploadedBy: input.uploadedBy,
      });

      return {
        id: created.id,
        originalName: input.fileName,
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

export type { PendingFileRecord };
