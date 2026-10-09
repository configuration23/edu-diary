import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AuditService } from '../audit';
import type { SecurityService } from '../security';
import { createAcademicsRepository } from './academics.repository';
import { registerAcademicsRoutes } from './academics.routes';
import {
  createAcademicsService,
  type AcademicsService,
  type GuardianLookupPort,
} from './academics.service';

/**
 * Публичный интерфейс модуля `academics`.
 *
 * Этап 1: учебные годы, периоды и ученики. Группы, предметы, аудитории и
 * назначения добавляет Этап 2.
 */

export {
  createAcademicsRepository,
  type StudentRecord,
  type StudentListFilters,
} from './academics.repository';
export {
  createAcademicsService,
  type AcademicsService,
  type GuardianLookupPort,
  type MutationOptions,
  type StudentViewer,
} from './academics.service';
export {
  academicYear,
  gradeCategory,
  period,
  room,
  student,
  studentEnrollment,
  studyGroup,
  subject,
} from './academics.schema';

export function createAcademicsModule(dependencies: {
  academics: AcademicsService;
}): FastifyPluginAsync {
  return async (app) => {
    registerAcademicsRoutes(app, dependencies.academics);
  };
}

export function buildAcademicsService(dependencies: {
  db: Database;
  audit: AuditService;
  security: SecurityService;
  guardians: GuardianLookupPort;
}): AcademicsService {
  return createAcademicsService({
    db: dependencies.db,
    academics: createAcademicsRepository(dependencies.db),
    audit: dependencies.audit,
    security: dependencies.security,
    guardians: dependencies.guardians,
  });
}
