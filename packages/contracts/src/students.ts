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

export const createStudentRequestSchema = z.object({
  fullName: z.string().min(1).max(200),
  shortName: z.string().max(60).optional(),
  birthDate: isoDateSchema.nullable().optional(),
  note: z.string().max(500).optional(),
  /** Привязка учётной записи ученика (если она уже создана администратором). */
  userId: uuidSchema.nullable().optional(),
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
