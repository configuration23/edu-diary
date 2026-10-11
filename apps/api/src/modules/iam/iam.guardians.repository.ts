import { and, asc, eq } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { appUser, guardianLink } from './iam.schema';

/** SQL только здесь: привязки «родитель ↔ ученик». */

export interface GuardianLinkRow {
  id: string;
  studentId: string;
  guardianUserId: string;
  relation: string | null;
  guardianName: string;
  guardianUsername: string;
  createdAt: Date;
}

/** Связь вместе с именем ученика: список связей показывается в разделе людей. */
export interface GuardianLinkWithStudentRow extends GuardianLinkRow {
  studentName: string;
}

export interface GuardiansRepository {
  listByStudent(studentId: string): Promise<GuardianLinkRow[]>;
  /**
   * Все связи «ученик ↔ представитель».
   *
   * Имена учеников подставляет переданный резолвер: таблица учеников
   * принадлежит модулю `academics`, и читать её напрямую отсюда нельзя
   * (правило границ модулей, `docs/ARCHITECTURE.md` §3).
   */
  listAll(
    limit: number,
    resolveStudentName: (studentId: string) => Promise<string | null>,
  ): Promise<GuardianLinkWithStudentRow[]>;
  findById(id: string): Promise<GuardianLinkRow | null>;
  findLink(studentId: string, guardianUserId: string): Promise<{ id: string } | null>;
  insert(
    input: { studentId: string; guardianUserId: string; relation: string | null },
    executor?: Executor,
  ): Promise<{ id: string }>;
  remove(id: string, executor?: Executor): Promise<boolean>;
  /** Идентификаторы учеников, привязанных к пользователю-родителю. */
  studentIdsOfGuardian(guardianUserId: string): Promise<string[]>;
}

const LINK_SELECTION = {
  id: guardianLink.id,
  studentId: guardianLink.studentId,
  guardianUserId: guardianLink.guardianUserId,
  relation: guardianLink.relation,
  guardianName: appUser.fullName,
  guardianUsername: appUser.username,
  createdAt: guardianLink.createdAt,
};

export function createGuardiansRepository(db: Database): GuardiansRepository {
  return {
    async listByStudent(studentId: string): Promise<GuardianLinkRow[]> {
      return db.orm
        .select(LINK_SELECTION)
        .from(guardianLink)
        .innerJoin(appUser, eq(appUser.id, guardianLink.guardianUserId))
        .where(eq(guardianLink.studentId, studentId))
        .orderBy(asc(appUser.fullName));
    },

    async listAll(
      limit: number,
      resolveStudentName: (studentId: string) => Promise<string | null>,
    ): Promise<GuardianLinkWithStudentRow[]> {
      const rows = await db.orm
        .select(LINK_SELECTION)
        .from(guardianLink)
        .innerJoin(appUser, eq(appUser.id, guardianLink.guardianUserId))
        .orderBy(asc(guardianLink.createdAt))
        .limit(limit);

      // Имена запрашиваем по одному разу на ученика: в списке их немного.
      const names = new Map<string, string>();
      for (const studentId of new Set(rows.map((row) => row.studentId))) {
        const name = await resolveStudentName(studentId);
        if (name !== null) names.set(studentId, name);
      }

      return rows
        .map((row) => ({ ...row, studentName: names.get(row.studentId) ?? 'Ученик не найден' }))
        .sort((left, right) => left.studentName.localeCompare(right.studentName, 'ru'));
    },

    async findById(id: string): Promise<GuardianLinkRow | null> {
      const rows = await db.orm
        .select(LINK_SELECTION)
        .from(guardianLink)
        .innerJoin(appUser, eq(appUser.id, guardianLink.guardianUserId))
        .where(eq(guardianLink.id, id))
        .limit(1);

      return rows[0] ?? null;
    },

    async findLink(studentId: string, guardianUserId: string): Promise<{ id: string } | null> {
      const rows = await db.orm
        .select({ id: guardianLink.id })
        .from(guardianLink)
        .where(
          and(
            eq(guardianLink.studentId, studentId),
            eq(guardianLink.guardianUserId, guardianUserId),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    },

    async insert(input, executor: Executor = db.orm): Promise<{ id: string }> {
      const rows = await executor
        .insert(guardianLink)
        .values({
          studentId: input.studentId,
          guardianUserId: input.guardianUserId,
          relation: input.relation,
        })
        .returning({ id: guardianLink.id });

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать привязку родителя');
      return created;
    },

    async remove(id: string, executor: Executor = db.orm): Promise<boolean> {
      const rows = await executor
        .delete(guardianLink)
        .where(eq(guardianLink.id, id))
        .returning({ id: guardianLink.id });

      return rows.length > 0;
    },

    async studentIdsOfGuardian(guardianUserId: string): Promise<string[]> {
      const rows = await db.orm
        .select({ studentId: guardianLink.studentId })
        .from(guardianLink)
        .where(eq(guardianLink.guardianUserId, guardianUserId));

      return rows.map((row) => row.studentId);
    },
  };
}
