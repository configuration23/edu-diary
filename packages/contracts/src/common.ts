import { isISODate } from '@edu-diary/domain';
import { z } from 'zod';

/** Общие части контрактов: идентификаторы, даты, права, страницы списков. */

export const uuidSchema = z.uuid();

export const isoDateSchema = z
  .string()
  .refine(isISODate, { message: 'Ожидается календарная дата в формате YYYY-MM-DD' });

/** Момент времени в ISO 8601 с зоной (ADR-016: для событий, не для календаря). */
export const isoDateTimeSchema = z.string();

export const accessScopeSchema = z.enum(['own', 'group', 'assigned', 'all']);
export type AccessScopeDto = z.infer<typeof accessScopeSchema>;

export const permissionGrantSchema = z.object({
  permission: z.string().min(3).max(80),
  scope: accessScopeSchema,
});
export type PermissionGrantDto = z.infer<typeof permissionGrantSchema>;

export const roleSummarySchema = z.object({
  code: z.string(),
  title: z.string(),
});
export type RoleSummaryDto = z.infer<typeof roleSummarySchema>;

/** Значения строки запроса приходят строками, поэтому приводим типы явно. */
export const queryBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Страница списка: элементы и общее количество без учёта limit/offset. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
  });
}

export const emptyResponseSchema = z.object({});
