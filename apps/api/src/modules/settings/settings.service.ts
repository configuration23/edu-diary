import {
  DEFAULT_APPEARANCE,
  type AppearanceDto,
  type UpdateAppearanceRequest,
} from '@edu-diary/contracts';

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
  /** Блок «О колледже» на странице «Обзор»: заголовок и текст. */
  brandingAboutTitle: 'branding.about_title',
  brandingAboutText: 'branding.about_text',
  /** Показывать блок «Об учебном заведении» на «Обзоре». */
  brandingAboutVisible: 'branding.about_visible',
  appearance: 'appearance.lessons',
  /**
   * Хранилище файлов (Этап 5). Ключи заготовлены с самого начала: переключение между
   * локальным диском и S3 задумывалось заранее, чтобы на проде не дорабатывать код.
   */
  storageProvider: 'storage.provider',
  storageLocalPath: 'storage.local_path',
  storageS3Endpoint: 'storage.s3_endpoint',
  storageS3Bucket: 'storage.s3_bucket',
  storageS3Region: 'storage.s3_region',
  storageS3AccessKey: 'storage.s3_access_key',
  storageS3SecretKey: 'storage.s3_secret_key',
  /** Предельный размер файла в мегабайтах: диапазон проверяет домен (1–50). */
  storageMaxFileMb: 'storage.max_file_mb',
  /** Белый список расширений; ядро запретов настройкой не обходится. */
  storageAllowedTypes: 'storage.allowed_types',
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
  /** Блок «О колледже»: заголовок и текст, заполняет администратор. */
  aboutTitle: string | null;
  aboutText: string | null;
  /** Показывать блок на «Обзоре». По умолчанию — да. */
  aboutVisible: boolean;
}

export interface BrandingUpdate {
  title?: string | null | undefined;
  shortName?: string | null | undefined;
  signature?: string | null | undefined;
  logoDataUrl?: string | null | undefined;
  aboutTitle?: string | null | undefined;
  aboutText?: string | null | undefined;
  aboutVisible?: boolean | undefined;
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
  /** Оформление уроков: значки событий и цвета предметов. */
  readAppearance(executor?: Executor): Promise<AppearanceDto>;
  updateAppearance(
    input: UpdateAppearanceRequest,
    actorUserId?: string | null,
    executor?: Executor,
  ): Promise<{
    appearance: AppearanceDto;
    before: AppearanceDto;
    changed: UpdateAppearanceRequest;
  }>;
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
    const [title, shortName, signature, logoDataUrl, aboutTitle, aboutText, aboutVisible] =
      await Promise.all([
        get<string | null>(SETTING_KEYS.brandingTitle, executor),
        get<string | null>(SETTING_KEYS.brandingShortName, executor),
        get<string | null>(SETTING_KEYS.brandingSignature, executor),
        get<string | null>(SETTING_KEYS.brandingLogo, executor),
        get<string | null>(SETTING_KEYS.brandingAboutTitle, executor),
        get<string | null>(SETTING_KEYS.brandingAboutText, executor),
        /** По умолчанию показываем: пустой блок скрыт всё равно — по пустым полям. */
        get<boolean>(SETTING_KEYS.brandingAboutVisible, executor).then((value) => value ?? true),
      ]);

