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

/**
 * Брендинг: название, короткое имя, подпись и логотип.
 *
 * Значения лежат отдельными ключами настроек, чтобы мастер настройки и правка
 * после него работали с одним и тем же хранилищем. `null` означает «не задано»,
 * а не пустую строку.
 */
export interface Branding {
  title: string | null;
  shortName: string | null;
  signature: string | null;
  logoDataUrl: string | null;
}

export interface BrandingUpdate {
  title?: string | null | undefined;
  shortName?: string | null | undefined;
  signature?: string | null | undefined;
  logoDataUrl?: string | null | undefined;
}

export interface BrandingChange {
  branding: Branding;
  /** Состояние до правки: нужно для записи в аудит. */
  before: Branding;
  /** Изменившиеся поля — только они попадают в `after` записи аудита. */
  changed: BrandingUpdate;
}

export interface SettingsService {
  get<T = unknown>(key: string, executor?: Executor): Promise<T | null>;
  set(key: string, value: unknown, actorUserId?: string | null, executor?: Executor): Promise<void>;
  /** Пройден ли мастер первого запуска (ADR-014). */
  isInitialized(): Promise<boolean>;
  /** Текущий брендинг: его отдают мастер настройки, экран входа и шапка. */
  readBranding(executor?: Executor): Promise<Branding>;
  /**
   * Частичная правка брендинга. Возвращает состояние до и после, чтобы
   * вызывающий записал изменение в аудит в той же транзакции.
   */
  updateBranding(
    input: BrandingUpdate,
    actorUserId?: string | null,
    executor?: Executor,
  ): Promise<BrandingChange>;
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

  const readBranding = async (executor?: Executor): Promise<Branding> => {
    const [title, shortName, signature, logoDataUrl] = await Promise.all([
      get<string | null>(SETTING_KEYS.brandingTitle, executor),
      get<string | null>(SETTING_KEYS.brandingShortName, executor),
      get<string | null>(SETTING_KEYS.brandingSignature, executor),
      get<string | null>(SETTING_KEYS.brandingLogo, executor),
    ]);

    return { title, shortName, signature, logoDataUrl };
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

    readBranding,

    async updateBranding(input, actorUserId = null, executor): Promise<BrandingChange> {
      const before = await readBranding(executor);

      // Пишем только переданные поля: `undefined` — «не трогать», `null` —
      // «очистить». Иначе частичная правка затирала бы остальное.
      const plainFields: Array<[keyof BrandingUpdate, string]> = [
        ['title', SETTING_KEYS.brandingTitle],
        ['shortName', SETTING_KEYS.brandingShortName],
        ['signature', SETTING_KEYS.brandingSignature],
        ['logoDataUrl', SETTING_KEYS.brandingLogo],
      ];

      const changed: BrandingUpdate = {};

      for (const [field, key] of plainFields) {
        const value = input[field];
        if (value === undefined) continue;

        await repository.upsert({ key, value: value ?? null, actorUserId }, executor);
        changed[field] = value;
      }

      return {
        branding: await readBranding(executor),
        before,
        changed,
      };
    },
  };
}
