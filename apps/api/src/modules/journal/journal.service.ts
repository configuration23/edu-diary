import {
  ATTENDANCE_SHORT,
  attendanceBreakdown,
  countSigns,
  escalationState,
  isAttendanceStatus,
  absenceStats,
  isMarkSign,
  isMarkValue,
  weightedAverage,
  type AttendanceStatus,
  type EscalationRule,
  type MarkSign,
} from '@edu-diary/domain';
import type { SignRuleDto } from '@edu-diary/contracts';

import type { AuditActor } from '../../shared/actor';
import type { Database, Executor } from '../../shared/db/client';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { AuditService } from '../audit';
import type {
  AttendanceRecord,
  GradeRecord,
  JournalRepository,
  SignRecord,
} from './journal.repository';

/**
 * Справочник накопительных знаков: сколько плюсов или точек даёт оценку.
 *
 * Порт, а не прямой импорт: справочник ведёт учебный процесс, и журнал только
 * спрашивает у него пороги.
 */
export interface SignRuleLookupPort {
  listSignRules(): Promise<SignRuleDto[]>;
}

/**
 * Журнал: оценки, знаки и посещаемость (Этап 4).
 *
 * Правила, за которыми следит сервис:
 * - отметки ставятся только на существующий урок и в рамках своего назначения —
 *   иначе оценку можно «повесить» на чужой предмет (ADR-006);
 * - на отменённом уроке отметок нет;
 * - причина обязательна для прогула и уважительной, иначе журнал теряет смысл;
 * - правка и удаление оценки требуют причины и оставляют след в истории (ADR-011);
 * - правило «знаки → оценка» считается по предмету и периоду и не дублируется при
 *   повторном пересчёте (ADR-010).
 */

export interface MutationOptions {
  actor: AuditActor;
  executor?: Executor | undefined;
  /**
   * Доступны ли все уроки (право с областью `all`). Иначе изменение разрешено только
   * для своего урока: `assigned` — это «уроки этого преподавателя».
   */
  seesAll?: boolean | undefined;
  /** Сотрудник (преподаватель, администратор) или ученик с представителем. */
  staff?: boolean | undefined;
}

/** Урок, к которому применяется журнал: проверяется через порт расписания. */
export interface JournalLesson {
  id: string;
  lessonDate: string;
  pairNumber: number;
  timeStart: string;
  timeEnd: string;
  studyGroupId: string;
  groupName: string;
  subjectId: string;
  subjectName: string;
  teacherUserId: string;
  teacherName: string;
  topic: string | null;
  status: string;
}

export interface ScheduleLookupPort {
  findLesson(id: string): Promise<JournalLesson | null>;
  /** Группы, доступные смотрящему: ученику — где учится, родителю — его дети. */
  groupsOfViewer(userId: string): Promise<string[]>;
  /** Ученик по учётной записи: проверка «своих» данных. */
  studentIdOfUser(userId: string): Promise<string | null>;
  /** Ученики, доступные родителю. */
  studentIdsOfGuardian(userId: string): Promise<string[]>;
}

/**
 * Накопительный знак справочника: подпись живёт в общих контрактах, потому что тот
 * же справочник правит учебный процесс. Журнал читает его через порт — прямых
 * импортов между модулями нет.
 */

/** Знаки, которые дают оценку: награда фиксирована, меняется только порог. */
export const SIGN_REWARDS: Record<'plus' | 'dot', '5' | '2'> = { plus: '5', dot: '2' };

export interface JournalService {
  /**
   * Отметки по предметам: раздел «Оценки и посещение» для ученика и представителя.
   *
   * Диапазон — **текущий учебный период**, а не выбранные даты. Если периода нет,
   * отвечаем отказом `period_not_set`: экран показывает «Период не задан».
   */
  gradesBySubject(studentIds: string[]): Promise<{
    period: { id: string; title: string; startsOn: string; endsOn: string };
    subjects: {
      subjectId: string;
      subjectName: string;
      average: number | null;
      marks: {
        id: string;
        studentId: string;
        value: string | null;
        sign: string | null;
        categoryCode: string | null;
        categoryTitle: string | null;
        categoryWeight: number;
        lessonDate: string;
      }[];
    }[];
  }>;

  /** Посещение по предметам: та же форма, но с процентом пропусков. */
  attendanceBySubject(
    studentIds: string[],
    options: { countExcused: boolean; countSick: boolean },
  ): Promise<{
    period: { id: string; title: string; startsOn: string; endsOn: string };
    subjects: {
      subjectId: string;
      subjectName: string;
      total: number;
      absences: number;
      /** Доля пропусков при выбранных галочках. */
      percent: number;
      /** Доля пропусков без галочек: с ней сравнивают. */
      basePercent: number;
      marks: {
        id: string;
        studentId: string;
        status: string;
        isExcused: boolean;
        reason: string | null;
        lessonDate: string;
      }[];
    }[];
  }>;

