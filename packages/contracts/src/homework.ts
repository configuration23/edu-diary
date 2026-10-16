import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common';

/**
 * Домашние задания (Этап 5).
 *
 * Задание привязано к **уроку**: учитель ставит его в журнале, там же видит, кто сдал.
 * «Продолжительное» задание не размножается: это одно задание, видимое во всех уроках
 * предмета до `visibleUntil`, и сдаётся оно один раз (решение владельца).
 *
 * Вложение описывается **ссылкой на файл**, а не содержимым: файлы лежат в хранилище и
 * выдаются отдельным маршрутом с проверкой прав.
 */

/** Вложение: то, что видно в задании или в решении. */
export const attachmentSchema = z.object({
  id: uuidSchema,
  /** Имя файла, как его видит человек. */
  originalName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  /**
   * Пометка «удалён».
   *
   * Файлы не стираются (решение владельца): запись остаётся, но в интерфейсе помечается,
   * чтобы было видно — было и удалено.
   */
  isDeleted: z.boolean(),
  createdAt: z.string(),
});
export type AttachmentDto = z.infer<typeof attachmentSchema>;

/** Ссылка: учебник, статья, видео. Подпись необязательна. */
export const homeworkLinkSchema = z.object({
  id: uuidSchema,
  url: z.string().url('Укажите полный адрес ссылки'),
  title: z.string().max(200).nullish(),
});
export type HomeworkLinkDto = z.infer<typeof homeworkLinkSchema>;

/** Задание целиком: текст, срок, вложения и ссылки. */
export const homeworkAssignmentSchema = z.object({
  id: uuidSchema,
  lessonId: uuidSchema,
  text: z.string(),
  /** Срок сдачи; `null` — без срока. */
  dueOn: isoDateSchema.nullable(),
  /** До какого числа задание видно в уроках предмета; `null` — только в своём уроке. */
  visibleUntil: isoDateSchema.nullable(),
  files: z.array(attachmentSchema),
  links: z.array(homeworkLinkSchema),
  createdAt: z.string(),
});
export type HomeworkAssignmentDto = z.infer<typeof homeworkAssignmentSchema>;

/**
 * Задание с уроком и сведениями о сдаче — то, что видно в журнале урока.
 *
 * `submittedCount` и `studentCount` нужны учителю сразу: «сдали 12 из 25» понятнее, чем
 * список из двадцати пяти человек.
 */
export const homeworkAssignmentSummarySchema = homeworkAssignmentSchema.extend({
  lessonDate: isoDateSchema,
  groupName: z.string(),
  subjectName: z.string(),
  submittedCount: z.number().int().nonnegative(),
  studentCount: z.number().int().nonnegative(),
});
export type HomeworkAssignmentSummaryDto = z.infer<typeof homeworkAssignmentSummarySchema>;

/** Вложение в запросе: файл уже загружен и получил идентификатор. */
export const attachmentInputSchema = z.object({
  /** Идентификатор загруженного файла: загрузка и привязка разделены. */
  fileId: uuidSchema,
});

export const createHomeworkRequestSchema = z.object({
  lessonId: uuidSchema,
  text: z.string().trim().max(4000).default(''),
  dueOn: isoDateSchema.nullish(),
  visibleUntil: isoDateSchema.nullish(),
  links: z
    .array(
      z.object({
        url: z.string().url('Укажите полный адрес ссылки').max(2000),
        title: z.string().trim().max(200).nullish(),
      }),
    )
    .max(20)
    .default([]),
  /** Файлы: идентификаторы уже загруженных вложений. */
  fileIds: z.array(uuidSchema).max(20).default([]),
});
export type CreateHomeworkRequest = z.infer<typeof createHomeworkRequestSchema>;

export const updateHomeworkRequestSchema = z.object({
  text: z.string().trim().max(4000).optional(),
  dueOn: isoDateSchema.nullish(),
  visibleUntil: isoDateSchema.nullish(),
  links: z
    .array(
      z.object({
        url: z.string().url('Укажите полный адрес ссылки').max(2000),
        title: z.string().trim().max(200).nullish(),
      }),
    )
    .max(20)
    .optional(),
  fileIds: z.array(uuidSchema).max(20).optional(),
});
export type UpdateHomeworkRequest = z.infer<typeof updateHomeworkRequestSchema>;

export const listHomeworkQuerySchema = z.object({
  /** Задания одного урока. */
  lessonId: uuidSchema.optional(),
  /** Задания группы: нужны разделу со списком. */
  studyGroupId: uuidSchema.optional(),
  /** Только те, что видны на дату: так ученик получает свои задания. */
  onDate: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListHomeworkQuery = z.infer<typeof listHomeworkQuerySchema>;

export const listHomeworkResponseSchema = z.object({
  items: z.array(homeworkAssignmentSummarySchema),
  total: z.number().int().nonnegative(),
});
export type ListHomeworkResponse = z.infer<typeof listHomeworkResponseSchema>;

/**
 * Ответ на загрузку файла.
 *
 * Идентификатор вложения отдаётся сразу: файл загружается до сохранения задания, иначе
 * пришлось бы держать форму открытой во время передачи большого файла.
 */
export const uploadFileResponseSchema = z.object({
  id: uuidSchema,
  originalName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
});
export type UploadFileResponse = z.infer<typeof uploadFileResponseSchema>;
