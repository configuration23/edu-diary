import { z } from 'zod';

import {
  isoDateSchema,
  isoDateTimeSchema,
  pageSchema,
  paginationQuerySchema,
  uuidSchema,
} from './common';

/** Ученики и привязка законных представителей (Этап 1: минимум для согласий). */

export const guardianRelationSchema = z.enum(['mother', 'father', 'other']);
export type GuardianRelationDto = z.infer<typeof guardianRelationSchema>;

export const guardianLinkSchema = z.object({
  id: uuidSchema,
  guardianUserId: uuidSchema,
  guardianName: z.string(),
  guardianUsername: z.string(),
  relation: guardianRelationSchema.nullable(),
});
export type GuardianLinkDto = z.infer<typeof guardianLinkSchema>;

export const studentSummarySchema = z.object({
  id: uuidSchema,
  /** Учётная запись ученика: без неё он не увидит свои данные. */
  userId: uuidSchema.nullable(),
  /** Логин учётной записи: `null`, если учётной записи ещё нет. */
  username: z.string().nullable().default(null),
  fullName: z.string(),
  shortName: z.string().nullable(),
  birthDate: z.string().nullable(),
  note: z.string().nullable(),
});
export type StudentSummaryDto = z.infer<typeof studentSummarySchema>;

export const studentDetailSchema = studentSummarySchema.extend({
  guardians: z.array(guardianLinkSchema),
});
export type StudentDetailDto = z.infer<typeof studentDetailSchema>;

export const listStudentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().max(200).optional(),
});
export type ListStudentsQueryDto = z.infer<typeof listStudentsQuerySchema>;

export const listStudentsResponseSchema = pageSchema(studentSummarySchema);
export type ListStudentsResponseDto = z.infer<typeof listStudentsResponseSchema>;

/**
 * Учётная запись ученика создаётся по необходимости: карточка ученика — это
 * запись учебного процесса, а вход в систему нужен не всем и не сразу.
 * Логин и пароль передаются вместе с учеником, чтобы запись и учётная запись
 * создавались одной операцией.
 */
export const studentAccountRequestSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, {
      message: 'Логин: строчные латинские буквы, цифры, точка, подчёркивание и дефис',
    }),
  /** Временный пароль: при первом входе его нужно сменить. */
  password: z.string().min(1).max(200),
});
export type StudentAccountRequestDto = z.infer<typeof studentAccountRequestSchema>;

export const createStudentRequestSchema = z.object({
  fullName: z.string().min(1).max(200),
  shortName: z.string().max(60).optional(),
  birthDate: isoDateSchema.nullable().optional(),
  note: z.string().max(500).optional(),
  /** Привязка уже существующей учётной записи (например, созданной заранее). */
  userId: uuidSchema.nullable().optional(),
  /** Новая учётная запись ученика: необязательна. */
  account: studentAccountRequestSchema.optional(),
});
export type CreateStudentRequestDto = z.infer<typeof createStudentRequestSchema>;

export const updateStudentRequestSchema = z
  .object({
    fullName: z.string().min(1).max(200).optional(),
    shortName: z.string().max(60).nullable().optional(),
    birthDate: isoDateSchema.nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    userId: uuidSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateStudentRequestDto = z.infer<typeof updateStudentRequestSchema>;

export const linkGuardianRequestSchema = z.object({
  guardianUserId: uuidSchema,
  relation: guardianRelationSchema.optional(),
});
export type LinkGuardianRequestDto = z.infer<typeof linkGuardianRequestSchema>;

/** Ответ выгрузки списка: сам CSV отдаётся как text/csv, это только метаданные. */
export const exportInfoSchema = z.object({
  generatedAt: isoDateTimeSchema,
  rows: z.number().int().nonnegative(),
});
export type ExportInfoDto = z.infer<typeof exportInfoSchema>;

/**
 * Связь «ученик ↔ законный представитель» для списка: кто к кому привязан.
 *
 * Имя ученика добавлено к записи привязки: без него администратор не видит,
 * что привязка вообще есть (раньше была только форма).
 */
export const guardianLinkDetailSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  studentName: z.string(),
  guardianUserId: uuidSchema,
  guardianName: z.string(),
  guardianUsername: z.string(),
  relation: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type GuardianLinkDetailDto = z.infer<typeof guardianLinkDetailSchema>;

export const listGuardianLinksResponseSchema = pageSchema(guardianLinkDetailSchema);
export type ListGuardianLinksResponseDto = z.infer<typeof listGuardianLinksResponseSchema>;

/**
 * Подсказка логина по ФИО: транслитерация «Чумаков Сергей Петрович» → `chumakovsp`
 * с проверкой занятости (при совпадении добавляется цифра).
 */
export const suggestUsernameQuerySchema = z.object({
  fullName: z.string().min(1).max(200),
});
export type SuggestUsernameQueryDto = z.infer<typeof suggestUsernameQuerySchema>;

export const suggestUsernameResponseSchema = z.object({
  /** Готовый свободный логин; `null` — из ФИО ничего не получилось. */
  username: z.string().nullable(),
  /** Логины, которые уже заняты и потому пропущены. */
  taken: z.array(z.string()),
});
export type SuggestUsernameResponseDto = z.infer<typeof suggestUsernameResponseSchema>;
