/**
 * Публичный интерфейс модуля `storage` (Этап 5).
 *
 * Хранилище файлов: адаптеры `local` и `s3` за общим интерфейсом, шифрование ключей
 * доступа и чтение настроек. Другие модули получают адаптер через сервис, а не создают
 * клиента сами — иначе настройки пришлось бы разбирать в каждом месте.
 */

export type { PutObjectInput, StorageAdapter, StoredObject } from './storage.adapter';
export { objectKey } from './storage.adapter';
export { decryptSecret, encryptSecret, isEncrypted } from './storage.crypto';
export { detectType, type DetectedType } from './storage.content';
export { testStorageConnection, type ConnectionTestResult } from './storage.check';
export { createLocalStorage } from './storage.local';
export { createS3Storage, type S3StorageConfig } from './storage.s3';
export { createStorageService, type StorageService, type StorageSettings } from './storage.service';