    return { title, shortName, signature, logoDataUrl, aboutTitle, aboutText, aboutVisible };
  };

  /** Тип берём из интерфейса сервиса: у возвращаемого объекта нет своего имени. */
  const updateAppearance: SettingsService['updateAppearance'] = async (
    input,
    actorUserId = null,
    executor = undefined,
  ) => {
    const before = await readAppearance(executor);

    // Как и у брендинга: `undefined` — «не трогать», иначе настройка целиком
    // перезаписывалась бы частичным запросом. Значение собираем полным: в
    // хранилище должно лежать готовое оформление, а не набор пропусков.
    const next: AppearanceDto = {
      markersEnabled: input.markersEnabled ?? before.markersEnabled,
      markers: {
        replaced: input.markers?.replaced ?? before.markers.replaced,
        cancelled: input.markers?.cancelled ?? before.markers.cancelled,
      },
      colorsEnabled: input.colorsEnabled ?? before.colorsEnabled,
    };

    const changed: UpdateAppearanceRequest = {
      ...(input.markersEnabled === undefined ? {} : { markersEnabled: next.markersEnabled }),
      ...(input.markers === undefined ? {} : { markers: next.markers }),
      ...(input.colorsEnabled === undefined ? {} : { colorsEnabled: next.colorsEnabled }),
    };

    await repository.upsert({ key: SETTING_KEYS.appearance, value: next, actorUserId }, executor);

    return { appearance: next, before, changed };
  };

  const readAppearance = async (executor?: Executor): Promise<AppearanceDto> => {
    const stored = await get<UpdateAppearanceRequest>(SETTING_KEYS.appearance, executor);

    // Значения по умолчанию живут в коде: незаданная настройка не должна ломать
    // интерфейс, а новый значок появляется без миграции.
    return {
      markersEnabled: stored?.markersEnabled ?? DEFAULT_APPEARANCE.markersEnabled,
      markers: {
        replaced: stored?.markers?.replaced ?? DEFAULT_APPEARANCE.markers.replaced,
        cancelled: stored?.markers?.cancelled ?? DEFAULT_APPEARANCE.markers.cancelled,
      },
      colorsEnabled: stored?.colorsEnabled ?? DEFAULT_APPEARANCE.colorsEnabled,
    };
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

      /**
       * Поля, которые пишутся как есть: `undefined` — «не трогать», `null` — «очистить».
       *
       * **Тип значения сужен до `string | null`**, а не до `keyof BrandingUpdate`: в этом же наборе
       * есть булево `aboutVisible`, и оно пишется отдельно. Раньше список был объявлен по ключам
       * целиком, и `aboutVisible` попало бы сюда по типу, а затем записалось бы как `null` —
       * то есть «скрыть» превратилось бы в «не показывать никогда».
       */
      type PlainBrandingField =
        'title' | 'shortName' | 'signature' | 'logoDataUrl' | 'aboutTitle' | 'aboutText';

      const plainFields: Array<[PlainBrandingField, string]> = [
        ['title', SETTING_KEYS.brandingTitle],
        ['shortName', SETTING_KEYS.brandingShortName],
        ['signature', SETTING_KEYS.brandingSignature],
        ['logoDataUrl', SETTING_KEYS.brandingLogo],
        /**
         * Блок «Об учебном заведении» на «Обзоре».
         *
         * **Дефект, найденный владельцем:** поля читались и показывались в форме, но в этот список
         * не попали — поэтому **не сохранялись**. Выглядело как «блок не сохраняет данные»:
         * администратор заполнял, жал «Сохранить», а после перезагрузки поля были пустыми.
         */
        ['aboutTitle', SETTING_KEYS.brandingAboutTitle],
        ['aboutText', SETTING_KEYS.brandingAboutText],
      ];

      const changed: BrandingUpdate = {};

      for (const [field, key] of plainFields) {
        const value = input[field];
        if (value === undefined) continue;

        await repository.upsert({ key, value: value ?? null, actorUserId }, executor);
        changed[field] = value;
      }

      /**
       * Видимость блока «Об учебном заведении» — **булево**, поэтому в общий список не подходит:
       * там значения `null` означают «очистить». Здесь `undefined` — «не трогать», а `false` —
       * это осознанное «скрыть», и записывать его нужно.
       */
      if (input.aboutVisible !== undefined) {
        await repository.upsert(
          {
            key: SETTING_KEYS.brandingAboutVisible,
            value: input.aboutVisible,
            actorUserId,
          },
          executor,
        );
        changed.aboutVisible = input.aboutVisible;
      }

      return {
        branding: await readBranding(executor),
        before,
        changed,
      };
    },

    readAppearance,
    updateAppearance,
  };
}
