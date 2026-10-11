import { z } from 'zod';

import {
  isoDateSchema,
  isoDateTimeSchema,
  pageSchema,
  paginationQuerySchema,
  queryBooleanSchema,
  uuidSchema,
} from './common';

/**
 * Расписание и уроки (Этап 3).
 *
 * Три сущности: **шаблон** (`schedule_entry`) — «в какой день недели, какой парой
 * и в какое время, в какой аудитории», действующий в заданном периоде;
 * **исключение** (`schedule_exception`) — изменение на конкретную дату; **урок**
 * (`lesson`) — занятие на дату, порождённое из шаблона.
 *
 * Шаблон ссылается на назначение (`assignment`): предмет, группа и преподаватель
 * берутся из него, поэтому в шаблоне их нет — иначе появились бы два источника
 * правды об одном и том же.
 */

export const MIN_PAIR_NUMBER = 1;
export const MAX_PAIR_NUMBER = 8;
export const MIN_DAY_OF_WEEK = 1;
export const MAX_DAY_OF_WEEK = 7;

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время в формате ЧЧ:ММ (например, 09:40)');

export const pairNumberSchema = z.number().int().min(MIN_PAIR_NUMBER).max(MAX_PAIR_NUMBER);
export const dayOfWeekSchema = z.number().int().min(MIN_DAY_OF_WEEK).max(MAX_DAY_OF_WEEK);

/** Шаблон расписания: занятие, повторяющееся каждую неделю. */
export const scheduleEntrySchema = z.object({
  id: uuidSchema,
  assignmentId: uuidSchema,
  studyGroupId: uuidSchema,
  groupName: z.string(),
  subjectId: uuidSchema,
  subjectName: z.string(),
  teacherUserId: uuidSchema,
  teacherName: z.string(),
  roomId: uuidSchema.nullable(),
  roomName: z.string().nullable(),
  dayOfWeek: dayOfWeekSchema,
  pairNumber: pairNumberSchema,
  timeStart: timeOfDaySchema,
  timeEnd: timeOfDaySchema,
  /** Действует с этой даты (включительно). */
  validFrom: isoDateSchema,
  /** `null` — до отмены шаблона. */
  validTo: isoDateSchema.nullable(),
});
export type ScheduleEntryDto = z.infer<typeof scheduleEntrySchema>;

export const listScheduleQuerySchema = paginationQuerySchema.extend({
  studyGroupId: uuidSchema.optional(),
  teacherUserId: uuidSchema.optional(),
  /** Студент или законный представитель: расписание групп, к которым есть доступ. */
  studentId: uuidSchema.optional(),
});
export type ListScheduleQueryDto = z.infer<typeof listScheduleQuerySchema>;

export const listScheduleResponseSchema = pageSchema(scheduleEntrySchema);
export type ListScheduleResponseDto = z.infer<typeof listScheduleResponseSchema>;

export const createScheduleEntryRequestSchema = z
  .object({
    assignmentId: uuidSchema,
    roomId: uuidSchema.nullable().optional(),
    dayOfWeek: dayOfWeekSchema,
    pairNumber: pairNumberSchema,
    timeStart: timeOfDaySchema,
    timeEnd: timeOfDaySchema,
    validFrom: isoDateSchema,
    validTo: isoDateSchema.nullable().optional(),
  })
  .refine((value) => value.timeStart < value.timeEnd, {
    message: 'Время начала позже времени окончания',
    path: ['timeEnd'],
  })
  .refine(
    (value) =>
      value.validTo === null || value.validTo === undefined || value.validFrom <= value.validTo,
    { message: 'Дата начала позже даты окончания', path: ['validTo'] },
  );
export type CreateScheduleEntryRequestDto = z.infer<typeof createScheduleEntryRequestSchema>;

