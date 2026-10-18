import type { LessonMarksResponseDto } from '@edu-diary/contracts';
import { ATTENDANCE_LABELS, attendanceLetter } from '@edu-diary/contracts';

/**
 * Отметки в расписании: оценки и посещаемость без возможности правки.
 *
 * Видно только ученику и законному представителю (решение владельца). Оформление то же,
 * что в журнале урока: оценка с кодом причины и весом, посещаемость — буквой. Отличается
 * расположение: оценки в правом верхнем углу плашки, буква посещаемости — в правом нижнем,
 * потому что плашка занятия и так несёт много текста.
 */

type Grade = LessonMarksResponseDto['grades'][number];
type Attendance = LessonMarksResponseDto['attendance'][number];

/** Значение отметки: «5» или знак. */
function gradeValue(grade: Grade): string {
  if (grade.value !== null) return grade.value;
  return grade.sign === 'plus' ? '+' : '·';
}

/**
 * Подсказка отметки: полное название причины и вес.
 *
 * Вес `1` не упоминаем: он по умолчанию и в подсказке был бы шумом — так же, как он не
 * показывается рядом с отметкой в журнале.
 */
function gradeTitle(grade: Grade): string {
  const parts = [gradeValue(grade)];
  if (grade.categoryTitle !== null) parts.push(grade.categoryTitle);
  if (grade.categoryWeight > 1) parts.push(`вес ${String(grade.categoryWeight)}`);
  return parts.join(' · ');
}

/** Подсказка посещаемости: название статуса и причина, если она есть. */
function attendanceTitle(mark: Attendance): string {
  const label =
    attendanceLetter(mark.status, mark.isExcused) === 'У'
      ? 'Не был, уважительно'
      : (ATTENDANCE_LABELS[mark.status as keyof typeof ATTENDANCE_LABELS] ?? mark.status);
  return mark.reason === null ? label : `${label} · ${mark.reason}`;
}

/**
 * Оценки за занятие: ряд отметок в правом верхнем углу.
 *
 * Оформление как в журнале: значение, код причины надстрочно, вес подстрочно (кроме веса
 * `1`). Правки нет: это только показ.
 */
export function LessonGrades({ grades }: { grades: Grade[] }) {
  if (grades.length === 0) return null;

  return (
    <span className="flex flex-wrap items-baseline gap-1">
      {grades.map((grade, index) => (
        <span
          key={`${grade.lessonId}-${String(index)}`}
          title={gradeTitle(grade)}
          className="inline-flex items-baseline rounded bg-muted px-1 text-sm leading-tight font-medium text-foreground"
        >
          {gradeValue(grade)}
          {grade.categoryCode !== null && (
            <sup className="ml-0.5 text-[9px] text-muted-foreground">{grade.categoryCode}</sup>
          )}
          {grade.categoryWeight > 1 && (
            <sub className="text-[9px] text-muted-foreground">{grade.categoryWeight}</sub>
          )}
        </span>
      ))}
    </span>
  );
}

/** Отметка посещаемости: буква со стандартной подсказкой. */
export function LessonAttendance({ mark }: { mark: Attendance | undefined }) {
  if (mark === undefined) return null;

  return (
    <span
      title={attendanceTitle(mark)}
      className="inline-block rounded bg-muted px-1 text-xs leading-tight text-foreground"
    >
      {attendanceLetter(mark.status, mark.isExcused)}
    </span>
  );
}

/**
 * Счётчик оценок для недельного вида: сколько отметок выставлено за занятие.
 *
 * В плитке недели места мало, поэтому вместо ряда отметок — число; расшифровка в
 * подсказке. Знаки «+» и «·» считаются наравне с оценками: ученику важно, сколько всего
 * отметок он получил за пару.
 */
export function LessonGradesCount({ grades }: { grades: Grade[] }) {
  if (grades.length === 0) return null;

  return (
    <span
      title="Количество оценок за день"
      className="inline-block rounded bg-muted px-1 text-[10px] leading-tight text-foreground"
    >
      {grades.length}
    </span>
  );
}
