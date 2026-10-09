import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { securityEvent } from './security.schema';

export interface SecurityEventRecord {
  id: string;
  kind: string;
  severity: string;
  actorUserId: string | null;
  actorName: string | null;
  ip: string | null;
  details: unknown;
  detectedAt: Date;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  resolution: string | null;
}

export interface SecurityEventInsert {
  kind: string;
  severity: string;
  actorUserId: string | null;
  actorName: string | null;
  ip: string | null;
  details: unknown;
}

export interface SecurityListFilters {
  severity?: string | undefined;
  acknowledged?: boolean | undefined;
  limit: number;
  offset: number;
}

export interface SecurityRepository {
  insert(record: SecurityEventInsert, executor?: Executor): Promise<void>;
  list(filters: SecurityListFilters): Promise<{ items: SecurityEventRecord[]; total: number }>;
  findById(id: string): Promise<SecurityEventRecord | null>;
  acknowledge(
    id: string,
    input: { acknowledgedBy: string | null; resolution: string | null },
    executor?: Executor,
  ): Promise<void>;
}

export function createSecurityRepository(db: Database): SecurityRepository {
  return {
    async insert(record: SecurityEventInsert, executor: Executor = db.orm): Promise<void> {
      await executor.insert(securityEvent).values({
        kind: record.kind,
        severity: record.severity,
        actorUserId: record.actorUserId,
        actorName: record.actorName,
        ip: record.ip,
        details: record.details,
      });
    },

    async list(
      filters: SecurityListFilters,
    ): Promise<{ items: SecurityEventRecord[]; total: number }> {
      const conditions = [
        filters.severity === undefined ? undefined : eq(securityEvent.severity, filters.severity),
        filters.acknowledged === undefined
          ? undefined
          : filters.acknowledged
            ? sql`${securityEvent.acknowledgedAt} is not null`
            : isNull(securityEvent.acknowledgedAt),
      ].filter((condition) => condition !== undefined);

      const where = conditions.length === 0 ? undefined : and(...conditions);

      const items = await db.orm
        .select()
        .from(securityEvent)
        .where(where)
        .orderBy(desc(securityEvent.detectedAt))
        .limit(filters.limit)
        .offset(filters.offset);

      const totals = await db.orm
        .select({ count: sql<number>`count(*)::int` })
        .from(securityEvent)
        .where(where);

      return {
        items: items.map((row) => ({
          id: row.id,
          kind: row.kind,
          severity: row.severity,
          actorUserId: row.actorUserId,
          actorName: row.actorName,
          ip: row.ip,
          details: row.details,
          detectedAt: row.detectedAt,
          acknowledgedBy: row.acknowledgedBy,
          acknowledgedAt: row.acknowledgedAt,
          resolution: row.resolution,
        })),
        total: totals[0]?.count ?? 0,
      };
    },

    async findById(id: string): Promise<SecurityEventRecord | null> {
      const rows = await db.orm
        .select()
        .from(securityEvent)
        .where(eq(securityEvent.id, id))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;

      return {
        id: row.id,
        kind: row.kind,
        severity: row.severity,
        actorUserId: row.actorUserId,
        actorName: row.actorName,
        ip: row.ip,
        details: row.details,
        detectedAt: row.detectedAt,
        acknowledgedBy: row.acknowledgedBy,
        acknowledgedAt: row.acknowledgedAt,
        resolution: row.resolution,
      };
    },

    async acknowledge(id, input, executor: Executor = db.orm): Promise<void> {
      await executor
        .update(securityEvent)
        .set({
          acknowledgedBy: input.acknowledgedBy,
          acknowledgedAt: new Date(),
          resolution: input.resolution,
        })
        .where(eq(securityEvent.id, id));
    },
  };
}
