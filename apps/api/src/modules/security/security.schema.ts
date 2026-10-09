import { index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';
import { appUser } from '../iam';

/**
 * События безопасности и инциденты (SECURITY.md §3.7).
 *
 * Задача системы — вовремя показать событие, а не «похоронить» его в логах:
 * события видны в админке, у каждого есть признак разбора.
 */
export const securityEvent = pgTable(
  'security_event',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** failed_login_burst | role_changed | account_locked | access_out_of_scope | mass_export */
    kind: text('kind').notNull(),
    /** info | warning | critical */
    severity: text('severity').notNull(),
    actorUserId: uuid('actor_user_id').references(() => appUser.id, { onDelete: 'set null' }),
    actorName: text('actor_name'),
    ip: inet('ip'),
    details: jsonb('details'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedBy: uuid('acknowledged_by').references(() => appUser.id, { onDelete: 'set null' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolution: text('resolution'),
  },
  (table) => [
    index('security_event_detected_idx').on(table.detectedAt),
    index('security_event_kind_idx').on(table.kind),
  ],
);
