import { useState } from 'react';

import {
  ATTENDANCE_LABELS,
  attendanceLetter,
  type AttendanceBySubjectResponseDto,
  type GradesBySubjectResponseDto,
  type MarksByStudentResponseDto,
  type SessionResponseDto,
} from '@edu-diary/contracts';

import { Card, Checkbox, EmptyState, Field, Select, Table } from '../components/ui';
import {
  useAttendanceBySubject,
  useGradesBySubject,
  useMarksByStudent,
  type AbsenceOptions,
} from '../lib/journal-queries';
import { useAssignments, useGroupEnrollments, useGroups } from '../lib/queries';

/**
 * «Оценки и посещение» (Этап 4, шаг 4).
 *
 * Диапазон дат не выбирается: раздел всегда работает за **текущий учебный период** —
 * его задаёт «Учебный год». Если периода нет, сервер отвечает `period_not_set`, и экран
 * показывает «Период не задан».
 *
 * Роли видят разное:
 * - **ученик и законный представитель** — списки по предметам: отметки со средней, либо
 *   посещение с процентом пропусков;
 * - **преподаватель** — по ученикам своей группы за свой предмет, только по своим
 *   занятиям (замену смотрит основной преподаватель);
 * - **администратор** — выбирает группу и ученика и смотрит тот же вид, что ученик.
 *
 * Отметки показываются компактно, как в журнале урока, но **без правки**: правка только
 * в журнале урока. В подсказке — причина, вес и дата.
 */

const ABSENCE_LABELS: Record<string, string> = { ...ATTENDANCE_LABELS };

/** Подсказка отметки: значение, причина, вес и дата. */
function markTitle(mark: {
  value: string | null;
  sign: string | null;
  categoryTitle: string | null;
  categoryWeight: number;
  lessonDate: string;
}): string {
  const parts = [mark.value ?? (mark.sign === 'plus' ? '+' : '·')];
  if (mark.categoryTitle !== null) parts.push(mark.categoryTitle);
  if (mark.categoryWeight > 1) parts.push(`вес ${String(mark.categoryWeight)}`);
  parts.push(formatIso(mark.lessonDate));
  return parts.join(' · ');
}

