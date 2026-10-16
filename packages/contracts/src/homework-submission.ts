import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common';
import { attachmentSchema } from './homework';

/**
 * Сдача решения учеником (Этап 5).
 *
 * Одна попытка, черновика нет; после срока сдавать **можно**, но сдача помечается опоздавшей.
 * Факт сдачи не ставит оценку: её ставит преподаватель в журнале.
 */

/** Файл в решении: без пометки удаления — она нужна только в материалах задания. */
export const submissionFileSchema = z.object({
  id: uuidSchema,
  originalName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
});

export const submissionSchema = z.object({
  id: uuidSchema,
  assignmentId: uuidSchema,
  studentId: uuidSchema,
  studentName: z.string(),
  text: z.string(),
  submittedAt: z.string(),
  /** Сдано позже срока: показываем пометкой, но не запрещаем. */
  isLate: z.boolean(),
  files: z.array(submissionFileSchema),
});
export type SubmissionDto = z.infer<typeof submissionSchema>;

export const submitHomeworkRequestSchema = z.object({
  text: z.string().trim().max(4000).default(''),
  /** Идентификаторы уже загруженных файлов решения. */
  fileIds: z.array(uuidSchema).max(20).default([]),
});
export type SubmitHomeworkRequest = z.infer<typeof submitHomeworkRequestSchema>;

export const submissionStateSchema = z.object({
  /** Что сдал сам ученик: `null` — ещё не сдавал. */
  own: submissionSchema.nullable(),
  /** Срок сдачи: нужен, чтобы показать «сдать до» и опоздание. */
  dueOn: isoDateSchema.nullable(),
  /** Может ли ученик сдавать: `false` — задание не его группы или уже сдано. */
  canSubmit: z.boolean(),
});
export type SubmissionStateDto = z.infer<typeof submissionStateSchema>;

export const listSubmissionsResponseSchema = z.object({
  items: z.array(submissionSchema),
  total: z.number().int().nonnegative(),
});
export type ListSubmissionsResponse = z.infer<typeof listSubmissionsResponseSchema>;

export { attachmentSchema };
