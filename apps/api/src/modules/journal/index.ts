import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AuditService } from '../audit';
import type { JournalRepository } from './journal.repository';
import { registerJournalRoutes } from './journal.routes';
import {
  createJournalService,
  type JournalService,
  type ScheduleLookupPort,
} from './journal.service';

/**
 * Публичный интерфейс модуля `journal`.
 *
 * Этап 4: оценки, знаки «+/·» и посещаемость. Модуль опирается на урок (ADR-006) и
 * не знает о расписании ничего сверх порта `ScheduleLookupPort` — его собирает
 * `app.ts`, поэтому границы модулей остаются проверяемыми.
 */

export {
  createJournalRepository,
  type AttendanceRecord,
  type GradeRecord,
  type JournalRepository,
  type RuleRecord,
} from './journal.repository';
export {
  createJournalService,
  type JournalLesson,
  type JournalService,
  type MutationOptions,
  type ScheduleLookupPort,
} from './journal.service';
export {
  attendanceEntry,
  attendanceRevision,
  gradeEntry,
  gradeRevision,
  gradeRule,
  gradeRuleApplication,
} from './journal.schema';

export function createJournalModule(dependencies: {
  db: Database;
  journal: JournalService;
  audit: AuditService;
  isOwnStudent: (viewerUserId: string, studentId: string) => Promise<boolean>;
  studentsOfViewer: (viewerUserId: string) => Promise<string[]>;
}): FastifyPluginAsync {
  return async (app) => {
    registerJournalRoutes(app, dependencies);
  };
}

export function buildJournalService(dependencies: {
  db: Database;
  journal: JournalRepository;
  audit: AuditService;
  schedule: ScheduleLookupPort;
}): JournalService {
  return createJournalService(dependencies);
}
