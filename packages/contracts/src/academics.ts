import { isValidDateRange } from '@edu-diary/domain';
import { z } from 'zod';

import { isoDateSchema, pageSchema, paginationQuerySchema, uuidSchema } from './common';
import { logoDataUrlSchema } from './setup';

/** Учебные годы и периоды (Этап 1 создаёт первый год и период из мастера). */

export const academicYearSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  isActive: z.boolean(),
});
export type AcademicYearDto = z.infer<typeof academicYearSchema>;

export const periodKindSchema = z.enum(['term', 'semester', 'quarter']);
export type PeriodKindDto = z.infer<typeof periodKindSchema>;

export const periodSchema = z.object({
  id: uuidSchema,
  academicYearId: uuidSchema,
  title: z.string(),
  kind: periodKindSchema,
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  sort: z.number().int(),
});
export type PeriodDto = z.infer<typeof periodSchema>;

export const listAcademicYearsResponseSchema = z.object({
  items: z.array(academicYearSchema),
});
export type ListAcademicYearsResponseDto = z.infer<typeof listAcademicYearsResponseSchema>;

export const listPeriodsResponseSchema = z.object({
  items: z.array(periodSchema),
});
export type ListPeriodsResponseDto = z.infer<typeof listPeriodsResponseSchema>;

export const createAcademicYearRequestSchema = z.object({
  title: z.string().min(1).max(60),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  isActive: z.boolean().default(true),
});
export type CreateAcademicYearRequestDto = z.infer<typeof createAcademicYearRequestSchema>;

export const createPeriodRequestSchema = z.object({
  academicYearId: uuidSchema,
  title: z.string().min(1).max(60),
  kind: periodKindSchema,
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
});
export type CreatePeriodRequestDto = z.infer<typeof createPeriodRequestSchema>;

/** Год вместе с периодами: экран «Учебный год» открывается одним запросом. */
export const academicYearWithPeriodsSchema = academicYearSchema.extend({
  periods: z.array(periodSchema),
});
export type AcademicYearWithPeriodsDto = z.infer<typeof academicYearWithPeriodsSchema>;

