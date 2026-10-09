/**
 * Публичный интерфейс модуля `settings`.
 *
 * Другие модули обращаются к нему только через этот файл: прямые импорты
 * внутренних файлов запрещены и проверяются тестом архитектуры.
 */

export {
  createSettingsRepository,
  type SettingRecord,
  type SettingsRepository,
} from './settings.repository';
export { createSettingsService, SETTING_KEYS, type SettingsService } from './settings.service';
export { setting, type SettingRow } from './settings.schema';
