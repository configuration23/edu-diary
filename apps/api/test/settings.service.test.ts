import { describe, expect, it } from 'vitest';

import { AppError } from '../src/shared/errors';
import {
  createSettingsService,
  SETTING_KEYS,
  type SettingRecord,
  type SettingsRepository,
} from '../src/modules/settings';

function createInMemoryRepository(initial: SettingRecord[] = []): SettingsRepository {
  const records = new Map(initial.map((record) => [record.key, record]));

  return {
    async findByKey(key) {
      return records.get(key) ?? null;
    },
    async upsert({ key, value }) {
      records.set(key, { key, value, updatedAt: new Date() });
    },
  };
}

describe('settingsService', () => {
  it('возвращает значение по ключу и null для отсутствующего', async () => {
    const service = createSettingsService(
      createInMemoryRepository([
        { key: 'branding.title', value: 'Колледж', updatedAt: new Date() },
      ]),
    );

    expect(await service.get('branding.title')).toBe('Колледж');
    expect(await service.get('branding.subtitle')).toBeNull();
  });

  it('записывает и перезаписывает значение', async () => {
    const service = createSettingsService(createInMemoryRepository());

    await service.set('branding.title', 'Первое');
    expect(await service.get('branding.title')).toBe('Первое');

    await service.set('branding.title', 'Второе');
    expect(await service.get('branding.title')).toBe('Второе');
  });

  it('считает систему не настроенной, пока не выставлен признак мастера', async () => {
    const service = createSettingsService(createInMemoryRepository());
    expect(await service.isInitialized()).toBe(false);

    await service.set(SETTING_KEYS.systemInitialized, true);
    expect(await service.isInitialized()).toBe(true);

    await service.set(SETTING_KEYS.systemInitialized, 'yes');
    expect(await service.isInitialized()).toBe(false);
  });

  it('отвергает некорректный ключ настройки', async () => {
    const service = createSettingsService(createInMemoryRepository());

    await expect(service.get('Branding')).rejects.toBeInstanceOf(AppError);
    await expect(service.set('branding', 1)).rejects.toBeInstanceOf(AppError);
  });
});
