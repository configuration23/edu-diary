import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AcademicsService } from '../academics';
import type { AuditService } from '../audit';
import type { GuardiansService, UsersService } from '../iam';
import type { SettingsService } from '../settings';
import { createPrivacyRepository } from './privacy.repository';
import { registerPrivacyRoutes } from './privacy.routes';
import { createPrivacyService, type PrivacyService } from './privacy.service';

/**
 * Публичный интерфейс модуля `privacy`: политика обработки ПДн и согласия (ADR-021).
 */

export { createPrivacyRepository } from './privacy.repository';
export type { ConsentRecord } from './privacy.repository';
export { createPrivacyService, POLICY_SETTING_KEY } from './privacy.service';
export type { PolicyEdition, PrivacyService } from './privacy.service';
export { consent } from './privacy.schema';

export function createPrivacyModule(dependencies: { privacy: PrivacyService }): FastifyPluginAsync {
  return async (app) => {
    registerPrivacyRoutes(app, dependencies.privacy);
  };
}

export function buildPrivacyService(dependencies: {
  db: Database;
  settings: SettingsService;
  academics: AcademicsService;
  guardians: GuardiansService;
  users: UsersService;
  audit: AuditService;
}): PrivacyService {
  return createPrivacyService({
    db: dependencies.db,
    privacy: createPrivacyRepository(dependencies.db),
    settings: dependencies.settings,
    academics: dependencies.academics,
    guardians: dependencies.guardians,
    users: dependencies.users,
    audit: dependencies.audit,
  });
}