export const updateAcademicYearRequestSchema = z
  .object({
    title: z.string().min(1).max(60).optional(),
    startsOn: isoDateSchema.optional(),
    endsOn: isoDateSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateAcademicYearRequestDto = z.infer<typeof updateAcademicYearRequestSchema>;

export const updatePeriodRequestSchema = z
  .object({
    title: z.string().min(1).max(60).optional(),
    kind: periodKindSchema.optional(),
    startsOn: isoDateSchema.optional(),
    endsOn: isoDateSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdatePeriodRequestDto = z.infer<typeof updatePeriodRequestSchema>;

// --- Группы и зачисления (Этап 2) ---

export const studyGroupSchema = z.object({
  id: uuidSchema,
  academicYearId: uuidSchema,
  name: z.string(),
  course: z.number().int().nullable(),
  specialty: z.string().nullable(),
  curatorUserId: uuidSchema.nullable(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  /** Сколько учеников числится в группе сейчас (без отчисленных). */
  studentsCount: z.number().int().nonnegative().default(0),
});
export type StudyGroupDto = z.infer<typeof studyGroupSchema>;

export const listGroupsQuerySchema = z.object({
  academicYearId: uuidSchema.optional(),
  search: z.string().max(200).optional(),
});
export type ListGroupsQueryDto = z.infer<typeof listGroupsQuerySchema>;

export const listGroupsResponseSchema = z.object({
  items: z.array(studyGroupSchema),
});
export type ListGroupsResponseDto = z.infer<typeof listGroupsResponseSchema>;

export const createGroupRequestSchema = z.object({
  academicYearId: uuidSchema,
  name: z.string().min(1).max(60),
  course: z.number().int().min(1).max(6).nullable().optional(),
  specialty: z.string().max(120).nullable().optional(),
  curatorUserId: uuidSchema.nullable().optional(),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
});
export type CreateGroupRequestDto = z.infer<typeof createGroupRequestSchema>;

export const updateGroupRequestSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    course: z.number().int().min(1).max(6).nullable().optional(),
    specialty: z.string().max(120).nullable().optional(),
    curatorUserId: uuidSchema.nullable().optional(),
    startsOn: isoDateSchema.optional(),
    endsOn: isoDateSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateGroupRequestDto = z.infer<typeof updateGroupRequestSchema>;

export const enrollmentSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  studyGroupId: uuidSchema,
  studentName: z.string(),
  joinedOn: isoDateSchema,
  /** `null` — ученик числится в группе сейчас. */
  leftOn: isoDateSchema.nullable(),
  note: z.string().nullable(),
});
export type EnrollmentDto = z.infer<typeof enrollmentSchema>;

export const listEnrollmentsResponseSchema = z.object({
  items: z.array(enrollmentSchema),
});
export type ListEnrollmentsResponseDto = z.infer<typeof listEnrollmentsResponseSchema>;

export const enrollStudentRequestSchema = z.object({
  studentId: uuidSchema,
  joinedOn: isoDateSchema,
  note: z.string().max(500).optional(),
});
export type EnrollStudentRequestDto = z.infer<typeof enrollStudentRequestSchema>;

/** Отчисление: закрываем зачисление датой, запись сохраняется в истории. */
export const withdrawStudentRequestSchema = z.object({
  leftOn: isoDateSchema,
});
export type WithdrawStudentRequestDto = z.infer<typeof withdrawStudentRequestSchema>;

/** Перевод: закрыть текущее зачисление и открыть новое одной операцией. */
export const transferStudentRequestSchema = z.object({
  studyGroupId: uuidSchema,
  transferOn: isoDateSchema,
  note: z.string().max(500).optional(),
});
export type TransferStudentRequestDto = z.infer<typeof transferStudentRequestSchema>;

export const enrollStudentResponseSchema = z.object({
  enrollment: enrollmentSchema,
});
export type EnrollStudentResponseDto = z.infer<typeof enrollStudentResponseSchema>;

// --- Справочники: предметы, аудитории, категории оценок (Этап 2) ---

export const subjectKindSchema = z.enum(['mandatory', 'optional', 'practice']);
export type SubjectKindDto = z.infer<typeof subjectKindSchema>;

export const subjectSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  shortName: z.string().nullable(),
  kind: subjectKindSchema,
  color: z.string().nullable(),
});
export type SubjectDto = z.infer<typeof subjectSchema>;

export const listSubjectsResponseSchema = z.object({
  items: z.array(subjectSchema),
});
export type ListSubjectsResponseDto = z.infer<typeof listSubjectsResponseSchema>;

export const createSubjectRequestSchema = z.object({
  name: z.string().min(1).max(120),
  shortName: z.string().max(40).nullable().optional(),
  kind: subjectKindSchema,
  color: z.string().max(40).nullable().optional(),
});
export type CreateSubjectRequestDto = z.infer<typeof createSubjectRequestSchema>;

export const updateSubjectRequestSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    shortName: z.string().max(40).nullable().optional(),
    kind: subjectKindSchema.optional(),
    color: z.string().max(40).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateSubjectRequestDto = z.infer<typeof updateSubjectRequestSchema>;

export const roomSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  capacity: z.number().int().nullable(),
  note: z.string().nullable(),
});
export type RoomDto = z.infer<typeof roomSchema>;

export const listRoomsResponseSchema = z.object({
  items: z.array(roomSchema),
});
export type ListRoomsResponseDto = z.infer<typeof listRoomsResponseSchema>;

export const createRoomRequestSchema = z.object({
  name: z.string().min(1).max(60),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
export type CreateRoomRequestDto = z.infer<typeof createRoomRequestSchema>;

export const updateRoomRequestSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    capacity: z.number().int().min(1).max(1000).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateRoomRequestDto = z.infer<typeof updateRoomRequestSchema>;

export const gradeCategorySchema = z.object({
  id: uuidSchema,
  code: z.string(),
  title: z.string(),
  /** Вес в среднем балле: 1 — обычная оценка, больше — «весомее». */
  weight: z.number().int(),
  color: z.string().nullable(),
  isDefault: z.boolean(),
});
export type GradeCategoryDto = z.infer<typeof gradeCategorySchema>;

export const listGradeCategoriesResponseSchema = z.object({
  items: z.array(gradeCategorySchema),
});
export type ListGradeCategoriesResponseDto = z.infer<typeof listGradeCategoriesResponseSchema>;

export const createGradeCategoryRequestSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'Код: строчные латинские буквы, цифры и подчёркивание'),
  title: z.string().min(1).max(60),
  weight: z.number().int().min(1).max(10).default(1),
  color: z.string().max(40).nullable().optional(),
  isDefault: z.boolean().default(false),
});
export type CreateGradeCategoryRequestDto = z.infer<typeof createGradeCategoryRequestSchema>;

