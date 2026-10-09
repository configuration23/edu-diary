import { boolean, index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';
import { appUser } from '../iam';

/**
 * Журнал изменений и доступа (ADR-012, ADR-017).
 *
 * Записи только добавляются: у репозитория нет методов изменения и удаления, а
 * маршрутов PATCH/DELETE для аудита не существует (SECURITY.md §3.4).
 *
 * `actorName` — снимок имени на момент действия: запись остаётся читаемой, даже
 * если учётную запись позже деактивируют или переименуют.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    actorUserId: uuid('actor_user_id').references(() => appUser.id, { onDelete: 'set null' }),
    actorName: text('actor_name'),
    actorIp: inet('actor_ip'),
    /** create | update | delete | login | logout | login_failed | access | export | publish … */
    action: text('action').notNull(),
    entityKind: text('entity_kind').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    context: jsonb('context'),
    /** true — событие доступа к персональным данным, а не изменения (ADR-017). */
    isAccess: boolean('is_access').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_created_idx').on(table.createdAt),
    index('audit_log_entity_idx').on(table.entityKind, table.entityId),
    index('audit_log_actor_idx').on(table.actorUserId),
  ],
);
