/**
 * Публичный интерфейс модуля `settings`.
 *
 * Другие модули обращаются к нему только через этот файл: прямые импорты
 * внутренних файлов запрещены и проверяются тестом архитектуры.
 */

import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AuditService } from '../audit';
import { registerSettingsRoutes } from './settings.routes';
import { registerStorageSettingsRoutes } from './settings.storage.routes';
import type { SettingsService } from './settings.service';
import type { StorageService } from '../storage';

export {
  createSettingsRepository,
  type SettingRecord,
  type SettingsRepository,
} from './settings.repository';
export {
  createSettingsService,
  SETTING_KEYS,
  type Branding,
  type BrandingChange,
  type BrandingUpdate,
  type SettingsService,
} from './settings.service';
export { setting, type SettingRow } from './settings.schema';

export function createSettingsModule(dependencies: {
  db: Database;
  settings: SettingsService;
  audit: AuditService;
  /** Хранилище нужно для проверки подключения из формы настроек. */
  storage: StorageService;
}): FastifyPluginAsync {
  return async (app) => {
    registerSettingsRoutes(app, dependencies);
    registerStorageSettingsRoutes(app, dependencies);
  };
}
