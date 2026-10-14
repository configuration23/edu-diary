import { z } from 'zod';

import { isoDateSchema, paginationQuerySchema, pageSchema, uuidSchema } from './common';
import { signRuleSchema } from './academics';

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

/**
 * Посещаемость: П (присутствовал), Н (не был), Б (болел), О (опоздал).
 *
 * «Уважительная» — не отдельная буква, а признак `isExcused` к «Н»: в журнале
 * преподаватель нажимает «Н» и при необходимости ставит галочку с причиной.
 * Устаревшее значение `excused` осталось в схеме ради уже сохранённых отметок.
 */
export const attendanceStatusSchema = z.enum(['present', 'not_present', 'sick', 'late', 'excused']);
export type AttendanceStatusDto = z.infer<typeof attendanceStatusSchema>;

export const ATTENDANCE_LABELS: Record<AttendanceStatusDto, string> = {
  present: 'Присутствовал',
  not_present: 'Не был',
  sick: 'Болел',
  late: 'Опоздал',
  excused: 'Уважительная',
};

/** Буквы журнала: то, что видно в интерфейсе. */
export const ATTENDANCE_SHORT: Record<AttendanceStatusDto, string> = {
  present: 'П',
  not_present: 'Н',
  sick: 'Б',
  late: 'О',
  excused: 'У',
};

/** Что показывать в журнале: «Н» с галочкой уважительной становится «У». */
export function attendanceLetter(status: string, isExcused = false): string {
  if (status === 'not_present' && isExcused) return 'У';
  return ATTENDANCE_SHORT[status as AttendanceStatusDto] ?? '?';
}