  /**
   * Отметки по ученикам: вид преподавателя.
   *
   * Предмет задаёт преподаватель, и учитываются только **его** занятия: замену смотрит
   * основной преподаватель, поэтому уроки с заменой в расчёт не идут.
   */
  marksByStudent(
    filter: { studyGroupId: string; subjectId: string; teacherUserId: string },
    options: { countExcused: boolean; countSick: boolean },
  ): Promise<{
    period: { id: string; title: string; startsOn: string; endsOn: string };
    students: {
      studentId: string;
      studentName: string;
      average: number | null;
      marks: {
        id: string;
        value: string | null;
        sign: string | null;
        categoryCode: string | null;
        categoryTitle: string | null;
        categoryWeight: number;
        lessonDate: string;
      }[];
      attendance: {
        total: number;
        absences: number;
        percent: number;
        basePercent: number;
        marks: {
          id: string;
          status: string;
          isExcused: boolean;
          reason: string | null;
          lessonDate: string;
        }[];
      };
    }[];
  }>;
  /**
   * Отметки по списку занятий: расписанию нужны оценки и посещаемость за период.
   *
   * Возвращаем только то, что рисуется в плитке: значение отметки со знаком и причиной
   * и отметку посещаемости. Состав проверяем по видимости: ученик и представитель
   * получают отметки только своих, поэтому список учеников приходит снаружи.
   */
  lessonMarks(
    lessonIds: string[],
    visibleStudentIds: string[] | null,
  ): Promise<{
    grades: {
      lessonId: string;
      studentId: string;
      studentName: string;
      value: string | null;
      sign: string | null;
      categoryCode: string | null;
      categoryTitle: string | null;
      categoryWeight: number;
    }[];
    attendance: {
      lessonId: string;
      studentId: string;
      status: string;
      isExcused: boolean;
      reason: string | null;
    }[];
  }>;
  /** Экран урока: состав группы, отметки и накопление знаков. */
  lessonJournal(
    lessonId: string,
    viewer: { userId: string; seesAll: boolean; staff: boolean },
  ): Promise<{
    lesson: JournalLesson;
    students: {
      studentId: string;
      fullName: string;
      /** Все отметки за урок: их может быть несколько, каждая со своей причиной. */
      grades: GradeRecord[];
      attendance: AttendanceRecord | null;
      signs: { plus: number; dot: number; plusRemaining: number; dotRemaining: number };
    }[];
    /** Пороги накопления: из них интерфейс считает «до оценки осталось N знаков». */
    signRules: SignRuleDto[];
  }>;
  saveGrade(
    lessonId: string,
    input: {
      studentId: string;
      value?: string | null;
      sign?: string | null;
      /** Причина обязательна: она объясняет оценку и задаёт вес. */
      categoryId: string;
      comment?: string | null;
      /** Заменить отметку с той же причиной (подтверждение из интерфейса). */
      replace?: boolean | undefined;
    },
    options: MutationOptions,
  ): Promise<GradeRecord>;
  updateGrade(
    gradeId: string,
    input: {
      value?: string | null;
      sign?: string | null;
      categoryId?: string | null;
      comment?: string | null;
      reason: string;
    },
    options: MutationOptions,
  ): Promise<GradeRecord>;
  deleteGrade(gradeId: string, reason: string, options: MutationOptions): Promise<void>;
  restoreGrade(gradeId: string, options: MutationOptions): Promise<void>;
  /** Удаление отметки посещаемости: мягкое, с обязательной причиной (ADR-011). */
  deleteAttendance(attendanceId: string, reason: string, options: MutationOptions): Promise<void>;
  restoreAttendance(attendanceId: string, options: MutationOptions): Promise<void>;
  /** История правок отметки посещаемости: кто, когда, было и стало. */
  listAttendanceRevisions(attendanceId: string): Promise<
    {
      action: string;
      before: string | null;
      after: string | null;
      reason: string | null;
      actorName: string | null;
      createdAt: Date;
    }[]
  >;
  /**
   * Удалённые отметки урока.
   *
   * Без этой выборки восстановление недостижимо: удалённое исчезает из журнала, и
   * администратор не знает, что именно там было.
   */
  deletedForLesson(lessonId: string): Promise<{
    grades: {
      id: string;
      studentId: string;
      studentName: string;
      mark: string;
      categoryTitle: string | null;
      deletedAt: Date;
      deletedReason: string | null;
      deletedByName: string | null;
    }[];
    attendance: {
      id: string;
      studentId: string;
      studentName: string;
      status: string;
      isExcused: boolean;
      reason: string | null;
      deletedAt: Date;
      deletedReason: string | null;
      deletedByName: string | null;
    }[];
  }>;
  listGradeRevisions(gradeId: string): Promise<
    {
      action: string;
      before: string | null;
      after: string | null;
      reason: string | null;
      actorName: string | null;
      createdAt: Date;
    }[]
  >;
  saveAttendance(
    lessonId: string,
    input: {
      studentId: string;
      status: string;
      /** Галочка «уважительная»: требует текста причины. */
      isExcused?: boolean | undefined;
      reason?: string | null;
    },
    options: MutationOptions,
  ): Promise<AttendanceRecord>;
  markAllPresent(
    lessonId: string,
    input: { exceptStudentIds?: string[] },
    options: MutationOptions,
  ): Promise<{ marked: number }>;
  /**
   * Пересчёт «плюсы и точки → оценка» за период.
   *
   * Запускается вручную: преподаватель должен понимать, откуда взялась оценка.
   * Съедает ровно по `threshold` знаков на оценку, ставит её датой последнего
   * знака и возвращает, сколько оценок выдано этим запуском.
   */
  applyRules(
    filter: { studyGroupId: string; subjectId?: string; from?: string; to?: string },
    options: MutationOptions,
  ): Promise<{ awarded: number }>;
  stats(filter: {
    studentIds: string[];
    subjectId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  }): Promise<
    {
      studentId: string;
      average: number | null;
      gradesCount: number;
      attendancePercent: number;
      attendance: ReturnType<typeof attendanceBreakdown>;
    }[]
  >;
}

export interface JournalServiceDependencies {
  db: Database;
  journal: JournalRepository;
  audit: AuditService;
  schedule: ScheduleLookupPort;
  /** Пороги накопления знаков: справочник ведёт учебный процесс. */
  signRules: SignRuleLookupPort;
}

/** Подпись отметки для истории правок: «5», «+», «.» или «—». */
function describeMark(value: string | null, sign: string | null): string {
  if (value !== null) return value;
  if (sign === 'plus') return '+';
  if (sign === 'dot') return '.';
  return '—';
}

/** Подпись знака для аудита: «+» или «·». */
function signLabel(sign: 'plus' | 'dot'): string {
  return sign === 'plus' ? '+' : '·';
}

/** Подпись отметки посещаемости для истории правок: «Н», «У», «Б», «О», «П». */
function statusLabel(status: string, isExcused: boolean): string {
  if (status === 'not_present' && isExcused) return 'У';
  return ATTENDANCE_SHORT[status as AttendanceStatus] ?? status;
}

