import { and, eq, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { teachingAssignment } from './staffing.schema';

/**
 * SQL только здесь: назначения «преподаватель ↔ предмет ↔ группа».
 *
 * Модуль `academics` не знает об этой таблице: чтобы не удалить предмет или
 * группу, которые уже используются, он спрашивает модуль `staffing` через порт
 * (собирается в `app.ts`). Так границы модулей остаются проверяемыми, а не «по
 * договорённости».
 */

export interface AssignmentUsageFilter {
  subjectId?: string | undefined;
  studyGroupId?: string | undefined;
}

export interface AssignmentUsageRepository {
  /** Сколько назначений ссылается на предмет или группу. */
  countUsages(filter: AssignmentUsageFilter, executor?: Executor): Promise<number>;
}

export function createAssignmentUsageRepository(db: Database): AssignmentUsageRepository {
  return {
    async countUsages(filter, executor: Executor = db.orm): Promise<number> {
      const conditions = [
        filter.subjectId === undefined
          ? undefined
          : eq(teachingAssignment.subjectId, filter.subjectId),
        filter.studyGroupId === undefined
          ? undefined
          : eq(teachingAssignment.studyGroupId, filter.studyGroupId),
      ].filter((condition) => condition !== undefined);

      if (conditions.length === 0) return 0;

      const rows = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(teachingAssignment)
        .where(and(...conditions));

      return rows[0]?.count ?? 0;
    },
  };
}