/** Отметка в журнале: то, что видно в списке учеников на уроке. */
export const gradeEntrySchema = z.object({
  id: uuidSchema,
  lessonId: uuidSchema,
  studentId: uuidSchema,
  /** Числовая оценка: у знака `null`. */
  value: gradeValueSchema.nullable(),
  /** Знак: у оценки `null`. */
  sign: gradeSignSchema.nullable(),
  /** Причина оценки: обязательна при выставлении (см. справочник причин). */
  categoryId: uuidSchema.nullable(),
  categoryCode: z.string().nullable(),
  categoryTitle: z.string().nullable(),
  /** Вес причины: нужен аналитике, чтобы не запрашивать справочник заново. */
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
  /** Галочка «уважительная»: в журнале показывается буквой «У». */
  isExcused: z.boolean(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type AttendanceEntryDto = z.infer<typeof attendanceEntrySchema>;

/** Ученик в журнале урока: карточка, отметки и накопление знаков по предмету. */
export const journalStudentSchema = z.object({
  studentId: uuidSchema,
  fullName: z.string(),
  /**
   * Все отметки за урок. Их может быть несколько: за один урок ставят и оценку за
   * ответ, и оценку за контрольную, а знаков — сколько угодно.
   */
  grades: z.array(gradeEntrySchema),
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
  /**
   * Пороги накопительных знаков: из них интерфейс показывает, сколько знаков
   * осталось до оценки. Награда фиксирована: плюсы дают `5`, точки `2`.
   */
  signRules: z.array(signRuleSchema),
});
export type LessonJournalDto = z.infer<typeof lessonJournalSchema>;

/**
 * Пересчёт «плюсы и точки → оценка» за период.
 *
 * Запускается вручную из журнала: преподаватель должен понимать, откуда взялась
 * оценка. Границы периода задаёт учебный период, а `from`/`to` позволяют сузить
 * пересчёт до части периода, `subjectId` — до одного предмета: счётчики всё равно
 * ведутся по предметам, поэтому сужение осмысленно.
 */
export const applySignRulesRequestSchema = z
  .object({
    studyGroupId: uuidSchema,
    subjectId: uuidSchema.optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((input) => input.from === undefined || input.to === undefined || input.from <= input.to, {
    message: 'Начало периода позже конца',
    path: ['to'],
  });
export type ApplySignRulesRequestDto = z.infer<typeof applySignRulesRequestSchema>;

export const applySignRulesResponseSchema = z.object({
  /** Сколько оценок выдано этим запуском. */
  awarded: z.number().int().nonnegative(),
});
export type ApplySignRulesResponseDto = z.infer<typeof applySignRulesResponseSchema>;

export const saveGradeRequestSchema = z
  .object({
    studentId: uuidSchema,
    /** Либо числовая оценка, либо знак. */
    value: gradeValueSchema.nullable().optional(),
    sign: gradeSignSchema.nullable().optional(),
    /** Причина: обязательна — она объясняет оценку и задаёт вес в аналитике. */
    categoryId: uuidSchema,
    comment: z.string().max(500).nullable().optional(),
    /**
     * Заменить отметку с той же причиной.
     *
     * Без подтверждения сервер отвечает конфликтом: иначе случайное второе нажатие
     * создавало бы вторую оценку «за тот же ответ».
     */
    replace: z.boolean().optional(),
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
    categoryId: uuidSchema.optional(),
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

/**
 * Посещаемость: буква журнала и признак «уважительная».
 *
 * Причина передаётся только для уважительной: без неё отметка «У» не имеет смысла.
 * Для прогула без уважительной причины ничего заполнять не нужно.
 */
export const saveAttendanceRequestSchema = z
  .object({
    studentId: uuidSchema,
    status: attendanceStatusSchema,
    /** Галочка «уважительная»: в журнале показывается буквой «У». */
    isExcused: z.boolean().optional(),
    reason: z.string().max(200).nullable().optional(),
  })
  .refine((input) => input.isExcused !== true || (input.reason ?? '').trim().length >= 3, {
    message: 'Для уважительной причины нужен текст',
    path: ['reason'],
  });
export type SaveAttendanceRequestDto = z.infer<typeof saveAttendanceRequestSchema>;

/** «Отметить всех присутствующими»: массовая операция по уроку. */
export const markAllPresentRequestSchema = z.object({
  /** Кого не отмечать: например, уже отмеченные отсутствующими. */
  exceptStudentIds: z.array(uuidSchema).max(200).optional(),
});

export const markAllPresentResponseSchema = z.object({
  marked: z.number().int().nonnegative(),
});
export type MarkAllPresentResponseDto = z.infer<typeof markAllPresentResponseSchema>;

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

/**
 * Удалённая отметка: что убрали, кто и почему.
 *
 * Без такого списка восстановление недостижимо: удалённое исчезает из журнала, и
 * администратор не знает, что именно там было.
 */
export const deletedGradeSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  studentName: z.string(),
  /** Подпись отметки: «5», «+», «·». */
  mark: z.string(),
  categoryTitle: z.string().nullable(),
  deletedAt: z.string(),
  deletedReason: z.string().nullable(),
  deletedByName: z.string().nullable(),
});
export type DeletedGradeDto = z.infer<typeof deletedGradeSchema>;

export const deletedAttendanceSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  studentName: z.string(),
  status: attendanceStatusSchema,
  isExcused: z.boolean(),
  reason: z.string().nullable(),
  deletedAt: z.string(),
  deletedReason: z.string().nullable(),
  deletedByName: z.string().nullable(),
});
export type DeletedAttendanceDto = z.infer<typeof deletedAttendanceSchema>;

export const listDeletedResponseSchema = z.object({
  grades: z.array(deletedGradeSchema),
  attendance: z.array(deletedAttendanceSchema),
});
export type ListDeletedResponseDto = z.infer<typeof listDeletedResponseSchema>;

/** Удаление отметки посещаемости: причина обязательна (ADR-011). */
export const deleteAttendanceRequestSchema = z.object({
  reason: z.string().min(3).max(200),
});
export type DeleteAttendanceRequestDto = z.infer<typeof deleteAttendanceRequestSchema>;

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
      /** Средний балл с весами причин: `null`, если числовых оценок нет. */
      average: z.number().nullable(),
      /** Сколько числовых оценок учтено. Знаки «+» и «·» сюда не входят. */
      gradesCount: z.number().int().nonnegative(),
      /** Процент «присутствовал» от всех отмеченных занятий. */
      attendancePercent: z.number(),
      /**
       * Посещаемость для круговой диаграммы: по каждому статусу — количество и
       * процент. `present` и `excused` продублированы отдельно: без них интерфейсу
       * пришлось бы вытаскивать их из `byStatus` по строкам-ключам.
       */
      attendance: z.object({
        total: z.number().int().nonnegative(),
        present: z.number().int().nonnegative(),
        /** Сколько отсутствий отмечено уважительной причиной. */
        excused: z.number().int().nonnegative(),
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

/**
 * Отметки для списка занятий (расписание ученика и представителя).
 *
 * Дневной и недельный виды показывают отметки сразу по всем занятиям периода: запрашивать
 * журнал по одному уроку значило бы десяток запросов на экран. Отдаём только то, что
 * рисуется: оценки со знаком и причиной — для плитки, отметку посещаемости — буквой.
 */
export const lessonMarksQuerySchema = z.object({
  lessonIds: z.array(uuidSchema).min(1).max(100),
});
export type LessonMarksQueryDto = z.infer<typeof lessonMarksQuerySchema>;

export const lessonMarkSchema = z.object({
  lessonId: uuidSchema,
  studentId: uuidSchema,
  studentName: z.string(),
  /** Что стоит ученику за занятие: «5», «+» или «·». */
  value: z.string().nullable(),
  sign: gradeSignSchema.nullable(),
  categoryCode: z.string().nullable(),
  categoryTitle: z.string().nullable(),
  /** Вес причины: подстрочная цифра в журнале, если больше единицы. */
  categoryWeight: z.number().int(),
});

export const lessonAttendanceSchema = z.object({
  lessonId: uuidSchema,
  studentId: uuidSchema,
  status: attendanceStatusSchema,
  isExcused: z.boolean(),
  reason: z.string().nullable(),
});

export const lessonMarksResponseSchema = z.object({
  grades: z.array(lessonMarkSchema),
  attendance: z.array(lessonAttendanceSchema),
});
export type LessonMarksResponseDto = z.infer<typeof lessonMarksResponseSchema>;
