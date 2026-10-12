import { z } from 'zod';

import { isoDateSchema, paginationQuerySchema, pageSchema, uuidSchema } from './common';

/**
 * Журнал: оценки, знаки «+/·» и посещаемость (Этап 4).
 *
 * Единица журнала — урок: и оценка, и отметка посещаемости ссылаются на него
 * (ADR-006). Поэтому «экран урока» — это одна выборка: ученики группы, их отметки и
 * правило накопления знаков.
 */

/** Числовая оценка или знак. Ровно одно из двух полей заполнено. */
export const gradeValueSchema = z.enum(['2', '3', '4', '5']);
export const gradeSignSchema = z.enum(['plus', 'dot']);

export const GRADE_SIGN_LABELS = { plus: '+', dot: '.' } as const;

export const attendanceStatusSchema = z.enum(['present', 'absent', 'excused', 'sick', 'late']);
export type AttendanceStatusDto = z.infer<typeof attendanceStatusSchema>;

export const ATTENDANCE_LABELS: Record<AttendanceStatusDto, string> = {
  present: 'Был',
  absent: 'Прогул',
  excused: 'Уважительная',
  sick: 'Болел',
  late: 'Опоздал',
};

export const ATTENDANCE_SHORT: Record<AttendanceStatusDto, string> = {
  present: 'П',
  absent: 'О',
  excused: 'У',
  sick: 'Б',
  late: 'Н',
};

/** Отметка в журнале: то, что видно в списке учеников на уроке. */
export const gradeEntrySchema = z.object({
  id: uuidSchema,
  lessonId: uuidSchema,
  studentId: uuidSchema,
  /** Числовая оценка: у знака `null`. */
  value: gradeValueSchema.nullable(),
  /** Знак: у оценки `null`. */
  sign: gradeSignSchema.nullable(),
  categoryId: uuidSchema.nullable(),
  categoryTitle: z.string().nullable(),
  /** Вес категории: нужен аналитике, чтобы не запрашивать справочник заново. */
  categoryWeight: z.number().int().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
});
export type GradeEntryDto = z.infer<typeof gradeEntrySchema>;

