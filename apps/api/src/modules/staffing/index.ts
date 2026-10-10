import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AuditService } from '../audit';
import { registerStaffingRoutes } from './staffing.routes';
import { createStaffingRepository, type StaffingRepository } from './staffing.repository';
import {
  createStaffingService,
  type CatalogLookupPort,
  type StaffingService,
  type TeacherLookupPort,
} from './staffing.service';

/**
 * Публичный интерфейс модуля `staffing`.
 *
 * Этап 2: назначения «преподаватель ↔ предмет ↔ группа». Этап 3 добавит замены
 * преподавателя на конкретные уроки.
 *
 * Модуль отдаёт наружу две вещи: маршруты назначений и порт
 * `AssignmentUsagePort` — через него `academics` узнаёт, что предмет или группу
 * уже используют, не зная о таблице назначений.
 */

export {
  createStaffingRepository,
  type AssignmentListFilters,
  type AssignmentRow,
  type AssignmentUsageFilter,
  type StaffingRepository,
} from './staffing.repository';
export {
  createStaffingService,
  type CatalogLookupPort,
  type CreateAssignmentInput,
  type StaffingService,
  type TeacherLookupPort,
  type TeacherViewer,
  type UpdateAssignmentInput,
} from './staffing.service';
export { teachingAssignment } from './staffing.schema';

/**
 * Порт использования назначений: реализуется здесь, вызывается из `academics`.
 *
 * Собирается в `app.ts` — так `academics` не импортирует `staffing`, и границы
 * модулей остаются проверяемыми правилом `module-boundary`.
 */
export interface AssignmentUsagePort {
  countUsages(filter: { subjectId?: string; studyGroupId?: string }): Promise<number>;
}

export function createAssignmentUsagePort(db: Database): AssignmentUsagePort {
  const repository: StaffingRepository = createStaffingRepository(db);

  return {
    countUsages(filter) {
      return repository.countUsages(filter);
    },
  };
}

export function createStaffingModule(dependencies: {
  staffing: StaffingService;
}): FastifyPluginAsync {
  return async (app) => {
    registerStaffingRoutes(app, dependencies.staffing);
  };
}

export function buildStaffingService(dependencies: {
  db: Database;
  audit: AuditService;
  teachers: TeacherLookupPort;
  catalog: CatalogLookupPort;
  today?: (() => string) | undefined;
}): StaffingService {
  const repository: StaffingRepository = createStaffingRepository(dependencies.db);

  return createStaffingService({
    db: dependencies.db,
    staffing: repository,
    audit: dependencies.audit,
    teachers: dependencies.teachers,
    catalog: dependencies.catalog,
    today: dependencies.today,
  });
}
