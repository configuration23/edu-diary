import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../shared/db/client';
import type { AssignmentUsagePort } from '../academics';
import { createAssignmentUsageRepository, type AssignmentUsageFilter } from './staffing.repository';

/**
 * Публичный интерфейс модуля `staffing`.
 *
 * Этап 2 использует его для одного вопроса со стороны `academics`: «сколько
 * назначений ссылается на этот предмет или группу». Маршруты назначений
 * добавляются на Шаге 4, замены преподавателя — на Этапе 3.
 */

export {
  createAssignmentUsageRepository,
  type AssignmentUsageFilter,
  type AssignmentUsageRepository,
} from './staffing.repository';
export { teachingAssignment } from './staffing.schema';

/**
 * Порт для модуля `academics`: проверка «справочник уже используется».
 *
 * Собирается в `app.ts` — так `academics` не импортирует `staffing`, и границы
 * модулей остаются проверяемыми правилом `module-boundary`.
 */
export function createAssignmentUsagePort(db: Database): AssignmentUsagePort {
  const repository = createAssignmentUsageRepository(db);

  return {
    countUsages(filter: { subjectId?: string; studyGroupId?: string }): Promise<number> {
      const usage: AssignmentUsageFilter = {
        subjectId: filter.subjectId,
        studyGroupId: filter.studyGroupId,
      };

      return repository.countUsages(usage);
    },
  };
}

/** Регистрация маршрутов модуля: наполняется на Шаге 4. */
export function createStaffingModule(): FastifyPluginAsync {
  return async () => {};
}
