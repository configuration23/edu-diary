import type { SettingsService } from '../settings';
import { SETTING_KEYS } from '../settings';
import type { StorageAdapter } from './storage.adapter';
import { decryptSecret, encryptSecret, isEncrypted } from './storage.crypto';
import { createLocalStorage } from './storage.local';
import { createS3Storage } from './storage.s3';
import { AppError } from '../../shared/errors';
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

/**
 * Значения S3 из формы проверки.
 *
 * Нужны, чтобы проверить подключение **до** сохранения: иначе ошибку в адресе или ключах
 * администратор увидит только тогда, когда ученик не сможет приложить файл.
 */
export interface S3Overrides {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  localPath: string;
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
  /**
   * Адаптер по настройкам.
   *
   * `overrides` — значения **из формы**: администратор должен иметь возможность проверить
   * адрес и ключи до сохранения, иначе ошибку в них он увидит только на живом файле.
   */
  const adapter = async (
    overrides: Partial<StorageSettings> & Partial<S3Overrides> = {},
  ): Promise<StorageAdapter> => {
    const provider =
      overrides.provider ?? (await settings.get<string>(SETTING_KEYS.storageProvider)) ?? 'local';

    if (provider !== 's3') {
      const configured = overrides.localPath ?? (await settings.get<string>(SETTING_KEYS.storageLocalPath));

      /**
       * Пустой путь — **ошибка, а не «текущий каталог»**.
       *
       * Раньше здесь подставлялось `''`, а `resolve('')` возвращает каталог запуска: файлы
       * пользователей молча падали в **корень проекта**, и часть из них попала в репозиторий.
       * На стенде то же самое означало бы запись в каталог приложения — то есть внутрь
       * контейнера, чего мы как раз избегаем (`PHASE-5-PLAN.md`).
       */
      if (configured === undefined || configured === null || configured.trim() === '') {
        throw new AppError(
          'VALIDATION_FAILED',
          'Не задан каталог локального хранилища. Укажите его в настройках хранилища — иначе файлы попадут в каталог приложения.',
        );
      }

      return createLocalStorage(configured);
    }

    const read = async (fromForm: string | undefined, key: string): Promise<string> =>
      fromForm ?? (await settings.get<string>(key)) ?? '';

    const endpoint = await read(overrides.endpoint, SETTING_KEYS.storageS3Endpoint);
    const bucket = await read(overrides.bucket, SETTING_KEYS.storageS3Bucket);
    const region = (await read(overrides.region, SETTING_KEYS.storageS3Region)) || 'us-east-1';
    const storedAccessKey = await read(overrides.accessKey, SETTING_KEYS.storageS3AccessKey);
    const storedSecretKey = await read(overrides.secretKey, SETTING_KEYS.storageS3SecretKey);

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