export function createJournalService(dependencies: JournalServiceDependencies): JournalService {
  const { db, journal, audit, schedule, signRules } = dependencies;

  /** Урок с проверкой области действия: чужая группа отвечает `404`. */
  /**
   * Доступ к уроку.
   *
   * `seesAll` — право с областью `all` (администратор): он видит и правит любой урок.
   *
   * Остальным урок доступен только «свой»:
   * - **преподавателю** — тот, который он ведёт (`lesson.teacherUserId`). Замена
   *   переносит это поле на замещающего, поэтому заместитель получает доступ, а
   *   заболевший — теряет: журнал ведёт тот, кто фактически провёл занятие. Область
   *   `assigned` означает именно «уроки этого преподавателя», а не «все уроки»;
   * - **ученику и родителю** — урок группы, в которой ученик числится.
   *
   * Отвечаем `404`, а не `403`: чужой урок не должен подтверждать своё существование.
   */
  const requireLessonAccess = async (
    lesson: JournalLesson,
    viewer: { userId: string | null; seesAll: boolean; staff: boolean },
  ): Promise<void> => {
    if (viewer.seesAll) return;

    /**
     * Преподаватель: доступен только свой урок.
     *
     * Проверять преподавателя по составу группы нельзя — в этом и была дыра: двое
     * преподавателей ведут разные предметы в одной группе, и по группе каждый из них
     * получал доступ к журналу другого.
     */
    if (viewer.staff) {
      if (viewer.userId !== null && lesson.teacherUserId === viewer.userId) return;
      throw new AppError('NOT_FOUND', 'Урок не найден');
    }

    // Ученик и родитель: доступ по группе, в которой числится ученик.
    if (viewer.userId !== null) {
      const ownGroups = await schedule.groupsOfViewer(viewer.userId);
      if (ownGroups.includes(lesson.studyGroupId)) return;
    }

    throw new AppError('NOT_FOUND', 'Урок не найден');
  };

  const requireLessonForViewer = async (
    lessonId: string,
    viewer: { userId: string; seesAll: boolean; staff: boolean },
  ) => {
    const lesson = await schedule.findLesson(lessonId);
    if (lesson === null) throw new AppError('NOT_FOUND', 'Урок не найден');

    await requireLessonAccess(lesson, viewer);

    return lesson;
  };

  /**
   * Урок для изменения: доступ проверяется теми же правилами, что и просмотр.
   * Отдельная обёртка нужна, чтобы правило нельзя было забыть в одном из способов
   * записи — раньше так и вышло: проверка была только на просмотре.
   */
  const requireLessonForWrite = async (
    lessonId: string,
    options: { userId: string | null; seesAll: boolean; staff: boolean },
  ): Promise<JournalLesson> => {
    const lesson = await requireLesson(lessonId);
    await requireLessonAccess(lesson, {
      userId: options.userId,
      seesAll: options.seesAll,
      staff: options.staff,
    });
    return lesson;
  };

  /**
   * Состав группы для журнала урока.
   *
   * Считается по датам зачисления, но пустой результат — не повод показывать пустой
   * журнал: у группы может быть проставлена дата зачисления позже начала занятий (или
   * её не проставили вовсе), и тогда на дату урока не числился никто. Преподаватель
   * видел «в группе на эту дату учеников нет» и не мог вести занятие. В таком случае
   * берём текущий состав группы: он ближе к правде, чем пустой список.
   */
  const rosterForLesson = async (
    lesson: JournalLesson,
  ): Promise<{ studentId: string; fullName: string }[]> => {
    const onDate = await journal.listStudentsForGroup(lesson.studyGroupId, lesson.lessonDate);
    if (onDate.length > 0) return onDate;
    return journal.listCurrentGroupStudents(lesson.studyGroupId);
  };
  /**
   * Текущий учебный период.
   *
   * Раздел «Оценки и посещение» работает **только за текущий период**: выбор дат убран по
   * решению владельца. Если периода нет, отвечаем отказом с понятным кодом — экран
   * показывает «Период не задан», а не пустой отчёт.
   */
  const requireCurrentPeriod = async (): Promise<{
    id: string;
    title: string;
    startsOn: string;
    endsOn: string;
  }> => {
    const today = new Date().toISOString().slice(0, 10);
    const period = await journal.findPeriodForDate(today);

    if (period === null) {
      throw new AppError('VALIDATION_FAILED', 'Период не задан', {
        details: { reason: 'period_not_set' },
      });
    }

    return period;
  };
  const requireLesson = async (lessonId: string): Promise<JournalLesson> => {
    const lesson = await schedule.findLesson(lessonId);
    if (lesson === null) throw new AppError('NOT_FOUND', 'Урок не найден');
    return lesson;
  };

  /** Отметки на отменённом уроке не ставим: занятие не состоялось. */
  const assertLessonActive = (lesson: JournalLesson): void => {
    if (lesson.status === 'cancelled') {
      throw new AppError('CONFLICT', 'Урок отменён: ставить отметки нельзя', {
        details: { reason: 'lesson_cancelled' },
      });
    }
  };

  const assertSignOrValue = (value: string | null, sign: string | null): void => {
    if (value !== null && sign !== null) {
      throw new AppError('VALIDATION_FAILED', 'Одновременно оценка и знак не ставятся');
    }
    if (value === null && sign === null) {
      throw new AppError('VALIDATION_FAILED', 'Нужна оценка или знак');
    }
    if (value !== null && !isMarkValue(value)) {
      throw new AppError('VALIDATION_FAILED', 'Оценка должна быть числом от 2 до 5');
    }
    if (sign !== null && !isMarkSign(sign)) {
      throw new AppError('VALIDATION_FAILED', 'Знак может быть «плюсом» или «точкой»');
    }
  };

  /**
   * Причина нужна только для «уважительной»: отсутствие без уважительной причины
   * отмечается буквой «Н» и ничего не требует.
   */
  const assertReason = (isExcused: boolean, reason: string | null): void => {
    if (isExcused && (reason === null || reason.trim().length < 3)) {
      throw new AppError('VALIDATION_FAILED', 'Для уважительной причины нужен текст', {
        details: { reason: 'reason_required' },
      });
    }
  };

  const ruleOf = (rule: SignRuleDto): EscalationRule => ({
    sign: rule.sign,
    threshold: rule.threshold,
    reward: SIGN_REWARDS[rule.sign],
  });

  return {
    async gradesBySubject(studentIds) {
      const period = await requireCurrentPeriod();

      const details = await journal.listGradeDetails({
        studentIds,
        from: period.startsOn,
        to: period.endsOn,
      });

      /** Группируем по предмету: экран показывает список предметов ученика. */
      const bySubject = new Map<string, typeof details>();
      for (const detail of details) {
        const list = bySubject.get(detail.subjectId) ?? [];
        list.push(detail);
        bySubject.set(detail.subjectId, list);
      }

      return {
        period,
        subjects: [...bySubject.entries()]
          .map(([subjectId, marks]) => ({
            subjectId,
            subjectName: marks[0]?.subjectName ?? 'Предмет',
            /**
             * Средний балл считает домен: знаки «+» и «·» в него не входят, вес берётся из
             * причины. В списке отметок знаки остаются — по ним видно, сколько до оценки.
             */
            average: weightedAverage(
              marks.map((mark) => ({
                value: mark.value ?? '',
                weight: mark.categoryWeight ?? 1,
              })),
            ),
            marks: marks
              .map((mark) => ({
                id: mark.id,
                studentId: mark.studentId,
                value: mark.value,
                sign: mark.sign,
                categoryCode: mark.categoryCode,
                categoryTitle: mark.categoryTitle,
                categoryWeight: mark.categoryWeight ?? 1,
                lessonDate: mark.lessonDate,
              }))
              // Свежие отметки первыми: так их и ждут на экране.
              .sort((left, right) => right.lessonDate.localeCompare(left.lessonDate)),
          }))
          .sort((left, right) => left.subjectName.localeCompare(right.subjectName)),
      };
    },

    async attendanceBySubject(studentIds, options) {
      const period = await requireCurrentPeriod();

      const details = await journal.listAttendanceDetails({
        studentIds,
        from: period.startsOn,
        to: period.endsOn,
      });

      const bySubject = new Map<string, typeof details>();
      for (const detail of details) {
        const list = bySubject.get(detail.subjectId) ?? [];
        list.push(detail);
        bySubject.set(detail.subjectId, list);
      }

      return {
        period,
        subjects: [...bySubject.entries()]
          .map(([subjectId, marks]) => {
            const marksForCalc = marks.map((mark) => ({
              status: mark.status as AttendanceStatus,
              isExcused: mark.isExcused,
            }));
            const stats = absenceStats(marksForCalc, options);
            /** Процент без галочек: с ним сравнивают, чтобы был виден эффект галочек. */
            const base = absenceStats(marksForCalc, { countExcused: false, countSick: false });

            return {
              subjectId,
              subjectName: marks[0]?.subjectName ?? 'Предмет',
              total: stats.total,
              absences: stats.absences,
              percent: stats.percent,
              basePercent: base.percent,
              marks: marks
                .map((mark) => ({
                  id: mark.id,
                  studentId: mark.studentId,
                  status: mark.status,
                  isExcused: mark.isExcused,
                  reason: mark.reason,
                  lessonDate: mark.lessonDate,
                }))
                .sort((left, right) => right.lessonDate.localeCompare(left.lessonDate)),
            };
          })
          .sort((left, right) => left.subjectName.localeCompare(right.subjectName)),
      };
    },

    async marksByStudent(filter, options) {
      const period = await requireCurrentPeriod();

      const students = await journal.listStudentsForGroup(filter.studyGroupId, period.endsOn);

      const [grades, attendance] = await Promise.all([
        journal.listGradeDetails({
          studentIds: students.map((student) => student.studentId),
          subjectId: filter.subjectId,
          /**
           * Только занятия этого преподавателя: замену смотрит основной преподаватель,
           * плановая смена оформляется назначением.
           */
          teacherUserId: filter.teacherUserId,
          from: period.startsOn,
          to: period.endsOn,
        }),
        journal.listAttendanceDetails({
          studentIds: students.map((student) => student.studentId),
          subjectId: filter.subjectId,
          teacherUserId: filter.teacherUserId,
          from: period.startsOn,
          to: period.endsOn,
        }),
      ]);

      return {
        period,
        students: students.map((student) => {
          const own = grades.filter((grade) => grade.studentId === student.studentId);
          const marks = attendance.filter((mark) => mark.studentId === student.studentId);
          const marksForCalc = marks.map((mark) => ({
            status: mark.status as AttendanceStatus,
            isExcused: mark.isExcused,
          }));
          const stats = absenceStats(marksForCalc, options);
          const base = absenceStats(marksForCalc, { countExcused: false, countSick: false });

          return {
            studentId: student.studentId,
            studentName: student.fullName,
            average: weightedAverage(
              own.map((grade) => ({
                value: grade.value ?? '',
                weight: grade.categoryWeight ?? 1,
              })),
            ),
            marks: own
              .map((grade) => ({
                id: grade.id,
                value: grade.value,
                sign: grade.sign,
                categoryCode: grade.categoryCode,
                categoryTitle: grade.categoryTitle,
                categoryWeight: grade.categoryWeight ?? 1,
                lessonDate: grade.lessonDate,
              }))
              .sort((left, right) => right.lessonDate.localeCompare(left.lessonDate)),
            attendance: {
              total: stats.total,
              absences: stats.absences,
              percent: stats.percent,
              basePercent: base.percent,
              marks: marks
                .map((mark) => ({
                  id: mark.id,
                  status: mark.status,
                  isExcused: mark.isExcused,
                  reason: mark.reason,
                  lessonDate: mark.lessonDate,
                }))
                .sort((left, right) => right.lessonDate.localeCompare(left.lessonDate)),
            },
          };
        }),
      };
    },
    async lessonMarks(lessonIds, visibleStudentIds) {
      if (lessonIds.length === 0) {
        return { grades: [], attendance: [] };
      }

      // Пустой список видимости — ответ пустой: связей «ученик ↔ пользователь» нет.
      if (visibleStudentIds !== null && visibleStudentIds.length === 0) {
        return { grades: [], attendance: [] };
      }

      const [grades, attendance] = await Promise.all([
        journal.listGradesForLessons(lessonIds),
        journal.listAttendanceForLessons(lessonIds),
      ]);

      /**
       * Связь «отметка ↔ ученик» нужна для подписи: в плитке видно имя, когда смотрит
       * преподаватель, а ученику оно и так своё.
       */
      const names = new Map<string, string>();
      for (const grade of grades) {
        if (names.has(grade.studentId)) continue;
        names.set(grade.studentId, (await journal.findStudentName(grade.studentId)) ?? 'Ученик');
      }

      /**
       * Отбор по видимости.
       *
       * `null` — смотрящий видит всех (сотрудник). **Пустой список** — не «видит всех», а
       * «не видит никого»: у ученика и представителя строки идут по связям, и пустой
       * список означает, что связей нет. Раньше разницы не было, и сотрудник с пустым
       * списком получил бы отметки всех учеников — то есть больше, чем ему нужно.
       */
      const visible = (studentId: string): boolean =>
        visibleStudentIds === null || visibleStudentIds.includes(studentId);

      return {
        grades: grades
          .filter((grade) => visible(grade.studentId))
          .map((grade) => ({
            lessonId: grade.lessonId,
            studentId: grade.studentId,
            studentName: names.get(grade.studentId) ?? 'Ученик',
            value: grade.value,
            sign: grade.sign,
            categoryCode: grade.categoryCode,
            categoryTitle: grade.categoryTitle,
            categoryWeight: grade.categoryWeight ?? 1,
          })),
        attendance: attendance
          .filter((mark) => visible(mark.studentId))
          .map((mark) => ({
            lessonId: mark.lessonId,
            studentId: mark.studentId,
            status: mark.status,
            isExcused: mark.isExcused,
            reason: mark.reason,
          })),
      };
    },
    async lessonJournal(lessonId, viewer) {
      const lesson = await requireLessonForViewer(lessonId, viewer);

      const [students, grades, attendance] = await Promise.all([
        rosterForLesson(lesson),
        journal.listGradesForLesson(lessonId),
        journal.listAttendanceForLesson(lessonId),
      ]);
      const rules = await signRules.listSignRules();
      const bySign = new Map(rules.map((rule) => [rule.sign, rule]));

      const period = await journal.findPeriodForDate(lesson.lessonDate);
      const attendanceByStudent = new Map(attendance.map((mark) => [mark.studentId, mark]));

      /**
       * Накопление считаем по **ещё не съеденным** знакам за учебный период
       * (ADR-009): съеденные уже оплатили оценки, и повторно они не считаются.
       */
      const result = [];
      for (const student of students) {
        const signs = await journal.listSignsForStudentSubject({
          studentId: student.studentId,
          subjectId: lesson.subjectId,
          ...(period === null ? {} : { from: period.startsOn, to: period.endsOn }),
        });
        const pending = signs.filter((sign) => sign.consumedByGradeId === null);
        const counts = countSigns(pending as { sign: MarkSign | null }[]);

        const plusRule = bySign.get('plus');
        const dotRule = bySign.get('dot');

        result.push({
          studentId: student.studentId,
          fullName: student.fullName,
          /**
           * Отметки за урок списком: их может быть несколько — например, оценка за
           * ответ и оценка за контрольную, каждая со своей причиной.
           */
          grades: grades.filter((grade) => grade.studentId === student.studentId),
          attendance: attendanceByStudent.get(student.studentId) ?? null,
          signs: {
            plus: counts.plus,
            dot: counts.dot,
            plusRemaining:
              plusRule === undefined ? 0 : escalationState(counts, ruleOf(plusRule)).remaining,
            dotRemaining:
              dotRule === undefined ? 0 : escalationState(counts, ruleOf(dotRule)).remaining,
          },
        });
      }

      return { lesson, students: result, signRules: rules };
    },

    async saveGrade(lessonId, input, options) {
      const lesson = await requireLessonForWrite(lessonId, {
        userId: options.actor.userId,
        seesAll: options.seesAll ?? false,
        staff: options.staff ?? true,
      });
      assertLessonActive(lesson);

      const value = input.value ?? null;
      const sign = input.sign ?? null;
      assertSignOrValue(value, sign);

      /**
       * Причина обязательна: она объясняет оценку и задаёт вес в аналитике. Без неё
       * «5» неизвестно за что, и средний балл считается наугад.
       */
      const category = await journal.findGradeCategory(input.categoryId);
      if (category === null) {
        throw new AppError('VALIDATION_FAILED', 'Причина оценки не найдена', {
          details: { reason: 'category_not_found' },
        });
      }

      return withTransaction(db, options.executor, async (tx) => {
        /**
         * Отметок за урок может быть несколько, поэтому «занять слот» нельзя.
         * Но повторную отметку **с той же причиной** считаем случайным дублем:
         * без подтверждения отвечаем конфликтом, чтобы второе нажатие не создавало
         * вторую оценку «за тот же ответ».
         */
        const sameReason = (await journal.listGradesForLesson(lessonId, tx)).find(
          (grade) => grade.studentId === input.studentId && grade.categoryId === input.categoryId,
        );

        if (sameReason !== undefined && input.replace !== true) {
          throw new AppError('CONFLICT', 'Такая отметка за урок уже есть', {
            details: {
              reason: 'duplicate_grade',
              gradeId: sameReason.id,
              categoryTitle: sameReason.categoryTitle,
            },
          });
        }

        if (sameReason !== undefined) {
          await journal.softDeleteGrade(
            sameReason.id,
            { reason: 'Заменено новой отметкой с той же причиной', actorId: options.actor.userId },
            tx,
          );
          await journal.recordGradeRevision(
            {
              gradeEntryId: sameReason.id,
              action: 'delete',
              before: describeMark(sameReason.value, sameReason.sign),
              after: null,
              reason: 'Заменено новой отметкой',
              actorId: options.actor.userId,
            },
            tx,
          );
        }

        const created = await journal.insertGrade(
          {
            lessonId,
            studentId: input.studentId,
            value,
            sign,
            categoryId: input.categoryId,
            comment: input.comment ?? null,
            createdBy: options.actor.userId,
          },
          tx,
        );

        await journal.recordGradeRevision(
          {
            gradeEntryId: created.id,
            action: 'create',
            before: null,
            after: describeMark(value, sign),
            reason: null,
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'grade_entry',
            entityId: created.id,
            after: {
              lessonId,
              studentId: input.studentId,
              mark: describeMark(value, sign),
            },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async updateGrade(gradeId, input, options) {
      const current = await journal.findGrade(gradeId);
      if (current === null) throw new AppError('NOT_FOUND', 'Оценка не найдена');

      /**
       * Доступ проверяем по уроку, к которому относится отметка: правка чужой
       * отметки — тот же чужой журнал.
       */
      await requireLessonAccess(await requireLesson(current.lessonId), {
        userId: options.actor.userId,
        seesAll: options.seesAll ?? false,
        staff: options.staff ?? true,
      });

      const value = input.value === undefined ? current.value : input.value;
      const sign = input.sign === undefined ? current.sign : input.sign;
      assertSignOrValue(value, sign);

      return withTransaction(db, options.executor, async (tx) => {
        const updated = await journal.updateGrade(
          gradeId,
          {
            ...(input.value === undefined ? {} : { value: input.value }),
            ...(input.sign === undefined ? {} : { sign: input.sign }),
            ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
            ...(input.comment === undefined ? {} : { comment: input.comment }),
          },
          tx,
        );

        if (updated === null) throw new AppError('NOT_FOUND', 'Оценка не найдена');

        await journal.recordGradeRevision(
          {
            gradeEntryId: gradeId,
            action: 'update',
            before: describeMark(current.value, current.sign),
            after: describeMark(updated.value, updated.sign),
            reason: input.reason,
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'update',
            entityKind: 'grade_entry',
            entityId: gradeId,
            before: { mark: describeMark(current.value, current.sign) },
            after: { mark: describeMark(updated.value, updated.sign), reason: input.reason },
          },
          options.actor,
          tx,
        );

        return updated;
      });
    },

    async deleteGrade(gradeId, reason, options) {
      const current = await journal.findGrade(gradeId);
      if (current === null) throw new AppError('NOT_FOUND', 'Оценка не найдена');

      /**
       * Доступ проверяем по уроку, к которому относится отметка: правка чужой
       * отметки — тот же чужой журнал.
       */
      await requireLessonAccess(await requireLesson(current.lessonId), {
        userId: options.actor.userId,
        seesAll: options.seesAll ?? false,
        staff: options.staff ?? true,
      });

      await withTransaction(db, options.executor, async (tx) => {
        const removed = await journal.softDeleteGrade(
          gradeId,
          { reason, actorId: options.actor.userId },
          tx,
        );

        if (!removed) throw new AppError('NOT_FOUND', 'Оценка не найдена');

        await journal.recordGradeRevision(
          {
            gradeEntryId: gradeId,
            action: 'delete',
            before: describeMark(current.value, current.sign),
            after: null,
            reason,
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'delete',
            entityKind: 'grade_entry',
            entityId: gradeId,
            before: { mark: describeMark(current.value, current.sign), reason },
          },
          options.actor,
          tx,
        );
      });
    },

    async restoreGrade(gradeId, options) {
      const current = await journal.findGrade(gradeId);
      if (current === null) throw new AppError('NOT_FOUND', 'Оценка не найдена');

      /**
       * Доступ проверяем по уроку, к которому относится отметка: правка чужой
       * отметки — тот же чужой журнал.
       */
      await requireLessonAccess(await requireLesson(current.lessonId), {
        userId: options.actor.userId,
        seesAll: options.seesAll ?? false,
        staff: options.staff ?? true,
      });

      /**
       * Съеденный знак восстанавливать нельзя.
       *
       * Пересчёт «плюсы и точки → оценка» уже превратил этот знак в оценку. Вернув
       * знак, мы получили бы и оценку, и знак — то есть двойной учёт. Если знак нужно
       * вернуть, оценку сначала удаляют, а потом пересчитывают заново.
       */
      if (current.consumedByGradeId !== null) {
        throw new AppError(
          'CONFLICT',
          'Знак уже превращён в оценку пересчётом: сначала удалите оценку',
          { details: { reason: 'sign_consumed' } },
        );
      }

      await withTransaction(db, options.executor, async (tx) => {
        await journal.restoreGrade(gradeId, tx);
        await journal.recordGradeRevision(
          {
            gradeEntryId: gradeId,
            action: 'restore',
            before: null,
            after: describeMark(current.value, current.sign),
            reason: 'Восстановлено администратором',
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'restore',
            entityKind: 'grade_entry',
            entityId: gradeId,
            after: { mark: describeMark(current.value, current.sign) },
          },
          options.actor,
          tx,
        );
      });
    },

    async listGradeRevisions(gradeId) {
      const rows = await journal.listGradeRevisions(gradeId);
      return rows.map((row) => ({
        action: row.revision.action,
        before: row.revision.before,
        after: row.revision.after,
        reason: row.revision.reason,
        actorName: row.actorName,
        createdAt: row.revision.createdAt,
      }));
    },

    async deleteAttendance(attendanceId, reason, options) {
      const current = await journal.findAttendance(attendanceId);
      if (current === null) throw new AppError('NOT_FOUND', 'Отметка посещаемости не найдена');

      /**
       * Доступ проверяем по уроку, к которому относится отметка: правка чужой
       * отметки — тот же чужой журнал.
       */
      await requireLessonAccess(await requireLesson(current.lessonId), {
        userId: options.actor.userId,
        seesAll: options.seesAll ?? false,
        staff: options.staff ?? true,
      });

      await withTransaction(db, options.executor, async (tx) => {
        const removed = await journal.softDeleteAttendance(
          attendanceId,
          { reason, actorId: options.actor.userId },
          tx,
        );
        if (!removed) throw new AppError('NOT_FOUND', 'Отметка посещаемости не найдена');

        await journal.recordAttendanceRevision(
          {
            attendanceEntryId: attendanceId,
            action: 'delete',
            before: statusLabel(current.status, current.isExcused),
            after: null,
            reason,
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'delete',
            entityKind: 'attendance_entry',
            entityId: attendanceId,
            before: { status: current.status, isExcused: current.isExcused },
            after: { reason },
          },
          options.actor,
          tx,
        );
      });
    },

    async restoreAttendance(attendanceId, options) {
      const current = await journal.findAttendance(attendanceId);
      if (current === null) throw new AppError('NOT_FOUND', 'Отметка посещаемости не найдена');

      /**
       * Доступ проверяем по уроку, к которому относится отметка: правка чужой
       * отметки — тот же чужой журнал.
       */
      await requireLessonAccess(await requireLesson(current.lessonId), {
        userId: options.actor.userId,
        seesAll: options.seesAll ?? false,
        staff: options.staff ?? true,
      });

      /**
       * У ученика на уроке может быть только одна отметка посещаемости. Если за время
       * после удаления ему поставили новую, восстанавливать старую нельзя: получилось
       * бы две. Администратор сначала удаляет новую — и решает, какая верна.
       */
      const active = await journal.listAttendanceForLessonIncludingDeleted(current.lessonId);
      const conflict = active.find(
        (mark) => mark.studentId === current.studentId && mark.deletedAt === null,
      );
      if (conflict !== undefined && conflict.id !== attendanceId) {
        throw new AppError('CONFLICT', 'У ученика уже есть отметка на этом уроке', {
          details: { reason: 'attendance_exists' },
        });
      }

      await withTransaction(db, options.executor, async (tx) => {
        await journal.restoreAttendance(attendanceId, tx);
        await journal.recordAttendanceRevision(
          {
            attendanceEntryId: attendanceId,
            action: 'restore',
            before: null,
            after: statusLabel(current.status, current.isExcused),
            reason: 'Восстановлено администратором',
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'restore',
            entityKind: 'attendance_entry',
            entityId: attendanceId,
            after: { status: current.status, isExcused: current.isExcused },
          },
          options.actor,
          tx,
        );
      });
    },

    async listAttendanceRevisions(attendanceId) {
      const rows = await journal.listAttendanceRevisions(attendanceId);
      return rows.map((row) => ({
        action: row.revision.action,
        before: row.revision.before,
        after: row.revision.after,
        reason: row.revision.reason,
        actorName: row.actorName,
        createdAt: row.revision.createdAt,
      }));
    },

    async deletedForLesson(lessonId) {
      await requireLesson(lessonId);
      const removed = await journal.listDeletedForLesson(lessonId);

      return {
        grades: removed.grades.map((grade) => ({
          id: grade.id,
          studentId: grade.studentId,
          studentName: grade.studentName,
          mark: describeMark(grade.value, grade.sign),
          categoryTitle: grade.categoryTitle,
          deletedAt: grade.deletedAt,
          deletedReason: grade.deletedReason,
          deletedByName: grade.deletedByName,
        })),
        attendance: removed.attendance.map((mark) => ({
          id: mark.id,
          studentId: mark.studentId,
          studentName: mark.studentName,
          status: mark.status,
          isExcused: mark.isExcused,
          reason: mark.reason,
          deletedAt: mark.deletedAt,
          deletedReason: mark.deletedReason,
          deletedByName: mark.deletedByName,
        })),
      };
    },

    async saveAttendance(lessonId, input, options) {
      const lesson = await requireLessonForWrite(lessonId, {
        userId: options.actor.userId,
        seesAll: options.seesAll ?? false,
        staff: options.staff ?? true,
      });
      assertLessonActive(lesson);

      if (!isAttendanceStatus(input.status)) {
        throw new AppError('VALIDATION_FAILED', 'Неизвестный статус посещаемости');
      }

      /**
       * Причину заполняем только для уважительной: «Н» без галочки — просто «не
       * был», и ничего вводить не нужно.
       */
      const isExcused = input.isExcused === true;
      const reason = isExcused ? (input.reason ?? null) : null;
      assertReason(isExcused, reason);

      return withTransaction(db, options.executor, async (tx) => {
        const existing = await journal.findAttendanceForSlot(lessonId, input.studentId, tx);

        if (existing !== null) {
          const updated = await journal.updateAttendance(
            existing.id,
            { status: input.status, isExcused, reason },
            tx,
          );
          if (updated === null) throw new AppError('NOT_FOUND', 'Отметка не найдена');

          await journal.recordAttendanceRevision(
            {
              attendanceEntryId: existing.id,
              action: 'update',
              before: existing.status,
              after: input.status,
              reason,
              actorId: options.actor.userId,
            },
            tx,
          );

          await audit.record(
            {
              action: 'update',
              entityKind: 'attendance_entry',
              entityId: existing.id,
              before: { status: existing.status },
              after: { status: input.status, isExcused, reason },
            },
            options.actor,
            tx,
          );

          return updated;
        }

        const created = await journal.insertAttendance(
          {
            lessonId,
            studentId: input.studentId,
            status: input.status,
            isExcused,
            reason,
            createdBy: options.actor.userId,
          },
          tx,
        );

        await journal.recordAttendanceRevision(
          {
            attendanceEntryId: created.id,
            action: 'create',
            before: null,
            after: input.status,
            reason,
            actorId: options.actor.userId,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'attendance_entry',
            entityId: created.id,
            after: { lessonId, studentId: input.studentId, status: input.status },
          },
          options.actor,
          tx,
        );

        return created;
      });
    },

    async markAllPresent(lessonId, input, options) {
      const lesson = await requireLesson(lessonId);
      assertLessonActive(lesson);

      const except = new Set(input.exceptStudentIds ?? []);
      const students = await rosterForLesson(lesson);

      let marked = 0;
      for (const student of students) {
        if (except.has(student.studentId)) continue;

        await this.saveAttendance(
          lessonId,
          { studentId: student.studentId, status: 'present' },
          options,
        );
        marked += 1;
      }

      return { marked };
    },

    async applyRules(filter, options) {
      const rules = (await signRules.listSignRules()).filter((rule) => rule.isActive);
      if (rules.length === 0) return { awarded: 0 };

      const bySign = new Map(rules.map((rule) => [rule.sign, rule]));

      /**
       * Берём только **свободные** знаки: съеденные уже оплатили оценки, и без этого
       * повторный пересчёт выдал бы их второй раз (главный критерий приёмки этапа).
       */
      const signs = await journal.listPendingSignsForGroup({
        studyGroupId: filter.studyGroupId,
        ...(filter.subjectId === undefined ? {} : { subjectId: filter.subjectId }),
        ...(filter.from === undefined ? {} : { from: filter.from }),
        ...(filter.to === undefined ? {} : { to: filter.to }),
      });
      if (signs.length === 0) return { awarded: 0 };

      /**
       * Счётчик — на ученика, предмет и **знак**: точки Пети и точки Васи разные, и
       * плюсы с точками не складываются. Учебный период задаёт границы счёта
       * (ADR-009), поэтому знаки группируем ещё и по периоду.
       */
      const counters = new Map<string, SignRecord[]>();
      for (const sign of signs) {
        const period = await journal.findPeriodForDate(sign.lessonDate);
        const key = `${sign.studentId}:${sign.subjectId}:${sign.sign}:${period?.id ?? 'none'}`;
        const list = counters.get(key) ?? [];
        list.push(sign);
        counters.set(key, list);
      }

      let awarded = 0;

      for (const group of counters.values()) {
        const first = group[0];
        if (first === undefined) continue;

        const rule = bySign.get(first.sign as 'plus' | 'dot');
        if (rule === undefined) continue;

        // Порядок по датам задаёт выборка: «первый знак» — тот, что поставлен раньше.
        const sorted = [...group].sort((left, right) =>
          left.lessonDate === right.lessonDate
            ? left.id.localeCompare(right.id)
            : left.lessonDate.localeCompare(right.lessonDate),
        );

        // Набираем ровно порог знаков на оценку; остаток остаётся в журнале.
        for (let offset = 0; offset + rule.threshold <= sorted.length; offset += rule.threshold) {
          const consumed = sorted.slice(offset, offset + rule.threshold);
          const last = consumed[consumed.length - 1];
          if (last === undefined) continue;

          await withTransaction(db, options.executor, async (tx) => {
            /**
             * Оценка — обычная: дата берётся от урока последнего знака, причина —
             * причина знака. Дальше её можно править и удалять как любую другую.
             */
            const created = await journal.insertGrade(
              {
                lessonId: last.lessonId,
                studentId: last.studentId,
                value: SIGN_REWARDS[rule.sign],
                sign: null,
                categoryId: rule.categoryId,
                comment: null,
                createdBy: options.actor.userId,
              },
              tx,
            );

            await journal.markSignsConsumed(
              {
                signIds: consumed.map((sign) => sign.id),
                gradeId: created.id,
                actorId: options.actor.userId,
              },
              tx,
            );

            await journal.recordGradeRevision(
              {
                gradeEntryId: created.id,
                action: 'create',
                before: null,
                after: SIGN_REWARDS[rule.sign],
                reason: `Пересчёт знаков: ${String(rule.threshold)} ${signLabel(rule.sign)}`,
                actorId: options.actor.userId,
              },
              tx,
            );

            /**
             * В аудите — состав съеденных знаков: видно, из чего сложилась оценка.
             * Без этого «откуда взялась пятёрка» не восстановить.
             */
            await audit.record(
              {
                action: 'create',
                entityKind: 'grade_entry',
                entityId: created.id,
                after: {
                  studentId: last.studentId,
                  value: SIGN_REWARDS[rule.sign],
                  date: last.lessonDate,
                  rule: `${String(rule.threshold)} ${signLabel(rule.sign)}`,
                  consumedSigns: consumed.map(
                    (sign) =>
                      `${signLabel(rule.sign)} от ${sign.lessonDate} за ${sign.categoryTitle ?? 'без причины'}`,
                  ),
                },
              },
              options.actor,
              tx,
            );

            awarded += 1;
          });
        }
      }

      return { awarded };
    },

    async stats(filter) {
      if (filter.studentIds.length === 0) {
        return [];
      }

      const [grades, attendance] = await Promise.all([
        journal.listGradesForStudents({
          studentIds: filter.studentIds,
          ...(filter.subjectId === undefined ? {} : { subjectId: filter.subjectId }),
          ...(filter.from === undefined ? {} : { from: filter.from }),
          ...(filter.to === undefined ? {} : { to: filter.to }),
        }),
        journal.listAttendanceForStudents({
          studentIds: filter.studentIds,
          ...(filter.from === undefined ? {} : { from: filter.from }),
          ...(filter.to === undefined ? {} : { to: filter.to }),
        }),
      ]);

      const result = [];
      for (const studentId of filter.studentIds) {
        const own = grades.filter((grade) => grade.studentId === studentId);
        const marks = attendance.filter((mark) => mark.studentId === studentId);
        /**
         * Разбивку считаем один раз: в ней и процент «присутствовал», и счётчики по
         * статусам для круговой диаграммы.
         */
        const breakdown = attendanceBreakdown(
          marks.map((mark) => ({
            status: mark.status as AttendanceStatus,
            isExcused: mark.isExcused,
          })),
        );

        result.push({
          studentId,
          studentName: (await journal.findStudentName(studentId)) ?? 'Ученик',
          /**
           * Средний балл — только по числовым оценкам: знаки «+» и «·» в него не
           * входят, `weightedAverage` их пропускает.
           */
          average: weightedAverage(
            own.map((grade) => ({
              value: grade.value ?? '',
              weight: grade.categoryWeight ?? 1,
            })),
          ),
          gradesCount: own.filter((grade) => grade.value !== null).length,
          attendancePercent: breakdown.percent,
          attendance: breakdown,
        });
      }

      return result;
    },
  };
}
