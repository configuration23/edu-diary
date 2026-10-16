import type { SettingsService } from '../settings';
import { SETTING_KEYS } from '../settings';
import type { StorageAdapter } from './storage.adapter';
import { decryptSecret, encryptSecret, isEncrypted } from './storage.crypto';
import { createLocalStorage } from './storage.local';
import { createS3Storage } from './storage.s3';
import { DEFAULT_ALLOWED_EXTENSIONS, DEFAULT_FILE_MB, normalizeMaxFileMb } from '@edu-diary/domain';

/**
 * Сборка хранилища по настройкам.
 *
 * Настройки читаются **на каждый вызов**, а не один раз при старте: администратор меняет
 * хранилище и лимиты без перезапуска приложения, и это должно работать сразу. Создание
 * клиента S3 дешёвое, а кешировать настройки — значит показывать администратору старое
 * значение после сохранения.
 */

export interface StorageSettings {
  provider: string;
  maxFileMb: number;
  allowedExtensions: readonly string[];
}

export function createStorageService(settings: SettingsService, encryptionKey: string) {
  /** Разобрать список расширений из настройки: строка через запятую. */
  function parseExtensions(value: unknown): readonly string[] {
    if (typeof value !== 'string' || value.trim() === '') return DEFAULT_ALLOWED_EXTENSIONS;

    const items = value
      .split(',')
      .map((item) => item.trim().toLowerCase().replace(/^\./, ''))
      .filter((item) => item !== '');

    return items.length === 0 ? DEFAULT_ALLOWED_EXTENSIONS : items;
  }

  const readSettings = async (): Promise<StorageSettings> => {
    const provider = (await settings.get<string>(SETTING_KEYS.storageProvider)) ?? 'local';
    const maxFileMb = normalizeMaxFileMb(
      Number((await settings.get<number>(SETTING_KEYS.storageMaxFileMb)) ?? DEFAULT_FILE_MB),
    );
    const allowedExtensions = parseExtensions(
      await settings.get<string>(SETTING_KEYS.storageAllowedTypes),
    );

    return { provider, maxFileMb, allowedExtensions };
  };

  /**
   * Адаптер по текущим настройкам.
   *
   * Если S3 выбран, но настроен неполно, честно сообщаем об этом: молчаливое падение на
   * каждом файле хуже, чем понятная ошибка при сохранении настроек.
   */
  const adapter = async (): Promise<StorageAdapter> => {
    const provider = (await settings.get<string>(SETTING_KEYS.storageProvider)) ?? 'local';

    if (provider !== 's3') {
      const path = (await settings.get<string>(SETTING_KEYS.storageLocalPath)) ?? '';
      return createLocalStorage(path);
    }

    const endpoint = (await settings.get<string>(SETTING_KEYS.storageS3Endpoint)) ?? '';
    const bucket = (await settings.get<string>(SETTING_KEYS.storageS3Bucket)) ?? '';
    const region = (await settings.get<string>(SETTING_KEYS.storageS3Region)) ?? 'us-east-1';
    const storedAccessKey = (await settings.get<string>(SETTING_KEYS.storageS3AccessKey)) ?? '';
    const storedSecretKey = (await settings.get<string>(SETTING_KEYS.storageS3SecretKey)) ?? '';

    /** Секреты читаем через расшифровку: в базе они лежат зашифрованными. */
    const accessKeyId = isEncrypted(storedAccessKey)
      ? (decryptSecret(storedAccessKey, encryptionKey) ?? '')
      : storedAccessKey;
    const secretAccessKey = isEncrypted(storedSecretKey)
      ? (decryptSecret(storedSecretKey, encryptionKey) ?? '')
      : storedSecretKey;

    if (endpoint === '' || bucket === '' || accessKeyId === '' || secretAccessKey === '') {
      throw new Error('Хранилище S3 настроено не полностью: задайте адрес, bucket и ключи');
    }

    return createS3Storage({ endpoint, bucket, region, accessKeyId, secretAccessKey });
  };

  return {
    readSettings,
    adapter,
    /** Зашифровать секрет перед записью в настройки. */
    encrypt: (value: string): string => encryptSecret(value, encryptionKey),
    /** Ключ уже зашифрован — повторно не шифруем при сохранении формы. */
    isEncrypted,
  };
}

export type StorageService = ReturnType<typeof createStorageService>;
