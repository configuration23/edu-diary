import { z } from 'zod';

import { isoDateSchema } from './common';
import { databaseCheckSchema, migrationsCheckSchema } from './health';
import { sessionResponseSchema } from './auth';

/** Мастер первого запуска (ADR-014, ARCHITECTURE.md §9). */

/** Логотип передаётся как data-URL: файловое хранилище появляется на Этапе 5. */
export const LOGO_MAX_BYTES = 256 * 1024;

export const logoDataUrlSchema = z
  .string()
  .max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 64)
  .refine((value) => /^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value), {
    message: 'Ожидается data-URL картинки (png, jpeg или svg)',
  })
  .refine(
    (value) => {
      const payload = value.slice(value.indexOf(',') + 1);
      return Math.floor((payload.length * 3) / 4) <= LOGO_MAX_BYTES;
    },
    { message: 'Логотип больше 256 КБ' },
  );

export const brandingSchema = z.object({
  title: z.string().nullable(),
  shortName: z.string().nullable(),
  signature: z.string().nullable(),
  logoDataUrl: z.string().nullable(),
});
export type BrandingDto = z.infer<typeof brandingSchema>;

export const setupStatusResponseSchema = z.object({
  initialized: z.boolean(),
  checks: z.object({
    database: databaseCheckSchema,
    migrations: migrationsCheckSchema,
  }),
  branding: brandingSchema,
});
export type SetupStatusResponseDto = z.infer<typeof setupStatusResponseSchema>;

export const setupCompleteRequestSchema = z.object({
  institution: z.object({
    title: z.string().min(1).max(200),
    shortName: z.string().max(40).optional(),
    signature: z.string().max(200).optional(),
    logoDataUrl: logoDataUrlSchema.optional(),
  }),
  academicYear: z.object({
    title: z.string().min(1).max(60),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
  }),
  period: z.object({
    title: z.string().min(1).max(60),
    kind: z.enum(['term', 'semester', 'quarter']),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
  }),
  admin: z.object({
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
  }),
  storage: z
    .object({
      provider: z.literal('local'),
      path: z.string().max(500).optional(),
    })
    .optional(),
});
export type SetupCompleteRequestDto = z.infer<typeof setupCompleteRequestSchema>;

export const setupCompleteResponseSchema = z.object({
  initialized: z.literal(true),
  session: sessionResponseSchema,
});
export type SetupCompleteResponseDto = z.infer<typeof setupCompleteResponseSchema>;
