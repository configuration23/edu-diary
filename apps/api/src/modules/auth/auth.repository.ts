import { eq, lt, and, ne } from 'drizzle-orm';

import type { Database, Executor } from '../../shared/db/client';
import { session } from './auth.schema';

/** SQL только здесь: серверные сессии (ADR-004). */

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface AuthRepository {
  insert(
    input: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
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
        lastSeenAt: created.lastSeenAt,
        createdAt: created.createdAt,
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
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
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

    async deleteExpired(before: Date, executor: Executor = db.orm): Promise<number> {
      const rows = await executor
        .delete(session)
        .where(lt(session.expiresAt, before))
        .returning({ id: session.id });

      return rows.length;
    },
  };
}
