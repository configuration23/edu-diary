import { z } from 'zod';

import { isoDateSchema, uuidSchema } from './common';

/**
 * Домашние задания (Этап 5).
 *
 * Модель **без дат**: у задания есть **урок-срок** — до какого занятия оно задано. Учитель
 * выбирает его из ближайших уроков того же предмета и группы, а по умолчанию подставляется
 * следующий урок по расписанию. Датами оперировать неудобно, и они порождают ошибки: учитель
 * указывает совсем другие числа.
 *
 * Ученик видит задание **в уроке-сроке и во всех промежуточных уроках**, поэтому «долгая
 * домашка и короткая рядом» не мешают друг другу — у каждой свой срок.
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

/**
 * Задание целиком.
 *
 * Две даты, и обе нужны: `lessonDate` — **когда задали** (учитель видит «домашняя работа от
 * 8-го»), `dueLessonDate` — **когда сдавать** (ученик видит «сдать до 15-го»).
 */
export const homeworkAssignmentSchema = z.object({
  id: uuidSchema,
  lessonId: uuidSchema,
  /** Дата урока, на котором задание задано. */
  lessonDate: isoDateSchema,
  /** Урок-срок: до какого занятия задано. */
  dueLessonId: uuidSchema,
  /** Дата урока-срока: то, «до какого числа» сдать. */
  dueLessonDate: isoDateSchema,
  text: z.string(),
  files: z.array(attachmentSchema),
  links: z.array(homeworkLinkSchema),
  createdAt: z.string(),
});
export type HomeworkAssignmentDto = z.infer<typeof homeworkAssignmentSchema>;

/** Задание со сведениями о группе и сдаче — то, что видно в списках. */
export const homeworkAssignmentSummarySchema = homeworkAssignmentSchema.extend({
  groupName: z.string(),
  subjectName: z.string(),
  submittedCount: z.number().int().nonnegative(),
  studentCount: z.number().int().nonnegative(),
});
export type HomeworkAssignmentSummaryDto = z.infer<typeof homeworkAssignmentSummarySchema>;

export const createHomeworkRequestSchema = z.object({
  lessonId: uuidSchema,
  /**
   * Урок-срок. Не задан — сервер подставит **следующий урок** того же предмета и группы; если
   * следующего нет, сроком станет сам урок.
   */
  dueLessonId: uuidSchema.nullish(),
  text: z.string().trim().max(4000).default(''),
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
  dueLessonId: uuidSchema.optional(),
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
  /** Задания группы: нужны разделу со списком. */
  studyGroupId: uuidSchema.optional(),
  /** Задания, сдать которые нужно **в эти даты включительно**. */
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListHomeworkQuery = z.infer<typeof listHomeworkQuerySchema>;

export const listHomeworkResponseSchema = z.object({
  items: z.array(homeworkAssignmentSummarySchema),
  total: z.number().int().nonnegative(),
});
export type ListHomeworkResponse = z.infer<typeof listHomeworkResponseSchema>;

/** Ответ на загрузку файла. */
export const uploadFileResponseSchema = z.object({
  id: uuidSchema,
  originalName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
});
export type UploadFileResponse = z.infer<typeof uploadFileResponseSchema>;

/** Ближайшие уроки: из них учитель выбирает срок вместо ввода даты. */
export const dueLessonOptionSchema = z.object({
  lessonId: uuidSchema,
  lessonDate: isoDateSchema,
  pairNumber: z.number().int(),
});
export type DueLessonOptionDto = z.infer<typeof dueLessonOptionSchema>;

export const dueLessonOptionsResponseSchema = z.object({
  items: z.array(dueLessonOptionSchema),
});
export type DueLessonOptionsResponse = z.infer<typeof dueLessonOptionsResponseSchema>;

/** Что видно в уроке: заданное здесь и то, что сдать к этому уроку. */
export const lessonHomeworkResponseSchema = z.object({
  assignedHere: z.array(homeworkAssignmentSummarySchema),
  dueHere: z.array(homeworkAssignmentSummarySchema),
  dueOptions: z.array(dueLessonOptionSchema),
});
export type LessonHomeworkResponse = z.infer<typeof lessonHomeworkResponseSchema>;

/**
 * Отметка о домашнем задании для расписания.
 *
 * В расписании не нужен текст задания — нужно видеть, **есть ли оно**:
 * - ученику — что на эту дату задано (и сдано ли уже);
 * - преподавателю — что он в этот день дз задавал.
 */
export const lessonHomeworkFlagSchema = z.object({
  lessonId: uuidSchema,
  /** Задано **на** этом уроке: преподаватель видит, что уже ставил. */
  assignedHere: z.number().int().nonnegative(),
  /** Нужно сдать **к** этому уроку: ученик видит, что задано на эту дату. */
  dueHere: z.number().int().nonnegative(),
  /** Сколько заданий к этому уроку ученик уже сдал. */
  submittedHere: z.number().int().nonnegative(),
});
export type LessonHomeworkFlagDto = z.infer<typeof lessonHomeworkFlagSchema>;

export const lessonHomeworkFlagsResponseSchema = z.object({
  items: z.array(lessonHomeworkFlagSchema),
});
export type LessonHomeworkFlagsResponse = z.infer<typeof lessonHomeworkFlagsResponseSchema>;
