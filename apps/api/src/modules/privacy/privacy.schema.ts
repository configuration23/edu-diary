import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';
import { student } from '../academics';
import { appUser } from '../iam';

/**
 * Согласие законного представителя на обработку персональных данных (ADR-021).
 *
 * Запись фиксирует связь «согласие → редакция политики → дата и способ
 * получения». Отзыв — не удаление: заполняются `revokedAt` и `revokedReason`,
 * сама запись остаётся.
 */
export const consent = pgTable(
  'consent',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** Субъект — ученик (для несовершеннолетних) либо сотрудник. */
    subjectStudentId: uuid('subject_student_id').references(() => student.id, {
      onDelete: 'restrict',
    }),
    subjectUserId: uuid('subject_user_id').references(() => appUser.id, { onDelete: 'restrict' }),
    guardianUserId: uuid('guardian_user_id').references(() => appUser.id, {
      onDelete: 'restrict',
    }),
    policyVersion: text('policy_version').notNull(),
    /** paper | electronic */
    grantedVia: text('granted_via').notNull(),
    documentRef: text('document_ref'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('consent_student_idx').on(table.subjectStudentId),
    index('consent_guardian_idx').on(table.guardianUserId),
  ],
);
