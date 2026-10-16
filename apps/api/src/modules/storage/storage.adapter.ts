/**
 * Хранилище файлов за абстракцией (`ARCHITECTURE.md` §7).
 *
 * Файлы **не попадают внутрь контейнера приложения**: они лежат в настроенном хранилище
 * (локальный каталог на отдельном томе или S3). Приложение знает только ключ объекта и
 * адаптер, поэтому смена хранилища не требует правок в коде — это требование приёмки
 * Этапа 5.
 *
 * Имена объектов — **случайные UUID**, а не имена файлов от пользователя: иначе можно
 * было бы перебрать чужие вложения или подсунуть путь с `../`.
 */

import { randomUUID } from 'node:crypto';

export interface StoredObject {
  /** Ключ в хранилище: путь к файлу внутри хранилища, без пользовательских частей. */
  key: string;
  body: Buffer;
  mimeType: string;
}

export interface PutObjectInput {
  /** Готовый ключ: его генерирует вызывающий код, а не адаптер. */
  key: string;
  body: Buffer;
  mimeType: string;
}

export interface StorageAdapter {
  /** Имя для журналов и диагностики: `local` или `s3`. */
  readonly kind: string;
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  /**
   * Удалить объект.
   *
   * У нас файлы **не удаляются** (решение владельца: только пометка), но метод нужен:
   * им убирают мусор при неудачной загрузке и он входит в контракт адаптера.
   */
  remove(key: string): Promise<void>;
  /** Хранилище отвечает: используется при проверке настроек администратором. */
  health(): Promise<{ ok: boolean; detail: string | null }>;
}

/**
 * Ключ объекта.
 *
 * UUID версии 4 и расширение как отдельный сегмент — чтобы по имени нельзя было
 * определить ни автора, ни содержимое, ни исходное имя файла: иначе по ключу можно было
 * бы перебирать чужие вложения.
 */
export function objectKey(extension: string): string {
  const safe = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const suffix = safe === '' ? '' : `.${safe}`;
  return `${randomUUID()}${suffix}`;
}
