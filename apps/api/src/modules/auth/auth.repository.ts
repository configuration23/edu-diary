import { and, desc, eq, gt, lt, ne } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { session } from './auth.schema';

/** SQL только здесь: серверные сессии (ADR-004). */

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  /** Когда сессия истечёт от простоя. */
  expiresAt: Date;
  /** Жёсткий предел: его не продлевает никакая активность. */
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  userAgent: string | null;
  ip: string | null;
}

export interface AuthRepository {
  insert(
    input: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      userAgent: string | null;
      ip: string | null;
    },
    executor?: Executor,
  ): Promise<SessionRecord>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  renew(id: string, expiresAt: Date, executor?: Executor): Promise<void>;
  deleteByTokenHash(tokenHash: string, executor?: Executor): Promise<void>;
  deleteByUserId(
    userId: string,
    options: { exceptSessionId?: string | undefined },
    executor?: Executor,
  ): Promise<void>;
  deleteExpired(before: Date, executor?: Executor): Promise<number>;
  /** Активные сессии человека: список «устройства и входы». */
  listByUserId(userId: string): Promise<SessionRecord[]>;
  /** Отзыв одной сессии: только своя — проверяет сервис. */
  deleteById(id: string, executor?: Executor): Promise<void>;
}

export function createAuthRepository(db: Database): AuthRepository {
  return {
    async insert(input, executor: Executor = db.orm): Promise<SessionRecord> {
      const rows = await executor
        .insert(session)
        .values({
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          absoluteExpiresAt: input.absoluteExpiresAt,
          userAgent: input.userAgent,
          ip: input.ip,
          lastSeenAt: new Date(),
        })
        .returning();

      const created = rows[0];
      if (created === undefined) throw new Error('Не удалось создать сессию');

      return {
        id: created.id,
        userId: created.userId,
        tokenHash: created.tokenHash,
        expiresAt: created.expiresAt,
        absoluteExpiresAt: created.absoluteExpiresAt,
        lastSeenAt: created.lastSeenAt,
        createdAt: created.createdAt,
        userAgent: created.userAgent,
        ip: created.ip,
      };
    },

    async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
      const rows = await db.orm
        .select()
        .from(session)
        .where(eq(session.tokenHash, tokenHash))
        .limit(1);

      const row = rows[0];
      if (row === undefined) return null;

      return {
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        userAgent: row.userAgent,
        ip: row.ip,
      };
    },

    async renew(id: string, expiresAt: Date, executor: Executor = db.orm): Promise<void> {
      await executor
        .update(session)
        .set({ expiresAt, lastSeenAt: new Date() })
        .where(eq(session.id, id));
    },

    async deleteByTokenHash(tokenHash: string, executor: Executor = db.orm): Promise<void> {
      await executor.delete(session).where(eq(session.tokenHash, tokenHash));
    },

    async deleteByUserId(userId, options, executor: Executor = db.orm): Promise<void> {
      const where =
        options.exceptSessionId === undefined
          ? eq(session.userId, userId)
          : and(eq(session.userId, userId), ne(session.id, options.exceptSessionId));

      await executor.delete(session).where(where);
    },

    async listByUserId(userId: string): Promise<SessionRecord[]> {
      const rows = await db.orm
        .select()
        .from(session)
        .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
        .orderBy(desc(session.lastSeenAt));

      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        userAgent: row.userAgent,
        ip: row.ip,
      }));
    },

    async deleteById(id: string, executor: Executor = db.orm): Promise<void> {
      await executor.delete(session).where(eq(session.id, id));
    },

    async deleteExpired(before: Date, executor: Executor = db.orm): Promise<number> {
      const rows = await executor
        .delete(session)
        .where(lt(session.expiresAt, before))
        .returning({ id: session.id });

      return rows.length;
    },
  };
}
