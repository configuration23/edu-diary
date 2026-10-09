import { z } from 'zod';

import { isoDateTimeSchema, pageSchema, paginationQuerySchema, uuidSchema } from './common';

/** Политика обработки ПДн и согласия законных представителей (ADR-021). */

export const policyEditionSchema = z.object({
  version: z.string(),
  text: z.string(),
  publishedAt: isoDateTimeSchema,
  publishedByName: z.string().nullable(),
});
export type PolicyEditionDto = z.infer<typeof policyEditionSchema>;

export const policyResponseSchema = z.object({
  current: policyEditionSchema.nullable(),
  editions: z.array(policyEditionSchema),
});
export type PolicyResponseDto = z.infer<typeof policyResponseSchema>;

export const publishPolicyRequestSchema = z.object({
  version: z.string().min(1).max(40),
  text: z.string().min(20).max(50_000),
});
export type PublishPolicyRequestDto = z.infer<typeof publishPolicyRequestSchema>;

export const consentGrantedViaSchema = z.enum(['paper', 'electronic']);
export type ConsentGrantedViaDto = z.infer<typeof consentGrantedViaSchema>;

export const consentSchema = z.object({
  id: uuidSchema,
  /** Субъект — ученик; null появится, когда согласие будет оформляться на сотрудника. */
  studentId: uuidSchema.nullable(),
  studentName: z.string().nullable(),
  guardianUserId: uuidSchema.nullable(),
  guardianName: z.string().nullable(),
  policyVersion: z.string(),
  grantedAt: isoDateTimeSchema,
  grantedVia: consentGrantedViaSchema,
  documentRef: z.string().nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  revokedReason: z.string().nullable(),
});
export type ConsentDto = z.infer<typeof consentSchema>;

export const listConsentsQuerySchema = paginationQuerySchema.extend({
  studentId: uuidSchema.optional(),
  active: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});
export type ListConsentsQueryDto = z.infer<typeof listConsentsQuerySchema>;

export const listConsentsResponseSchema = pageSchema(consentSchema);
export type ListConsentsResponseDto = z.infer<typeof listConsentsResponseSchema>;

export const createConsentRequestSchema = z.object({
  studentId: uuidSchema,
  guardianUserId: uuidSchema,
  grantedVia: consentGrantedViaSchema,
  documentRef: z.string().max(200).optional(),
});
export type CreateConsentRequestDto = z.infer<typeof createConsentRequestSchema>;

export const revokeConsentRequestSchema = z.object({
  reason: z.string().min(3).max(300),
});
export type RevokeConsentRequestDto = z.infer<typeof revokeConsentRequestSchema>;

/** Список учеников без действующего согласия (SECURITY.md §3.5). */
export const studentsWithoutConsentResponseSchema = z.object({
  items: z.array(
    z.object({
      studentId: uuidSchema,
      fullName: z.string(),
      hasRevokedConsent: z.boolean(),
    }),
  ),
  total: z.number().int().nonnegative(),
});
export type StudentsWithoutConsentResponseDto = z.infer<
  typeof studentsWithoutConsentResponseSchema
>;
