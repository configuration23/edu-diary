import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AcademicsService } from '../academics';
import type { AuditService } from '../audit';
import type { AuthService } from '../auth';
import type { RolesService, UsersService } from '../iam';
import type { SettingsService } from '../settings';
import { registerSetupRoutes } from './setup.routes';
import { createSetupService, type SetupService } from './setup.service';

/**
 * Публичный интерфейс модуля `setup`: мастер первого запуска (ADR-014) и
 * состояние «система настроена» для гейта `SETUP_REQUIRED`.
 */

export { createSetupService } from './setup.service';
export type { SetupService } from './setup.service';
export { createSystemState } from './setup.state';
export type { SystemState } from './setup.state';

export function createSetupModule(dependencies: {
  setup: SetupService;
  auth: AuthService;
}): FastifyPluginAsync {
  return async (app) => {
    registerSetupRoutes(app, dependencies.setup, dependencies.auth);
  };
}

export function buildSetupService(dependencies: {
  db: Database;
  settings: SettingsService;
  users: UsersService;
  roles: RolesService;
  academics: AcademicsService;
  audit: AuditService;
}): SetupService {
  return createSetupService(dependencies);
}
