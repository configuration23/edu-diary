import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common';

/** Учебные годы и периоды (Этап 1 создаёт первый год и период из мастера). */

export const academicYearSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  isActive: z.boolean(),
});
export type AcademicYearDto = z.infer<typeof academicYearSchema>;

export const periodKindSchema = z.enum(['term', 'semester', 'quarter']);
export type PeriodKindDto = z.infer<typeof periodKindSchema>;

export const periodSchema = z.object({
  id: uuidSchema,
  academicYearId: uuidSchema,
  title: z.string(),
  kind: periodKindSchema,
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  sort: z.number().int(),
});
export type PeriodDto = z.infer<typeof periodSchema>;

export const listAcademicYearsResponseSchema = z.object({
  items: z.array(academicYearSchema),
});
export type ListAcademicYearsResponseDto = z.infer<typeof listAcademicYearsResponseSchema>;

export const listPeriodsResponseSchema = z.object({
  items: z.array(periodSchema),
});
export type ListPeriodsResponseDto = z.infer<typeof listPeriodsResponseSchema>;

export const createAcademicYearRequestSchema = z.object({
  title: z.string().min(1).max(60),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  isActive: z.boolean().default(true),
});
export type CreateAcademicYearRequestDto = z.infer<typeof createAcademicYearRequestSchema>;

export const createPeriodRequestSchema = z.object({
  academicYearId: uuidSchema,
  title: z.string().min(1).max(60),
  kind: periodKindSchema,
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
});
export type CreatePeriodRequestDto = z.infer<typeof createPeriodRequestSchema>;