export const attendanceEntrySchema = z.object({
  id: uuidSchema,
  lessonId: uuidSchema,
  studentId: uuidSchema,
  status: attendanceStatusSchema,
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type AttendanceEntryDto = z.infer<typeof attendanceEntrySchema>;

/** Ученик в журнале урока: карточка, отметки и накопление знаков по предмету. */
export const journalStudentSchema = z.object({
  studentId: uuidSchema,
  fullName: z.string(),
  /** Числовая оценка за этот урок: `null`, если не выставлена. */
  grade: gradeEntrySchema.nullable(),
  attendance: attendanceEntrySchema.nullable(),
  /** Накопление знаков по предмету за период: из него складывается правило. */
  signs: z.object({
    plus: z.number().int().nonnegative(),
    dot: z.number().int().nonnegative(),
    /** Сколько знаков осталось до следующего срабатывания. */
    plusRemaining: z.number().int().nonnegative(),
    dotRemaining: z.number().int().nonnegative(),
  }),
});
export type JournalStudentDto = z.infer<typeof journalStudentSchema>;

/** Экран урока: сам урок, состав группы и правило, по которому считаются знаки. */
export const lessonJournalSchema = z.object({
  lesson: z.object({
    id: uuidSchema,
    lessonDate: isoDateSchema,
    pairNumber: z.number().int(),
    timeStart: z.string(),
    timeEnd: z.string(),
    studyGroupId: uuidSchema,
    groupName: z.string(),
    subjectId: uuidSchema,
    subjectName: z.string(),
    teacherName: z.string(),
    topic: z.string().nullable(),
    status: z.string(),
  }),
  students: z.array(journalStudentSchema),
  rules: z.array(
    z.object({
      sign: gradeSignSchema,
      threshold: z.number().int().positive(),
      reward: gradeValueSchema,
      /** Срабатываний уже записано: видно, сколько оценок выдано правилом. */
      applied: z.number().int().nonnegative(),
    }),
  ),
});
export type LessonJournalDto = z.infer<typeof lessonJournalSchema>;

export const saveGradeRequestSchema = z
  .object({
    studentId: uuidSchema,
    /** Либо числовая оценка, либо знак. */
    value: gradeValueSchema.nullable().optional(),
    sign: gradeSignSchema.nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    comment: z.string().max(500).nullable().optional(),
  })
  .refine((input) => (input.value ?? null) !== null || (input.sign ?? null) !== null, {
    message: 'Нужна оценка или знак',
  })
  .refine((input) => !((input.value ?? null) !== null && (input.sign ?? null) !== null), {
    message: 'Одновременно оценка и знак не ставятся',
  });
export type SaveGradeRequestDto = z.infer<typeof saveGradeRequestSchema>;

export const updateGradeRequestSchema = z
  .object({
    value: gradeValueSchema.nullable().optional(),
    sign: gradeSignSchema.nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    comment: z.string().max(500).nullable().optional(),
    /** Причина правки: без неё история бесполезна (ADR-011). */
    reason: z.string().min(3).max(200),
  })
  .refine((input) => !((input.value ?? null) !== null && (input.sign ?? null) !== null), {
    message: 'Одновременно оценка и знак не ставятся',
  });
export type UpdateGradeRequestDto = z.infer<typeof updateGradeRequestSchema>;

export const deleteGradeRequestSchema = z.object({
  reason: z.string().min(3).max(200),
});

export const saveAttendanceRequestSchema = z.object({
  studentId: uuidSchema,
  status: attendanceStatusSchema,
  reason: z.string().max(200).nullable().optional(),
});
export type SaveAttendanceRequestDto = z.infer<typeof saveAttendanceRequestSchema>;

/** «Отметить всех присутствующими»: массовая операция по уроку. */
export const markAllPresentRequestSchema = z.object({
  /** Кого не отмечать: например, уже отмеченные отсутствующими. */
  exceptStudentIds: z.array(uuidSchema).max(200).optional(),
});

export const gradeRevisionSchema = z.object({
  id: uuidSchema,
  action: z.enum(['create', 'update', 'delete', 'restore']),
  before: z.string().nullable(),
  after: z.string().nullable(),
  reason: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});
export type GradeRevisionDto = z.infer<typeof gradeRevisionSchema>;

export const listGradeRevisionsResponseSchema = z.object({ items: z.array(gradeRevisionSchema) });

/** Аналитика: средний балл и посещаемость. */
export const journalStatsQuerySchema = paginationQuerySchema.extend({
  studyGroupId: uuidSchema.optional(),
  subjectId: uuidSchema.optional(),
  studentId: uuidSchema.optional(),
  periodId: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type JournalStatsQueryDto = z.infer<typeof journalStatsQuerySchema>;

export const journalStatsResponseSchema = z.object({
  items: z.array(
    z.object({
      studentId: uuidSchema,
      studentName: z.string(),
      /** Средний балл с весами категорий: `null`, если числовых оценок нет. */
      average: z.number().nullable(),
      gradesCount: z.number().int().nonnegative(),
      /** Процент «был» от всех отмеченных занятий. */
      attendancePercent: z.number(),
      attendance: z.object({
        total: z.number().int().nonnegative(),
        byStatus: z.record(
          attendanceStatusSchema,
          z.object({ count: z.number().int().nonnegative(), percent: z.number() }),
        ),
      }),
    }),
  ),
  total: z.number().int().nonnegative(),
});
export type JournalStatsResponseDto = z.infer<typeof journalStatsResponseSchema>;

export const journalStatsPageSchema = pageSchema(journalStatsResponseSchema.shape.items.element);
