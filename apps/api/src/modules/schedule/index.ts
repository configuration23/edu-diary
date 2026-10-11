import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AuditService } from '../audit';
import { createScheduleRepository, type ScheduleRepository } from './schedule.repository';
import { registerScheduleRoutes } from './schedule.routes';
import {
  createScheduleService,
  type CatalogLookupPort,
  type ScheduleService,
  type UserLookupPort,
} from './schedule.service';

/**
 * Публичный интерфейс модуля `schedule` (Этап 3).
 *
 * Модуль отвечает за расписание и уроки: шаблон по группе с датой начала и
 * (необязательным) окончанием, исключения на конкретную дату — отмена, перенос,
 * замена, — порождённые уроки и замены преподавателя на урок или диапазон дат.
 *
 * Наружу отдаёт сервис и фабрику маршрутов. Порты (`catalog`, `users`) приходят
 * снаружи и собираются в `app.ts`: так модуль не импортирует `staffing` и
 * `academics` напрямую, и границы модулей остаются проверяемыми.
 */

export {
  createScheduleRepository,
  type LessonListFilters,
  type LessonRecord,
  type ScheduleEntryInput,
  type ScheduleEntryRecord,
  type ScheduleExceptionRecord,
  type ScheduleRepository,
  type SubstitutionRecord,
} from './schedule.repository';
export {
  createScheduleService,
  type AssignmentLookup,
  type CatalogLookupPort,
  type ScheduleService,
  type ScheduleServiceDependencies,
  type UserLookupPort,
} from './schedule.service';
export { lesson, scheduleEntry, scheduleException, substitution } from './schedule.schema';

export function buildScheduleService(dependencies: {
  db: Database;
  audit: AuditService;
  catalog: CatalogLookupPort;
  users: UserLookupPort;
  today?: (() => string) | undefined;
}): ScheduleService {
  const repository: ScheduleRepository = createScheduleRepository(dependencies.db);

  return createScheduleService({
    db: dependencies.db,
    schedule: repository,
    audit: dependencies.audit,
    catalog: dependencies.catalog,
    users: dependencies.users,
    today: dependencies.today,
  });
}

export function createScheduleModule(dependencies: {
  schedule: ScheduleService;
  catalog: CatalogLookupPort;
  users: UserLookupPort;
}): FastifyPluginAsync {
  return async (app) => {
    registerScheduleRoutes(app, dependencies.schedule, dependencies.catalog, dependencies.users);
  };
}
