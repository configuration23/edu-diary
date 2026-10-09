import type { SettingsService } from '../settings';

/**
 * Состояние «система настроена» (ADR-014).
 *
 * Положительный ответ кэшируется: после прохождения мастера состояние уже не
 * меняется. Отрицательный — перечитывается, иначе мастер не увидел бы результат
 * собственной работы. Запросов во время настройки единицы, так что это дешево.
 */
export interface SystemState {
  isInitialized(): Promise<boolean>;
}

export function createSystemState(settings: SettingsService): SystemState {
  let initialized = false;

  return {
    async isInitialized(): Promise<boolean> {
      if (initialized) return true;
      initialized = await settings.isInitialized();
      return initialized;
    },
  };
}
