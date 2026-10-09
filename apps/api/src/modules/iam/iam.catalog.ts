import type { AccessScope } from '@edu-diary/domain';

/**
 * Каталог прав и роли «из коробки» (ARCHITECTURE.md §8).
 *
 * Каталог синхронизируется при старте приложения: новые права добавляются, уже
 * существующие роли не перезаписываются — администратор мог изменить набор прав.
 *
 * Область `own` для ученика означает «свои данные», для родителя — «данные своих
 * детей»: фильтрация выполняется в репозиториях (ADR-005), а не этой строкой.
 */

export interface PermissionDefinition {
  code: string;
  title: string;
  /** Область, которая обычно имеет смысл для этого права. */
  scopeHint: AccessScope;
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  { code: 'users:read', title: 'Просмотр пользователей', scopeHint: 'all' },
  { code: 'users:write', title: 'Создание и изменение пользователей', scopeHint: 'all' },
  { code: 'roles:read', title: 'Просмотр ролей и прав', scopeHint: 'all' },
  { code: 'roles:write', title: 'Изменение ролей и прав', scopeHint: 'all' },
  { code: 'students:read', title: 'Просмотр учеников', scopeHint: 'assigned' },
  { code: 'students:write', title: 'Создание и изменение учеников', scopeHint: 'all' },
  {
    code: 'academics:read',
    title: 'Просмотр учебных годов, периодов и справочников',
    scopeHint: 'all',
  },
  {
    code: 'academics:write',
    title: 'Изменение учебных годов, периодов и справочников',
    scopeHint: 'all',
  },
  { code: 'audit:read', title: 'Просмотр журнала изменений и доступа', scopeHint: 'all' },
  { code: 'security:read', title: 'Просмотр событий безопасности', scopeHint: 'all' },
  { code: 'security:write', title: 'Разбор событий безопасности', scopeHint: 'all' },
  { code: 'consents:read', title: 'Просмотр согласий на обработку ПДн', scopeHint: 'all' },
  { code: 'consents:write', title: 'Регистрация и отзыв согласий', scopeHint: 'all' },
  { code: 'policy:write', title: 'Публикация редакций политики обработки ПДн', scopeHint: 'all' },
  { code: 'settings:write', title: 'Изменение настроек и брендинга', scopeHint: 'all' },
  { code: 'grades:read', title: 'Просмотр оценок', scopeHint: 'own' },
  { code: 'grades:write', title: 'Выставление и правка оценок', scopeHint: 'assigned' },
  { code: 'attendance:read', title: 'Просмотр посещаемости', scopeHint: 'own' },
  { code: 'attendance:write', title: 'Отметки посещаемости', scopeHint: 'assigned' },
  { code: 'homework:read', title: 'Просмотр домашних заданий', scopeHint: 'own' },
  {
    code: 'homework:write',
    title: 'Публикация домашних заданий и сдача решений',
    scopeHint: 'assigned',
  },
  { code: 'homework:review', title: 'Проверка решений', scopeHint: 'assigned' },
  { code: 'analytics:read', title: 'Просмотр аналитики', scopeHint: 'assigned' },
  { code: 'analytics:export', title: 'Выгрузки и печать', scopeHint: 'assigned' },
];

export interface SystemRoleDefinition {
  code: string;
  title: string;
  permissions: readonly { permission: string; scope: AccessScope }[];
}

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    code: 'admin',
    title: 'Администратор',
    permissions: PERMISSIONS.map((permission) => ({
      permission: permission.code,
      scope: 'all' as AccessScope,
    })),
  },
  {
    code: 'teacher',
    title: 'Преподаватель',
    permissions: [
      { permission: 'students:read', scope: 'assigned' },
      { permission: 'academics:read', scope: 'all' },
      { permission: 'grades:read', scope: 'assigned' },
      { permission: 'grades:write', scope: 'assigned' },
      { permission: 'attendance:read', scope: 'assigned' },
      { permission: 'attendance:write', scope: 'assigned' },
      { permission: 'homework:read', scope: 'assigned' },
      { permission: 'homework:write', scope: 'assigned' },
      { permission: 'homework:review', scope: 'assigned' },
      { permission: 'analytics:read', scope: 'assigned' },
      { permission: 'analytics:export', scope: 'assigned' },
    ],
  },
  {
    code: 'student',
    title: 'Ученик',
    permissions: [
      { permission: 'students:read', scope: 'own' },
      { permission: 'grades:read', scope: 'own' },
      { permission: 'attendance:read', scope: 'own' },
      { permission: 'homework:read', scope: 'own' },
      { permission: 'homework:write', scope: 'own' },
      { permission: 'analytics:read', scope: 'own' },
    ],
  },
  {
    code: 'parent',
    title: 'Родитель',
    permissions: [
      // «own» для родителя означает «свои дети»: конкретные ученики определяются
      // привязками и проверяются в сервисе (ADR-005).
      { permission: 'students:read', scope: 'own' },
      { permission: 'grades:read', scope: 'own' },
      { permission: 'attendance:read', scope: 'own' },
      { permission: 'homework:read', scope: 'own' },
      { permission: 'analytics:read', scope: 'own' },
    ],
  },
];
