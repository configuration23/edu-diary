import { z } from 'zod';

import { isoDateTimeSchema, pageSchema, paginationQuerySchema, uuidSchema } from './common';

/** Журнал изменений и доступа (ADR-012, ADR-017). Записи только добавляются. */

export const auditEntrySchema = z.object({
  id: uuidSchema,
  actorUserId: uuidSchema.nullable(),
  actorName: z.string().nullable(),
  actorIp: z.string().nullable(),
  action: z.string(),
  entityKind: z.string(),
  entityId: uuidSchema.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  context: z.unknown().nullable(),
  /** true — событие доступа к персональным данным, а не изменения (ADR-017). */
  isAccess: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type AuditEntryDto = z.infer<typeof auditEntrySchema>;

export const listAuditQuerySchema = paginationQuerySchema.extend({
  entityKind: z.string().max(60).optional(),
  entityId: uuidSchema.optional(),
  actorId: uuidSchema.optional(),
  action: z.string().max(80).optional(),
  /** Только события доступа к персональным данным (ADR-017). */
  accessOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});
export type ListAuditQueryDto = z.infer<typeof listAuditQuerySchema>;

export const listAuditResponseSchema = pageSchema(auditEntrySchema);
export type ListAuditResponseDto = z.infer<typeof listAuditResponseSchema>;
