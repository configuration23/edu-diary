/**
 * Журнал: оценки, знаки «+/·» и посещаемость.
 *
 * Чистые правила без инфраструктуры: их проверяют тестами, а сервер и интерфейс
 * используют одни и те же функции. Модель опирается на ADR-006 (единица журнала —
 * урок), ADR-009 (границы периода) и ADR-010 (эскалация знаков — идемпотентна).
 */

/** Что можно записать в журнал: числовая оценка или знак. */
export const MARK_VALUES = ['2', '3', '4', '5'] as const;
export const MARK_SIGNS = ['plus', 'dot'] as const;

export type MarkValue = (typeof MARK_VALUES)[number];
export type MarkSign = (typeof MARK_SIGNS)[number];

export function isMarkValue(value: string): value is MarkValue {
  return (MARK_VALUES as readonly string[]).includes(value);
}

export function isMarkSign(value: string): value is MarkSign {
  return (MARK_SIGNS as readonly string[]).includes(value);
}

/** Числовая оценка как число: нужно для среднего балла. У знаков числа нет. */
export function markNumber(value: string): number | null {
  return isMarkValue(value) ? Number(value) : null;
}

/** Подпись знака для интерфейса: «+» и «.». */
export const SIGN_LABELS: Record<MarkSign, string> = {
  plus: '+',
  dot: '.',
};

/**
 * Посещаемость: П (был), О (прогул), У (уважительная), Б (болезнь), Н (опоздал).
 *
 * Коды английские, потому что попадают в БД и в выгрузки; русские буквы — это
 * подписи для интерфейса.
 */
export const ATTENDANCE_STATUSES = ['present', 'not_present', 'sick', 'late', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Статусы, которые преподаватель ставит в журнале: «уважительная» — не статус. */
export const ATTENDANCE_CHOICES = ['present', 'not_present', 'sick', 'late'] as const;

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: 'Присутствовал',
  not_present: 'Не был',
  sick: 'Болел',
  late: 'Опоздал',
  excused: 'Уважительная',
};

/** Короткие буквы для журнала: как в бумажном журнале. */
export const ATTENDANCE_SHORT: Record<AttendanceStatus, string> = {
  present: 'П',
  not_present: 'Н',
  sick: 'Б',
  late: 'О',
  excused: 'У',
};

/** Буква отметки: отсутствие с уважительной причиной показывается как «У». */
export function attendanceLetter(status: AttendanceStatus, isExcused = false): string {
  if (status === 'not_present' && isExcused) return 'У';
  return ATTENDANCE_SHORT[status];
}

export function isAttendanceStatus(value: string): value is AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

/** Отметка посещаемости для расчёта: статус и признак уважительной причины. */
export interface AttendanceMark {
  status: AttendanceStatus;
  isExcused?: boolean;
}

/**
 * Посещаемость по всем статусам.
 *
 * Возвращаем и проценты каждого статуса (для круговой диаграммы), и итоговый
 * процент: «был» от всех отмеченных занятий. Уважительная причина считается
 * отдельно — по ней видно, сколько отсутствий было по делу.
 */
export function attendanceBreakdown(marks: readonly AttendanceMark[]): {
  total: number;
  present: number;
  excused: number;
  percent: number;
  byStatus: Record<AttendanceStatus, { count: number; percent: number }>;
} {
  const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((status) => [status, 0])) as Record<
    AttendanceStatus,
    number
  >;

  let excused = 0;
  for (const mark of marks) {
    counts[mark.status] += 1;
    if (mark.status === 'not_present' && mark.isExcused === true) excused += 1;
  }

  const total = marks.length;
  const percentOf = (count: number): number =>
    total === 0 ? 0 : Math.round((count / total) * 1000) / 10;

  return {
    total,
    present: counts.present,
    excused,
    percent: percentOf(counts.present),
    byStatus: Object.fromEntries(
      ATTENDANCE_STATUSES.map((status) => [
        status,
        { count: counts[status], percent: percentOf(counts[status]) },
      ]),
    ) as Record<AttendanceStatus, { count: number; percent: number }>,
  };
}

/** Оценка для расчёта среднего балла: категория задаёт вес. */
export interface WeightedGrade {
  /** Числовая оценка строкой: знаки в средний балл не входят. */
  value: string;
  /** Вес категории: 1 — обычная работа, больше — весомее. */
  weight: number;
}

/**
 * Средний балл с весами категорий.
 *
 * Знаки «+» и «.» в расчёт не входят: они не оценка, а накопление (ADR-010).
 * Если числовых оценок нет — возвращаем `null`, а не ноль: ноль означал бы
 * «учится на двойки».
 */
export function weightedAverage(grades: readonly WeightedGrade[]): number | null {
  let sum = 0;
  let weights = 0;

  for (const grade of grades) {
    const value = markNumber(grade.value);
    if (value === null) continue;

    const weight = grade.weight > 0 ? grade.weight : 1;
    sum += value * weight;
    weights += weight;
  }

  if (weights === 0) return null;
  return Math.round((sum / weights) * 100) / 100;
}

/** Накопление знаков по предмету: то, из чего складывается срабатывание правила. */
export interface SignCounts {
  plus: number;
  dot: number;
}

export function countSigns(marks: readonly { sign: MarkSign | null }[]): SignCounts {
  const counts: SignCounts = { plus: 0, dot: 0 };
  for (const mark of marks) {
    if (mark.sign === null) continue;
    counts[mark.sign] += 1;
  }
  return counts;
}

/** Правило: сколько знаков даёт какую оценку. Порог задаёт администратор. */
export interface EscalationRule {
  sign: MarkSign;
  /** Сколько знаков должно накопиться: 4 плюса, 3 точки и так далее. */
  threshold: number;
  /** Что выдаётся при срабатывании: числовая оценка. */
  reward: MarkValue;
}

/**
 * Сколько раз сработает правило при текущем накоплении и сколько знаков осталось.
 *
 * Считаем не «сработало ли», а **сколько раз**: за период плюсы могут накопить две
 * оценки, если порог пройден дважды.
 *
 * `remaining` — сколько знаков **осталось до следующей** оценки, а не «сколько уже
 * накоплено сверх порога». Это разные числа, и путать их нельзя: при пороге 3 и двух
 * плюсах до оценки остаётся один плюс, а не два. Когда порог набран ровно, остаток
 * равен нулю: оценку можно выдать хоть сейчас.
 *
 * Функция чистая: одинаковое накопление всегда даёт одинаковый результат. Именно
 * на ней держится идемпотентность пересчёта (ADR-010) — повторный расчёт по тем же
 * данным ничего не меняет.
 */
export function escalationState(
  counts: SignCounts,
  rule: EscalationRule,
): { applications: number; remaining: number } {
  const total = counts[rule.sign];
  if (rule.threshold <= 0) return { applications: 0, remaining: rule.threshold };

  const applications = Math.floor(total / rule.threshold);
  const extra = total % rule.threshold;
  const remaining = extra === 0 ? 0 : rule.threshold - extra;

  return { applications, remaining };
}

/**
 * Есть ли срабатывание, которого ещё нет в журнале применений.
 *
 * `applied` — сколько применений уже записано (например, из
 * `grade_rule_application`). Разница — то, что нужно создать сейчас; 0 означает,
 * что пересчёт ничего не делает.
 */
export function pendingApplications(applied: number, state: { applications: number }): number {
  return Math.max(0, state.applications - applied);
}
