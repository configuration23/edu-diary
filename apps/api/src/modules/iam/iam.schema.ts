import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../../shared/ids';
import { student } from '../academics';

/**
 * Пользователи, роли и привязки (модуль `iam`).
 *
 * Логин и почта — `citext`: регистр не важен, а уникальность гарантирует БД.
 * Расширение `citext` создаётся в первой миграции.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

export const appUser = pgTable('app_user', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  username: citext('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  email: citext('email'),
  phone: text('phone'),
  isActive: boolean('is_active').notNull().default(true),
  /** Учётка создана администратором: пароль нужно сменить при первом входе. */
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const role = pgTable('role', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  /** Системную роль нельзя удалить; набор прав при этом редактируется. */
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permission = pgTable('permission', {
  code: text('code').primaryKey(),
  title: text('title').notNull(),
});

export const rolePermission = pgTable(
  'role_permission',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permission.code, { onDelete: 'restrict' }),
    /** own | group | assigned | all (packages/domain, access.ts). */
    scope: text('scope').notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionCode] })],
);

export const userRole = pgTable(
  'user_role',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

/** Родитель (законный представитель) ↔ ученик. */
export const guardianLink = pgTable(
  'guardian_link',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'restrict' }),
    guardianUserId: uuid('guardian_user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    /** mother | father | other */
    relation: text('relation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('guardian_link_student_idx').on(table.studentId),
    index('guardian_link_user_idx').on(table.guardianUserId),
  ],
);
