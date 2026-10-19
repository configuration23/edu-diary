import { z } from 'zod';

import { isoDateTimeSchema, permissionGrantSchema, roleSummarySchema, uuidSchema } from './common';

/** Вход, текущий пользователь, смена пароля (ARCHITECTURE.md §8). */

/** Тема оформления: личный выбор, `system` — следовать настройке ОС. */
export const themePreferenceSchema = z.enum(['light', 'dark', 'system']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

/** Смена темы: только своя учётная запись. */
export const updateThemeRequestSchema = z.object({ theme: themePreferenceSchema });

/**
 * Вид страниц: `compact` — блоки свёрнуты в спойлеры, `expanded` — блоки показаны подряд.
 *
 * Личная настройка: одному удобно видеть всё сразу, другому — короткий обзор разделов.
 */
export const viewModeSchema = z.enum(['compact', 'expanded']);
export type ViewMode = z.infer<typeof viewModeSchema>;

export const updateViewModeRequestSchema = z.object({ viewMode: viewModeSchema });

/**
 * Своя сессия в списке «Устройства и входы».
 *
 * Токен и его хеш не отдаются никогда: список нужен, чтобы человек узнал свои устройства и закрыл
 * лишнее, а не чтобы получить доступ.
 */
export const sessionSummarySchema = z.object({
  id: uuidSchema,
  /** Подпись устройства из User-Agent: «Chrome · Windows». */
  device: z.string(),
  ip: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
  /** Истечёт от простоя. */
  expiresAt: isoDateTimeSchema,
  /** Жёсткий предел: его активность не продлевает. */
  absoluteExpiresAt: isoDateTimeSchema,
  current: z.boolean(),
});
export type SessionSummaryDto = z.infer<typeof sessionSummarySchema>;

export const listSessionsResponseSchema = z.object({
  items: z.array(sessionSummarySchema),
  /** Сколько минут бездействия завершают сессию: число берётся с сервера, чтобы подсказка не врала. */
  idleMinutes: z.number().int().positive(),
});

export const revokeOtherSessionsResponseSchema = z.object({
  removed: z.number().int().nonnegative(),
});

export const currentUserSchema = z.object({
  id: uuidSchema,
  username: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  theme: themePreferenceSchema,
  viewMode: viewModeSchema,
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