export const updateScheduleEntryRequestSchema = z
  .object({
    roomId: uuidSchema.nullable().optional(),
    dayOfWeek: dayOfWeekSchema.optional(),
    pairNumber: pairNumberSchema.optional(),
    timeStart: timeOfDaySchema.optional(),
    timeEnd: timeOfDaySchema.optional(),
    validFrom: isoDateSchema.optional(),
    validTo: isoDateSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateScheduleEntryRequestDto = z.infer<typeof updateScheduleEntryRequestSchema>;

/**
 * Исключение на конкретную дату: отмена, перенос или замена.
 *
 * Хранится полезная нагрузка (`payload`), потому что действия различаются по
 * составу: отмене ничего не нужно, переносу — новое время и аудитория, замене —
 * новый преподаватель. Так одна таблица описывает все три случая.
 */
export const scheduleExceptionActionSchema = z.enum(['cancel', 'move', 'replace']);
export type ScheduleExceptionActionDto = z.infer<typeof scheduleExceptionActionSchema>;

export const scheduleExceptionSchema = z.object({
  id: uuidSchema,
  scheduleEntryId: uuidSchema,
  studyGroupId: uuidSchema,
  groupName: z.string(),
  exceptionDate: isoDateSchema,
  pairNumber: pairNumberSchema,
  action: scheduleExceptionActionSchema,
  payload: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type ScheduleExceptionDto = z.infer<typeof scheduleExceptionSchema>;

export const listScheduleExceptionsResponseSchema = pageSchema(scheduleExceptionSchema);
export type ListScheduleExceptionsResponseDto = z.infer<
  typeof listScheduleExceptionsResponseSchema
>;

export const createScheduleExceptionRequestSchema = z.object({
  scheduleEntryId: uuidSchema,
  exceptionDate: isoDateSchema,
  action: scheduleExceptionActionSchema,
  /** Для `move`: новые время и аудитория. Для `replace`: заменяющий преподаватель. */
  payload: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().max(500).optional(),
});
export type CreateScheduleExceptionRequestDto = z.infer<
  typeof createScheduleExceptionRequestSchema
>;

/** Статусы урока (ADR-006): запланирован, проведён, отменён, проведён заменой. */
export const lessonStatusSchema = z.enum(['planned', 'done', 'cancelled', 'replaced']);
export type LessonStatusDto = z.infer<typeof lessonStatusSchema>;

export const lessonSchema = z.object({
  id: uuidSchema,
  scheduleEntryId: uuidSchema.nullable(),
  assignmentId: uuidSchema,
  studyGroupId: uuidSchema,
  groupName: z.string(),
  subjectId: uuidSchema,
  subjectName: z.string(),
  /** Кто ведёт урок: при замене — заменяющий. */
  teacherUserId: uuidSchema,
  teacherName: z.string(),
  /** Кто должен был вести по расписанию: заполняется при замене. */
  plannedTeacherUserId: uuidSchema.nullable(),
  plannedTeacherName: z.string().nullable(),
  roomId: uuidSchema.nullable(),
  roomName: z.string().nullable(),
  lessonDate: isoDateSchema,
  pairNumber: pairNumberSchema,
  timeStart: timeOfDaySchema,
  timeEnd: timeOfDaySchema,
  topic: z.string().nullable(),
  lessonType: z.string().nullable(),
  status: lessonStatusSchema,
  /** Правку внесли вручную: повторная генерация такую запись не перезаписывает. */
  isManual: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type LessonDto = z.infer<typeof lessonSchema>;

export const listLessonsQuerySchema = paginationQuerySchema.extend({
  studyGroupId: uuidSchema.optional(),
  teacherUserId: uuidSchema.optional(),
  studentId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  status: lessonStatusSchema.optional(),
  /** Только занятия, где преподаватель заменён. */
  substitutedOnly: queryBooleanSchema.optional(),
});
export type ListLessonsQueryDto = z.infer<typeof listLessonsQuerySchema>;

export const listLessonsResponseSchema = pageSchema(lessonSchema);
export type ListLessonsResponseDto = z.infer<typeof listLessonsResponseSchema>;

export const updateLessonRequestSchema = z
  .object({
    topic: z.string().max(500).nullable().optional(),
    lessonType: z.string().max(60).nullable().optional(),
    roomId: uuidSchema.nullable().optional(),
    /** Перенос: новая дата, пара, время. */
    lessonDate: isoDateSchema.optional(),
    pairNumber: pairNumberSchema.optional(),
    timeStart: timeOfDaySchema.optional(),
    timeEnd: timeOfDaySchema.optional(),
    status: lessonStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateLessonRequestDto = z.infer<typeof updateLessonRequestSchema>;

/** Генерация уроков из шаблона на период. */
export const generateLessonsRequestSchema = z
  .object({
    studyGroupId: uuidSchema.optional(),
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((value) => value.from <= value.to, {
    message: 'Дата начала позже даты окончания',
    path: ['to'],
  });
export type GenerateLessonsRequestDto = z.infer<typeof generateLessonsRequestSchema>;

export const generateLessonsResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skippedManual: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  from: isoDateSchema,
  to: isoDateSchema,
});
export type GenerateLessonsResponseDto = z.infer<typeof generateLessonsResponseSchema>;

/** Замена преподавателя: на один урок либо на диапазон дат (ADR-009). */
export const substitutionSchema = z.object({
  id: uuidSchema,
  assignmentId: uuidSchema,
  lessonId: uuidSchema.nullable(),
  substituteUserId: uuidSchema,
  substituteName: z.string(),
  replacedUserId: uuidSchema,
  replacedName: z.string(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema.nullable(),
  reason: z.string(),
  createdByName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type SubstitutionDto = z.infer<typeof substitutionSchema>;

export const listSubstitutionsResponseSchema = pageSchema(substitutionSchema);
export type ListSubstitutionsResponseDto = z.infer<typeof listSubstitutionsResponseSchema>;

export const createSubstitutionRequestSchema = z
  .object({
    /** На один урок: тогда даты берутся из урока. */
    lessonId: uuidSchema.optional(),
    /** На диапазон дат: тогда указывается назначение и период. */
    assignmentId: uuidSchema.optional(),
    substituteUserId: uuidSchema,
    startsOn: isoDateSchema.optional(),
    endsOn: isoDateSchema.nullable().optional(),
    reason: z.string().min(3).max(500),
  })
  .refine((value) => value.lessonId !== undefined || value.assignmentId !== undefined, {
    message: 'Нужно указать урок или назначение',
  })
  .refine((value) => value.assignmentId === undefined || value.startsOn !== undefined, {
    message: 'Для замены на период нужна дата начала',
    path: ['startsOn'],
  });
export type CreateSubstitutionRequestDto = z.infer<typeof createSubstitutionRequestSchema>;
