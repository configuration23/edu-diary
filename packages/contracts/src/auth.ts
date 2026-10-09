import { z } from 'zod';

import { permissionGrantSchema, roleSummarySchema, uuidSchema } from './common';

/** Вход, текущий пользователь, смена пароля (ARCHITECTURE.md §8). */

export const currentUserSchema = z.object({
  id: uuidSchema,
  username: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  roles: z.array(roleSummarySchema),
});
export type CurrentUserDto = z.infer<typeof currentUserSchema>;

/** Ответ `GET /api/auth/me` и результат входа: пользователь и его права. */
export const sessionResponseSchema = z.object({
  user: currentUserSchema,
  permissions: z.array(permissionGrantSchema),
});
export type SessionResponseDto = z.infer<typeof sessionResponseSchema>;

export const loginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});
export type LoginRequestDto = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});
export type ChangePasswordRequestDto = z.infer<typeof changePasswordRequestSchema>;
