import { describe, expect, it } from 'vitest';

import { createSystemState } from '../src/modules/setup';
import type { SettingsService } from '../src/modules/settings';

function createFakeSettings(values: Map<string, unknown>): {
  settings: SettingsService;
  reads: () => number;
} {
  let reads = 0;

  const settings: SettingsService = {
    async get<T = unknown>(key: string): Promise<T | null> {
      reads += 1;
      return (values.get(key) ?? null) as T | null;
    },
    async set(): Promise<void> {},
    async isInitialized(): Promise<boolean> {
      return values.get('system.initialized') === true;
    },
    // Брендинг в этом тесте не участвует: состояние настройки от него не зависит.
    async readBranding() {
      return {
        title: null,
        shortName: null,
        signature: null,
        logoDataUrl: null,
        aboutTitle: null,
        aboutText: null,
      };
    },
    async updateBranding() {
      return {
        branding: {
          title: null,
          shortName: null,
          signature: null,
          logoDataUrl: null,
          aboutTitle: null,
          aboutText: null,
        },
        before: {
          title: null,
          shortName: null,
          signature: null,
          logoDataUrl: null,
          aboutTitle: null,
          aboutText: null,
        },
        changed: {},
      };
    },
    // Оформление уроков в этом тесте не участвует: состояние настройки от него
    // не зависит, но интерфейс сервиса обязан быть полным.
    async readAppearance() {
      return {
        markersEnabled: true,
        markers: { replaced: '🔄' as const, cancelled: '❎' as const },
        colorsEnabled: true,
      };
    },
    async updateAppearance(input) {
      const appearance = {
        markersEnabled: input.markersEnabled ?? true,
        markers: {
          replaced: input.markers?.replaced ?? ('🔄' as const),
          cancelled: input.markers?.cancelled ?? ('❎' as const),
        },
        colorsEnabled: input.colorsEnabled ?? true,
      };

      return { appearance, before: appearance, changed: input };
    },
  };

  return { settings, reads: () => reads };
}

describe('состояние системы', () => {
  it('перечитывает отрицательный ответ: мастер ещё не пройден', async () => {
    const values = new Map<string, unknown>();
    const { settings } = createFakeSettings(values);
    const state = createSystemState(settings);

    expect(await state.isInitialized()).toBe(false);

    values.set('system.initialized', true);
    expect(await state.isInitialized()).toBe(true);
  });

  it('кэширует положительный ответ', async () => {
    const values = new Map<string, unknown>([['system.initialized', true]]);
    const { settings, reads } = createFakeSettings(values);
    const state = createSystemState(settings);

    expect(await state.isInitialized()).toBe(true);
    expect(await state.isInitialized()).toBe(true);
    expect(reads()).toBe(0);
  });
});