/** Дата в читаемом виде: в подсказке она важнее формата. */
function formatIso(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`;
}

/** Компактная отметка: значение, код причины надстрочно, вес подстрочно. */
function MarkChip({
  mark,
}: {
  mark: {
    value: string | null;
    sign: string | null;
    categoryCode: string | null;
    categoryTitle: string | null;
    categoryWeight: number;
    lessonDate: string;
  };
}) {
  return (
    <span
      title={markTitle(mark)}
      className="inline-flex items-baseline rounded bg-muted px-1 text-sm leading-tight font-medium text-foreground"
    >
      {mark.value ?? (mark.sign === 'plus' ? '+' : '·')}
      {mark.categoryCode !== null && (
        <sup className="ml-0.5 text-[9px] text-muted-foreground">{mark.categoryCode}</sup>
      )}
      {mark.categoryWeight > 1 && (
        <sub className="text-[9px] text-muted-foreground">{mark.categoryWeight}</sub>
      )}
    </span>
  );
}

/** Отметка посещаемости буквой: подсказка объясняет и дату. */
function AttendanceChip({
  mark,
}: {
  mark: { status: string; isExcused: boolean; reason: string | null; lessonDate: string };
}) {
  const letter = attendanceLetter(mark.status, mark.isExcused);
  const label =
    letter === 'У' ? 'Не был, уважительно' : (ABSENCE_LABELS[mark.status] ?? mark.status);
  const title = [label, mark.reason, formatIso(mark.lessonDate)]
    .filter((part) => part !== null && part !== '')
    .join(' · ');

  return (
    <span title={title} className="inline-block rounded bg-muted px-1 text-xs text-foreground">
      {letter}
    </span>
  );
}

/** Итог в конце списка: средняя или процент, отделён визуально. */
function TotalBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="rounded bg-primary px-2 py-0.5 text-sm font-medium text-primary-foreground">
        {value}
      </span>
    </div>
  );
}

/** «Период не задан»: раздел не работает без текущего учебного периода. */
function PeriodMissing() {
  return (
    <Card>
      <EmptyState>
        Период не задан. Заведите учебный период в разделе «Учебный год», покрывающий сегодняшнюю
        дату, — и отчёт построится за него.
      </EmptyState>
    </Card>
  );
}

export function GradesAttendanceScreen({ session }: { session: SessionResponseDto }) {
  const canChooseStudent = session.permissions.some(
    (grant) => grant.permission === 'grades:read' && grant.scope === 'all',
  );
  const isTeacherOnly =
    !canChooseStudent &&
    session.permissions.some(
      (grant) => grant.permission === 'grades:read' && grant.scope === 'assigned',
    );

  const [tab, setTab] = useState<'grades' | 'attendance'>('grades');
  /** Галочки живут только на экране: при загрузке выключены (решение владельца). */
  const [options, setOptions] = useState<AbsenceOptions>({
    countExcused: false,
    countSick: false,
  });

  /**
   * Справочник групп нужен только администратору (он выбирает группу и ученика).
   * Ученику и представителю он недоступен, преподавателю группы дают назначения.
   */
  const groups = useGroups({}, { enabled: canChooseStudent });
  const [adminGroupId, setAdminGroupId] = useState('');
  /** Ученики выбранной группы: список дают зачисления этой группы. */
  const enrollments = useGroupEnrollments(adminGroupId === '' ? null : adminGroupId);
  const [adminStudentId, setAdminStudentId] = useState('');

  /** Преподаватель: свои назначения дают группы и предметы. Остальным они не нужны. */
  const assignments = useAssignments({}, { enabled: isTeacherOnly });
  const [teacherGroupId, setTeacherGroupId] = useState('');
  const [teacherSubjectId, setTeacherSubjectId] = useState('');

  const ownAssignments = assignments.data?.items ?? [];
  const teacherGroups = [
    ...new Map(ownAssignments.map((item) => [item.studyGroupId, item.groupName])).entries(),
  ];
  const teacherSubjects = [
    ...new Map(ownAssignments.map((item) => [item.subjectId, item.subjectName])).entries(),
  ];

  // Первый доступный вариант подставляем сразу: чаще всего работают с одним.
  if (isTeacherOnly && teacherGroupId === '' && teacherGroups.length > 0) {
    setTeacherGroupId(teacherGroups[0]?.[0] ?? '');
  }
  if (isTeacherOnly && teacherSubjectId === '' && teacherSubjects.length > 0) {
    setTeacherSubjectId(teacherSubjects[0]?.[0] ?? '');
  }
  if (canChooseStudent && adminGroupId === '' && (groups.data?.items.length ?? 0) > 0) {
    setAdminGroupId(groups.data?.items[0]?.id ?? '');
  }

  const groupStudents = enrollments.data?.items ?? [];
  if (canChooseStudent && adminStudentId === '' && groupStudents.length > 0) {
    setAdminStudentId(groupStudents[0]?.studentId ?? '');
  }

  const studentId = canChooseStudent ? (adminStudentId === '' ? null : adminStudentId) : null;

  /**
   * Третья роль этого экрана: **ученик и законный представитель**.
   *
   * Им отчёт строится по своим строкам, поэтому `studentId` не нужен — его и не бывает.
   * Признак: право `grades:read` с областью `own`. Без этой ветки запрос выключался и
   * «Мои оценки» оставались пустыми.
   */
  const isOwnView =
    !canChooseStudent &&
    !isTeacherOnly &&
    session.permissions.some((grant) => grant.permission === 'grades:read');

  /**
   * Преподавателю отчёт строится по ученикам, поэтому запросы «по предметам» выключаем:
   * без `studentId` маршрут отвечает отказом «укажите ученика». Администратору они нужны,
   * когда ученик выбран, ученику — всегда.
   */
  const subjectViewEnabled = isOwnView || (!isTeacherOnly && studentId !== null);

  const grades = useGradesBySubject(isOwnView ? null : studentId, {
    enabled: subjectViewEnabled,
  });
  const attendance = useAttendanceBySubject(isOwnView ? null : studentId, options, {
    enabled: subjectViewEnabled,
  });
  const teacherView = useMarksByStudent(
    { studyGroupId: teacherGroupId, subjectId: teacherSubjectId },
    options,
    isTeacherOnly,
  );

  const periodMissing =
    (grades.error ?? attendance.error ?? teacherView.error) !== null &&
    JSON.stringify(grades.error ?? attendance.error ?? teacherView.error).includes(
      'period_not_set',
    );

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <h2 className="text-lg font-medium text-foreground">Оценки и посещение</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Отчёт за текущий учебный период. Знаки «+» и «·» показываются в списке, но в средний балл
          не входят — это накопление, а не оценка.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Раздел">
            <span className="flex gap-2">
              <button
                type="button"
                id="tab-grades"
                onClick={() => setTab('grades')}
                className={`rounded-md border px-3 py-2 text-sm ${
                  tab === 'grades'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground'
                }`}
              >
                Оценки
              </button>
              <button
                type="button"
                id="tab-attendance"
                onClick={() => setTab('attendance')}
                className={`rounded-md border px-3 py-2 text-sm ${
                  tab === 'attendance'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground'
                }`}
              >
                Посещение
              </button>
            </span>
          </Field>

          {canChooseStudent && (
            <>
              <Field label="Группа">
                <Select
                  name="studyGroupId"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={adminGroupId}
                  onChange={(event) => {
                    setAdminGroupId(event.target.value);
                    setAdminStudentId('');
                  }}
                >
                  <option value="">Выберите группу</option>
                  {(groups.data?.items ?? []).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Ученик">
                <Select
                  name="studentId"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={adminStudentId}
                  onChange={(event) => setAdminStudentId(event.target.value)}
                >
                  <option value="">Выберите ученика</option>
                  {groupStudents.map((enrollment) => (
                    <option key={enrollment.studentId} value={enrollment.studentId}>
                      {enrollment.studentName}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}

          {isTeacherOnly && (
            <>
              <Field label="Группа">
                <Select
                  name="teacherGroupId"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={teacherGroupId}
                  onChange={(event) => setTeacherGroupId(event.target.value)}
                >
                  {teacherGroups.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Предмет">
                <Select
                  name="teacherSubjectId"
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={teacherSubjectId}
                  /* Один предмет — выбор заблокирован: выбирать не из чего. */
                  disabled={teacherSubjects.length <= 1}
                  onChange={(event) => setTeacherSubjectId(event.target.value)}
                >
                  {teacherSubjects.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </div>

        {tab === 'attendance' && (
          <div className="mt-4 flex flex-wrap gap-4 border-t border-border pt-3 text-sm">
            <Checkbox
              className="flex items-center gap-2"
              checked={options.countExcused}
              onChange={(event) =>
                setOptions((current) => ({ ...current, countExcused: event.target.checked }))
              }
              label="Считать уважительные как пропуски"
            />
            <Checkbox
              className="flex items-center gap-2"
              checked={options.countSick}
              onChange={(event) =>
                setOptions((current) => ({ ...current, countSick: event.target.checked }))
              }
              label="Считать больничные как пропуски"
            />
          </div>
        )}
      </Card>

      {periodMissing ? (
        <PeriodMissing />
      ) : isTeacherOnly ? (
        <TeacherView
          data={teacherView.data}
          tab={tab}
          options={options}
          isLoading={teacherView.isLoading}
        />
      ) : (
        <SubjectView
          grades={grades.data}
          attendance={attendance.data}
          tab={tab}
          options={options}
          isLoading={grades.isLoading || attendance.isLoading}
        />
      )}
    </div>
  );
}

/** Вид ученика и представителя: списки по предметам. */
function SubjectView({
  grades,
  attendance,
  tab,
  options,
  isLoading,
}: {
  grades: GradesBySubjectResponseDto | undefined;
  attendance: AttendanceBySubjectResponseDto | undefined;
  tab: 'grades' | 'attendance';
  options: AbsenceOptions;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      </Card>
    );
  }

  if (tab === 'grades') {
    const subjects = grades?.subjects ?? [];
    if (subjects.length === 0) {
      return (
        <Card>
          <EmptyState>За текущий период оценок нет.</EmptyState>
        </Card>
      );
    }

    return (
      <>
        {subjects.map((subject) => (
          <Card key={subject.subjectId}>
            <h3 className="font-medium text-foreground">{subject.subjectName}</h3>
            <div className="mt-2 flex flex-wrap gap-1">
              {subject.marks.map((mark) => (
                <MarkChip key={mark.id} mark={mark} />
              ))}
            </div>
            <TotalBadge
              label="Средняя"
              value={subject.average === null ? '—' : subject.average.toFixed(2)}
            />
          </Card>
        ))}
      </>
    );
  }

  const subjects = attendance?.subjects ?? [];
  if (subjects.length === 0) {
    return (
      <Card>
        <EmptyState>За текущий период отмеченных занятий нет.</EmptyState>
      </Card>
    );
  }

  return (
    <>
      {subjects.map((subject) => (
        <Card key={subject.subjectId}>
          <h3 className="font-medium text-foreground">{subject.subjectName}</h3>
          <div className="mt-2 flex flex-wrap gap-1">
            {subject.marks.map((mark) => (
              <AttendanceChip key={mark.id} mark={mark} />
            ))}
          </div>
          <TotalBadge
            label={
              options.countExcused || options.countSick
                ? `Пропуски (без галочек ${String(subject.basePercent)}%)`
                : `Пропуски: ${String(subject.absences)} из ${String(subject.total)}`
            }
            value={`${String(subject.percent)}%`}
          />
        </Card>
      ))}
    </>
  );
}

/** Вид преподавателя: строки по ученикам его группы. */
function TeacherView({
  data,
  tab,
  options,
  isLoading,
}: {
  data: MarksByStudentResponseDto | undefined;
  tab: 'grades' | 'attendance';
  options: AbsenceOptions;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      </Card>
    );
  }

  const students = data?.students ?? [];
  if (students.length === 0) {
    return (
      <Card>
        <EmptyState>У выбранной группы нет учеников за текущий период.</EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <Table
        head={
          tab === 'grades'
            ? ['Ученик', 'Отметки', 'Итоговая']
            : [
                'Ученик',
                'Посещение',
                options.countExcused || options.countSick ? 'Пропуски' : 'Пропуски',
              ]
        }
      >
        {students.map((student) => (
          <tr key={student.studentId} className="border-b border-border">
            <td className="px-3 py-2 font-medium">{student.studentName}</td>
            {tab === 'grades' ? (
              <>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {student.marks.map((mark) => (
                      <MarkChip key={mark.id} mark={mark} />
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium">
                  {student.average === null ? '—' : student.average.toFixed(2)}
                </td>
              </>
            ) : (
              <>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {student.attendance.marks.map((mark) => (
                      <AttendanceChip key={mark.id} mark={mark} />
                    ))}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium">
                  {student.attendance.percent}%
                  {options.countExcused || options.countSick ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (без галочек {student.attendance.basePercent}%)
                    </span>
                  ) : null}
                </td>
              </>
            )}
          </tr>
        ))}
      </Table>
    </Card>
  );
}
