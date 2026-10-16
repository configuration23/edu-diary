import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common';

/**
 * Сдача решения учеником (Этап 5).
 *
 * Одна попытка, черновика нет; после урока-срока сдавать **можно**, но сдача помечается
 * опоздавшей. Факт сдачи не ставит оценку: её ставит преподаватель в журнале.
 */

/** Файл в решении: без пометки удаления — она нужна только в материалах задания. */
/**
 * Файл в решении.
 *
 * Отдельная схема от вложения задания: у файла решения нет пометки удаления и он всегда
 * привязан к сдаче, поэтому лишние поля здесь только путали бы.
 */
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
  /**
   * Сдано позже урока-срока.
   *
   * Сравниваем **по дате урока-срока**: если задание задано к занятию 15-го, а решение
   * принесли 16-го, это опоздание. Принимаем, но помечаем — решение владельца.
   */
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
  /** Урок-срок: до какого занятия задано. По нему видно, когда сдавать. */
  dueLessonId: uuidSchema,
  dueLessonDate: isoDateSchema,
  /** Может ли ученик сдавать: `false` — задание не его группы или уже сдано. */
  canSubmit: z.boolean(),
});
export type SubmissionStateDto = z.infer<typeof submissionStateSchema>;

export const listSubmissionsResponseSchema = z.object({
  items: z.array(submissionSchema),
  total: z.number().int().nonnegative(),
});
export type ListSubmissionsResponse = z.infer<typeof listSubmissionsResponseSchema>;
