import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { SettingsService } from '../settings';
import { registerHealthRoutes } from './health.routes';

/**
 * Публичный интерфейс модуля `health`.
 *
 * Модуль зависит от сервиса `settings` и обращается к нему только через
 * `../settings` (публичный вход), а не через внутренние файлы.
 */

export interface HealthModuleDependencies {
  db: Database;
  settings: SettingsService;
  version: string;
  startedAt?: Date;
}

export function createHealthModule(dependencies: HealthModuleDependencies): FastifyPluginAsync {
  const startedAt = dependencies.startedAt ?? new Date();

  return async (app) => {
    registerHealthRoutes(app, { ...dependencies, startedAt });
  };
}

export { collectHealth, type HealthReport } from './health.service';
