import { index, inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';
import { appUser } from '../iam';

/**
 * Серверные сессии (ADR-004): в базе хранится только хеш токена, сам токен —
 * в cookie `httpOnly`. Сессию можно отозвать: увольнение, кража ноутбука.
 */
export const session = pgTable(
  'session',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('session_user_idx').on(table.userId)],
);
