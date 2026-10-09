import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AuditService } from '../audit';
import type { SecurityService } from '../security';
import { createAcademicsRepository } from './academics.repository';
import { registerAcademicsRoutes } from './academics.routes';
import {
  createAcademicsService,
  type AcademicsService,
  type AssignmentUsagePort,
  type GuardianLookupPort,
  type UserLookupPort,
} from './academics.service';

/**
 * Публичный интерфейс модуля `academics`.
 *
 * Этап 1: учебные годы, периоды и ученики. Этап 2 добавил группы, зачисления и
 * справочники (предметы, аудитории, категории оценок). Назначения живут в
 * модуле `staffing`; сюда он отдаёт только число использований через порт.
 */

export {
  createAcademicsRepository,
  type AcademicYearRecord,
  type Dependencies,
  type EnrollmentRecord,
  type GradeCategoryRecord,
  type PeriodRecord,
  type RoomRecord,
  type StudentListFilters,
  type StudentRecord,
  type StudyGroupRecord,
  type SubjectRecord,
} from './academics.repository';
export {
  createAcademicsService,
  type AcademicsService,
  type AssignmentUsagePort,
  type CreateGroupInput,
  type GuardianLookupPort,
  type MutationOptions,
  type StudentViewer,
  type UserLookupPort,
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
  /** Считает использования в назначениях: реализация живёт в модуле `staffing`. */
  assignments: AssignmentUsagePort;
  /** Проверяет существование куратора и преподавателя: реализует модуль `iam`. */
  users: UserLookupPort;
}): AcademicsService {
  return createAcademicsService({
    db: dependencies.db,
    academics: createAcademicsRepository(dependencies.db),
    audit: dependencies.audit,
    security: dependencies.security,
    guardians: dependencies.guardians,
    assignments: dependencies.assignments,
    users: dependencies.users,
  });
}
