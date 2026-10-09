import { and, desc, eq, gte, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { auditLog } from './audit.schema';

/** SQL только здесь: журнал аудита пишется и читается, но не изменяется. */

export interface AuditRecord {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorIp: string | null;
  action: string;
  entityKind: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  context: unknown;
  isAccess: boolean;
  createdAt: Date;
}

export interface AuditInsert {
  actorUserId: string | null;
  actorName: string | null;
  actorIp: string | null;
  action: string;
  entityKind: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  context: unknown;
  isAccess: boolean;
}

export interface AuditListFilters {
  entityKind?: string | undefined;
  entityId?: string | undefined;
  actorUserId?: string | undefined;
  action?: string | undefined;
  accessOnly?: boolean | undefined;
  limit: number;
  offset: number;
}

export interface AuditRepository {
  insert(record: AuditInsert, executor?: Executor): Promise<void>;
  list(filters: AuditListFilters): Promise<{ items: AuditRecord[]; total: number }>;
  countSince(action: string, since: Date): Promise<number>;
}

export function createAuditRepository(db: Database): AuditRepository {
  return {
    async insert(record: AuditInsert, executor: Executor = db.orm): Promise<void> {
      await executor.insert(auditLog).values({
        actorUserId: record.actorUserId,
        actorName: record.actorName,
        actorIp: record.actorIp,
        action: record.action,
        entityKind: record.entityKind,
        entityId: record.entityId,
        before: record.before,
        after: record.after,
        context: record.context,
        isAccess: record.isAccess,
      });
    },

    async list(filters: AuditListFilters): Promise<{ items: AuditRecord[]; total: number }> {
      const conditions = [
        filters.entityKind === undefined ? undefined : eq(auditLog.entityKind, filters.entityKind),
        filters.entityId === undefined ? undefined : eq(auditLog.entityId, filters.entityId),
        filters.actorUserId === undefined
          ? undefined
          : eq(auditLog.actorUserId, filters.actorUserId),
        filters.action === undefined ? undefined : eq(auditLog.action, filters.action),
        filters.accessOnly === true ? eq(auditLog.isAccess, true) : undefined,
      ].filter((condition) => condition !== undefined);

      const where = conditions.length === 0 ? undefined : and(...conditions);

      const items = await db.orm
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(filters.limit)
        .offset(filters.offset);

      const totals = await db.orm
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(where);

      return {
        items: items.map((row) => ({
          id: row.id,
          actorUserId: row.actorUserId,
          actorName: row.actorName,
          actorIp: row.actorIp,
          action: row.action,
          entityKind: row.entityKind,
          entityId: row.entityId,
          before: row.before,
          after: row.after,
          context: row.context,
          isAccess: row.isAccess,
          createdAt: row.createdAt,
        })),
        total: totals[0]?.count ?? 0,
      };
    },

    async countSince(action: string, since: Date): Promise<number> {
      const rows = await db.orm
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(and(eq(auditLog.action, action), gte(auditLog.createdAt, since)));

      return rows[0]?.count ?? 0;
    },
  };
}
