import { z } from 'zod';

import {
  accessScopeSchema,
  isoDateTimeSchema,
  pageSchema,
  paginationQuerySchema,
  permissionGrantSchema,
  queryBooleanSchema,
  roleSummarySchema,
  uuidSchema,
} from './common';

/** Пользователи, роли и права (модуль `iam`). */

export const userSummarySchema = z.object({
  id: uuidSchema,
  username: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  roles: z.array(roleSummarySchema),
  createdAt: isoDateTimeSchema,
});
export type UserSummaryDto = z.infer<typeof userSummarySchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().max(200).optional(),
  role: z.string().max(60).optional(),
  isActive: queryBooleanSchema.optional(),
});
export type ListUsersQueryDto = z.infer<typeof listUsersQuerySchema>;

export const listUsersResponseSchema = pageSchema(userSummarySchema);
export type ListUsersResponseDto = z.infer<typeof listUsersResponseSchema>;

export const createUserRequestSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, {
      message: 'Логин: строчные латинские буквы, цифры, точка, подчёркивание и дефис',
    }),
  fullName: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
  email: z.email().max(200).optional(),
  phone: z.string().max(40).optional(),
  roles: z.array(z.string().min(1).max(60)).max(20).default([]),
});
export type CreateUserRequestDto = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    fullName: z.string().min(1).max(200).optional(),
    email: z.email().max(200).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateUserRequestDto = z.infer<typeof updateUserRequestSchema>;

export const setUserRolesRequestSchema = z.object({
  roles: z.array(z.string().min(1).max(60)).max(20),
});
export type SetUserRolesRequestDto = z.infer<typeof setUserRolesRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  password: z.string().min(1).max(200),
});
export type ResetPasswordRequestDto = z.infer<typeof resetPasswordRequestSchema>;

export const permissionCatalogItemSchema = z.object({
  code: z.string(),
  title: z.string(),
  scopeHint: accessScopeSchema,
});
export type PermissionCatalogItemDto = z.infer<typeof permissionCatalogItemSchema>;

export const listPermissionsResponseSchema = z.object({
  items: z.array(permissionCatalogItemSchema),
});
export type ListPermissionsResponseDto = z.infer<typeof listPermissionsResponseSchema>;

export const roleDetailSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  title: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(permissionGrantSchema),
  userCount: z.number().int().nonnegative(),
});
export type RoleDetailDto = z.infer<typeof roleDetailSchema>;

export const listRolesResponseSchema = z.object({
  items: z.array(roleDetailSchema),
});
export type ListRolesResponseDto = z.infer<typeof listRolesResponseSchema>;

export const createRoleRequestSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, {
      message: 'Код роли: строчные латинские буквы, цифры, подчёркивание',
    }),
  title: z.string().min(1).max(120),
  permissions: z.array(permissionGrantSchema).max(200).default([]),
});
export type CreateRoleRequestDto = z.infer<typeof createRoleRequestSchema>;

export const updateRoleRequestSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    permissions: z.array(permissionGrantSchema).max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateRoleRequestDto = z.infer<typeof updateRoleRequestSchema>;
