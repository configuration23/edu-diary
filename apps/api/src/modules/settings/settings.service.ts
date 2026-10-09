import type { Executor } from '../../shared/db/client';
import { AppError } from '../../shared/errors';
import type { SettingsRepository } from './settings.repository';

/** Известные ключи настроек. Новые ключи добавляются здесь, а не строками по коду. */
export const SETTING_KEYS = {
  systemInitialized: 'system.initialized',
  brandingTitle: 'branding.title',
  brandingShortName: 'branding.short_name',
  brandingSignature: 'branding.signature',
  brandingLogo: 'branding.logo',
  storageProvider: 'storage.provider',
  storageLocalPath: 'storage.local_path',
} as const;

const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

export interface SettingsService {
  get<T = unknown>(key: string, executor?: Executor): Promise<T | null>;
  set(key: string, value: unknown, actorUserId?: string | null, executor?: Executor): Promise<void>;
  /** Пройден ли мастер первого запуска (ADR-014). */
  isInitialized(): Promise<boolean>;
}

function assertSettingKey(key: string): void {
  if (!SETTING_KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_FAILED', `Некорректный ключ настройки: ${key}`, {
      details: { key, expected: 'например system.initialized' },
    });
  }
}

export function createSettingsService(repository: SettingsRepository): SettingsService {
  const get = async <T = unknown>(key: string, executor?: Executor): Promise<T | null> => {
    assertSettingKey(key);
    const record = await repository.findByKey(key, executor);
    return record === null ? null : (record.value as T);
  };

  return {
    get,

    async set(key, value, actorUserId = null, executor): Promise<void> {
      assertSettingKey(key);
      await repository.upsert({ key, value, actorUserId }, executor);
    },

    async isInitialized(): Promise<boolean> {
      const value = await get<unknown>(SETTING_KEYS.systemInitialized);
      return value === true;
    },
  };
}