export const updateGradeCategoryRequestSchema = z
  .object({
    title: z.string().min(1).max(60).optional(),
    weight: z.number().int().min(1).max(10).optional(),
    color: z.string().max(40).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateGradeCategoryRequestDto = z.infer<typeof updateGradeCategoryRequestSchema>;

/** Категории оценок по умолчанию: нужны, пока администратор не завёл свои. */
export const DEFAULT_GRADE_CATEGORIES = [
  { code: 'current', title: 'Текущая', weight: 1, isDefault: true },
  { code: 'test', title: 'Контрольная работа', weight: 3, isDefault: false },
  { code: 'independent', title: 'Самостоятельная работа', weight: 2, isDefault: false },
  { code: 'oral', title: 'Устный ответ', weight: 1, isDefault: false },
] as const;

// --- Назначения «преподаватель ↔ предмет ↔ группа» (Этап 2) ---

export const teachingAssignmentSchema = z.object({
  id: uuidSchema,
  teacherUserId: uuidSchema,
  teacherName: z.string(),
  subjectId: uuidSchema,
  subjectName: z.string(),
  studyGroupId: uuidSchema,
  groupName: z.string(),
  startsOn: isoDateSchema,
  /** `null` — назначение действует, пока его не закрыли. */
  endsOn: isoDateSchema.nullable(),
  hoursPlanned: z.number().int().nullable(),
});
export type TeachingAssignmentDto = z.infer<typeof teachingAssignmentSchema>;

export const listAssignmentsQuerySchema = paginationQuerySchema.extend({
  teacherUserId: uuidSchema.optional(),
  studyGroupId: uuidSchema.optional(),
  subjectId: uuidSchema.optional(),
  /** Только действующие на дату (по умолчанию — все). */
  activeOn: isoDateSchema.optional(),
});
export type ListAssignmentsQueryDto = z.infer<typeof listAssignmentsQuerySchema>;

export const listAssignmentsResponseSchema = pageSchema(teachingAssignmentSchema);
export type ListAssignmentsResponseDto = z.infer<typeof listAssignmentsResponseSchema>;

export const createAssignmentRequestSchema = z
  .object({
    teacherUserId: uuidSchema,
    subjectId: uuidSchema,
    studyGroupId: uuidSchema,
    startsOn: isoDateSchema,
    endsOn: isoDateSchema.nullable().optional(),
    hoursPlanned: z.number().int().min(1).max(2000).nullable().optional(),
  })
  .refine((value) => isValidDateRange({ startsOn: value.startsOn, endsOn: value.endsOn ?? null }), {
    message: 'Дата начала позже даты окончания',
    path: ['endsOn'],
  });
export type CreateAssignmentRequestDto = z.infer<typeof createAssignmentRequestSchema>;

export const updateAssignmentRequestSchema = z
  .object({
    startsOn: isoDateSchema.optional(),
    endsOn: isoDateSchema.nullable().optional(),
    hoursPlanned: z.number().int().min(1).max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateAssignmentRequestDto = z.infer<typeof updateAssignmentRequestSchema>;

export const closeAssignmentRequestSchema = z.object({
  endsOn: isoDateSchema,
});
export type CloseAssignmentRequestDto = z.infer<typeof closeAssignmentRequestSchema>;

// --- Брендинг: правится в интерфейсе после мастера (Этап 2) ---

/**
 * Правка брендинга после мастера. Схема самого брендинга живёт в `setup.ts`
 * (мастер и настройки отдают один и тот же DTO), здесь — только запрос.
 */
export const updateBrandingRequestSchema = z
  .object({
    title: z.string().min(1).max(120).nullable().optional(),
    shortName: z.string().max(40).nullable().optional(),
    signature: z.string().max(200).nullable().optional(),
    /** Логотип — data URL: внешние ссылки запрещены (ADR-019). */
    logoDataUrl: logoDataUrlSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Нет полей для изменения' });
export type UpdateBrandingRequestDto = z.infer<typeof updateBrandingRequestSchema>;
