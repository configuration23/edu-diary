import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { student } from '../academics';
import { appUser } from '../iam';
import { consent } from './privacy.schema';

/** SQL только здесь: согласия законных представителей (ADR-021). */

export interface ConsentRecord {
  id: string;
  studentId: string | null;
  studentName: string | null;
  guardianUserId: string | null;
  guardianName: string | null;
  policyVersion: string;
  grantedVia: string;
  documentRef: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface ConsentListFilters {
  studentId?: string | undefined;
  active?: boolean | undefined;
  limit: number;
  offset: number;
}

export interface PrivacyRepository {
  listConsents(filters: ConsentListFilters): Promise<{ items: ConsentRecord[]; total: number }>;
  findConsent(id: string): Promise<ConsentRecord | null>;
  findActiveConsentForStudent(studentId: string): Promise<ConsentRecord | null>;
  insertConsent(
    input: {
      studentId: string;
      guardianUserId: string;
      policyVersion: string;
      grantedVia: string;
      documentRef: string | null;
    },
    executor?: Executor,
  ): Promise<{ id: string }>;
  revokeConsent(id: string, reason: string, executor?: Executor): Promise<void>;
  studentIdsWithActiveConsent(): Promise<string[]>;
  studentIdsWithAnyConsent(): Promise<string[]>;
}

const CONSENT_SELECTION = {
  id: consent.id,
  studentId: consent.subjectStudentId,
  studentName: student.fullName,
  guardianUserId: consent.guardianUserId,
  guardianName: appUser.fullName,
  policyVersion: consent.policyVersion,
  grantedVia: consent.grantedVia,
  documentRef: consent.documentRef,
  grantedAt: consent.grantedAt,
  revokedAt: consent.revokedAt,
  revokedReason: consent.revokedReason,
};

export function createPrivacyRepository(db: Database): PrivacyRepository {
  const readConsent = async (
    where: ReturnType<typeof and> | ReturnType<typeof eq> | undefined,
    limit = 1,
  ): Promise<ConsentRecord | null> => {
    const rows = await db.orm
      .select(CONSENT_SELECTION)
      .from(consent)
      .leftJoin(student, eq(student.id, consent.subjectStudentId))
      .leftJoin(appUser, eq(appUser.id, consent.guardianUserId))
      .where(where)
      .orderBy(desc(consent.grantedAt))
      .limit(limit);

    return rows[0] ?? null;
  };

  return {
    async listConsents(
      filters: ConsentListFilters,
    ): Promise<{ items: ConsentRecord[]; total: number }> {
      const conditions = [
        filters.studentId === undefined
          ? undefined
          : eq(consent.subjectStudentId, filters.studentId),
        filters.active === undefined
          ? undefined
          : filters.active
            ? isNull(consent.revokedAt)
            : sql`${consent.revokedAt} is not null`,
      ].filter((condition) => condition !== undefined);

      const where = conditions.length === 0 ? undefined : and(...conditions);

      const items = await db.orm
        .select(CONSENT_SELECTION)
        .from(consent)
        .leftJoin(student, eq(student.id, consent.subjectStudentId))
        .leftJoin(appUser, eq(appUser.id, consent.guardianUserId))
        .where(where)
        .orderBy(desc(consent.grantedAt))
        .limit(filters.limit)
        .offset(filters.offset);

      const totals = await db.orm
        .select({ count: sql<number>`count(*)::int` })
        .from(consent)
        .where(where);

      return { items, total: totals[0]?.count ?? 0 };
    },

    findConsent(id: string): Promise<ConsentRecord | null> {
      return readConsent(eq(consent.id, id));
    },

    findActiveConsentForStudent(studentId: string): Promise<ConsentRecord | null> {
      return readConsent(and(eq(consent.subjectStudentId, studentId), isNull(consent.revokedAt)));
    },

    async insertConsent(input, executor: Executor = db.orm): Promise<{ id: string }> {
      const rows = await executor
        .insert(consent)
        .values({
          subjectStudentId: input.studentId,
          guardianUserId: input.guardianUserId,
          policyVersion: input.policyVersion,
          grantedVia: input.grantedVia,
          documentRef: input.documentRef,
        })
        .returning({ id: consent.id });

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось зафиксировать согласие');
      return created;
    },

    async revokeConsent(id: string, reason: string, executor: Executor = db.orm): Promise<void> {
      await executor
        .update(consent)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(eq(consent.id, id));
    },

    async studentIdsWithActiveConsent(): Promise<string[]> {
      const rows = await db.orm
        .select({ studentId: consent.subjectStudentId })
        .from(consent)
        .where(isNull(consent.revokedAt));

      return rows.map((row) => row.studentId).filter((value): value is string => value !== null);
    },

    async studentIdsWithAnyConsent(): Promise<string[]> {
      const rows = await db.orm.select({ studentId: consent.subjectStudentId }).from(consent);

      return [
        ...new Set(
          rows.map((row) => row.studentId).filter((value): value is string => value !== null),
        ),
      ];
    },
  };
}
