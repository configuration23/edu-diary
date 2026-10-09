import { z } from 'zod';

import {
  isoDateTimeSchema,
  pageSchema,
  paginationQuerySchema,
  queryBooleanSchema,
  uuidSchema,
} from './common';

/** События безопасности и инциденты (SECURITY.md §3.7). */

export const securitySeveritySchema = z.enum(['info', 'warning', 'critical']);
export type SecuritySeverityDto = z.infer<typeof securitySeveritySchema>;

export const securityEventSchema = z.object({
  id: uuidSchema,
  kind: z.string(),
  severity: securitySeveritySchema,
  actorUserId: uuidSchema.nullable(),
  actorName: z.string().nullable(),
  ip: z.string().nullable(),
  details: z.unknown().nullable(),
  detectedAt: isoDateTimeSchema,
  acknowledgedBy: uuidSchema.nullable(),
  acknowledgedAt: isoDateTimeSchema.nullable(),
  resolution: z.string().nullable(),
});
export type SecurityEventDto = z.infer<typeof securityEventSchema>;

export const listSecurityEventsQuerySchema = paginationQuerySchema.extend({
  severity: securitySeveritySchema.optional(),
  acknowledged: queryBooleanSchema.optional(),
});
export type ListSecurityEventsQueryDto = z.infer<typeof listSecurityEventsQuerySchema>;

export const listSecurityEventsResponseSchema = pageSchema(securityEventSchema);
export type ListSecurityEventsResponseDto = z.infer<typeof listSecurityEventsResponseSchema>;

export const acknowledgeSecurityEventRequestSchema = z.object({
  resolution: z.string().max(500).optional(),
});
export type AcknowledgeSecurityEventRequestDto = z.infer<
  typeof acknowledgeSecurityEventRequestSchema
>;
