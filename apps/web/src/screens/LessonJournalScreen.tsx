import {
  ATTENDANCE_LABELS,
  type AttendanceStatusDto,
  type GradeCategoryDto,
  type GradeRevisionDto,
  type GradeEntryDto,
  type SessionResponseDto,
} from '@edu-diary/contracts';
import { attendanceLetter } from '@edu-diary/domain';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Fragment, useState } from 'react';

import { useAppearanceSettings } from '../components/AppearanceContext';
import { Alert, Badge, Button, Card, EmptyState, Field, TextInput } from '../components/ui';
import { SubjectDot } from '../lib/appearance';
import { errorMessage } from '../lib/api-client';
import {
  useApplySignRules,
  useDeleteAttendance,
  useDeleteJournalGrade,
  useDeletedMarks,
  useGradeCategoriesList,
  useGradeRevisions,
  useLessonJournal,
  useSaveAttendance,
  useSaveGrade,
  useAttendanceRevisions,
  useRestoreMark,
  useUpdateJournalGrade,
} from '../lib/journal-queries';

/**
 * Журнал урока: оценки и посещаемость (Этап 4).
 *
 * Работает «на уроке»: преподаватель открывает занятие и отмечает учеников. Оценка
 * ставится в два шага — нажали цифру, выбрали причину. Причина обязательна: она
 * объясняет оценку и задаёт её вес в аналитике.
 *
 * Отметок за урок может быть несколько: за один урок ставят и оценку за ответ, и
 * оценку за контрольную. Если отметка с такой же причиной уже есть, интерфейс
 * спрашивает подтверждение замены — случайный дубль не создаётся.
 */

const VALUES = ['5', '4', '3', '2'] as const;
const SIGNS: { sign: 'plus' | 'dot'; label: string; hint: string }[] = [
  { sign: 'plus', label: '+', hint: 'Плюс: накапливается и по правилу даёт оценку' },
  { sign: 'dot', label: '·', hint: 'Точка: накапливается и по правилу даёт оценку' },
];

/** Буквы журнала: П, Н, Б, О. «У» — это «Н» с уважительной причиной. */
const ATTENDANCE_CHOICES: AttendanceStatusDto[] = ['present', 'not_present', 'sick', 'late'];

/**
 * Удаление отметки посещаемости скрыто по решению владельца.
 *
 * Причина: поставив посещение один раз, отменить его пока нельзя — можно только
 * заменить другой буквой. Функционал при этом целый: сервер удаляет отметку мягко
 * (`attendance_entry.deleted_at`), она попадает в список удалённого и
 * восстанавливается администратором, история правок ведётся.
 *
 * Вернуть кнопку — поменять значение на `true`. Отдельная константа, а не удалённый
 * код: через месяц никто не вспомнит, что удаление было сделано и проверено.
 */
const ATTENDANCE_DELETE_ENABLED = false;

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

/** Что стоит ученику: «5», «+» или «·». */
function describeGradeValue(grade: GradeEntryDto): string {
  if (grade.value !== null) return grade.value;
  return grade.sign === 'plus' ? '+' : '·';
}

/**
 * Расшифровка отметки для подсказки: полное название причины и вес.
 *
 * Вес `1` не упоминаем: он по умолчанию и в подсказке был бы шумом — так же, как
 * он не показывается рядом с оценкой.
 */
function gradeDescription(grade: GradeEntryDto): string {
  const title = grade.categoryTitle ?? 'Причина не указана';
  if (grade.categoryWeight === null || grade.categoryWeight <= 1) return title;

  return `${title} · вес ${String(grade.categoryWeight)}`;
}

/** Подсказка посещаемости: «Не был, уважительно · справка». */
function attendanceDescription(
  status: AttendanceStatusDto,
  isExcused: boolean,
  reason: string | null,
): string {
  const label =
    status === 'not_present' && isExcused ? 'Не был, уважительно' : ATTENDANCE_LABELS[status];
  const parts = [label];

  // Причину показываем только у уважительной: для остальных она не заполняется.
  if (status === 'not_present' && isExcused && reason !== null && reason !== '') {
    parts.push(reason);
  }

  return parts.join(' · ');
}

/** Что ставим: цифру или знак. */
type PendingMark = { kind: 'value'; value: string } | { kind: 'sign'; sign: 'plus' | 'dot' };

/** Выбор причины отметки: один шаг после нажатия цифры или знака. */
function ReasonPicker({
  reasons,
  pending,
  busy,
  onCancel,
  onPick,
}: {
  reasons: GradeCategoryDto[];
  pending: PendingMark;
  busy: boolean;
  onCancel: () => void;
  onPick: (categoryId: string) => void;
}) {
  const [categoryId, setCategoryId] = useState(reasons[0]?.id ?? '');

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-sky-200 bg-sky-50 p-3">
      <div className="text-sm text-slate-700">
        Отметка:{' '}
        <span className="font-semibold">
          {pending.kind === 'value' ? pending.value : pending.sign === 'plus' ? '+' : '·'}
        </span>
      </div>

      <div className="min-w-56 flex-1">
        <Field label="Причина">
          <select
            name="categoryId"
            className={selectClass}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {reasons.map((reason) => (
              <option key={reason.id} value={reason.id}>
                {reason.code} — {reason.title}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Button type="button" disabled={busy || categoryId === ''} onClick={() => onPick(categoryId)}>
        Поставить
      </Button>
      <Button tone="ghost" type="button" onClick={onCancel}>
        Отмена
      </Button>
    </div>
  );
}

/** История правок: одна вёрстка и для оценки, и для посещаемости. */
function RevisionList({ revisions }: { revisions: GradeRevisionDto[] | undefined }) {
  if (revisions === undefined || revisions.length === 0) {
    return <p className="text-sm text-slate-500">Правок не было.</p>;
  }

  return (
    <ul className="flex flex-col gap-1 text-sm text-slate-600">
      {revisions.map((item) => (
        <li key={item.id}>
          {item.actorName ?? 'система'}: {item.before ?? '—'} → {item.after ?? '—'}
          {item.reason === null ? '' : ` · ${item.reason}`}
        </li>
      ))}
    </ul>
  );
}

/** Правка отметки: новая оценка, причина правки и история. */
function EditPanel({
  gradeId,
  lessonId,
  reasons,
  revisions,
  onClose,
}: {
  gradeId: string;
  lessonId: string;
  reasons: GradeCategoryDto[];
  revisions: GradeRevisionDto[] | undefined;
  onClose: () => void;
}) {
  const update = useUpdateJournalGrade(lessonId);
  const remove = useDeleteJournalGrade(lessonId);

  const [value, setValue] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [reason, setReason] = useState('');
  const [deleteReason, setDeleteReason] = useState('');

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Новая оценка">
          <select
            name="gradeValue"
            className={selectClass}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="">— не менять —</option>
            {VALUES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Причина отметки">
          <select
            name="gradeReason"
            className={selectClass}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">— не менять —</option>
            {reasons.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex-1">
          <Field label="Причина правки" hint="Без причины история правок бесполезна">
            <TextInput
              name="editReason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
        <Button
          type="button"
          disabled={update.isPending || reason.trim().length < 3}
          onClick={() =>
            void update
              .mutateAsync({
                gradeId,
                ...(value === '' ? {} : { value }),
                ...(categoryId === '' ? {} : { categoryId }),
                reason,
              })
              .then(() => {
                setReason('');
                setValue('');
                setCategoryId('');
              })
              .catch(() => undefined)
          }
        >
          Сохранить правку
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <Field label="Причина удаления" hint="Отметка скрывается, но остаётся в истории">
            <TextInput
              name="deleteReason"
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
            />
          </Field>
        </div>
        <Button
          tone="danger"
          type="button"
          disabled={remove.isPending || deleteReason.trim().length < 3}
          onClick={() =>
            void remove
              .mutateAsync({ gradeId, reason: deleteReason })
              .then(() => onClose())
              .catch(() => undefined)
          }
        >
          Удалить отметку
        </Button>
        <Button tone="ghost" type="button" onClick={onClose}>
          Закрыть
        </Button>
      </div>

      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
      {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}

      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">История правок</p>
        <RevisionList revisions={revisions} />
      </div>
    </div>
  );
}

export function LessonJournalScreen({ session }: { session: SessionResponseDto }) {
  const params = useParams({ strict: false }) as { lessonId?: string };
  const lessonId = params.lessonId ?? null;
  const navigate = useNavigate();

  const journal = useLessonJournal(lessonId);
  const reasons = useGradeCategoriesList();
  const appearance = useAppearanceSettings();
  const saveGrade = useSaveGrade(lessonId ?? '');
  const saveAttendance = useSaveAttendance(lessonId ?? '');
  const applySignRules = useApplySignRules(lessonId);
  const deleteAttendance = useDeleteAttendance(lessonId ?? '');
  const restoreMark = useRestoreMark(lessonId);

  const canRestore = session.permissions.some(
    (grant) => grant.permission === 'grades:read' && grant.scope === 'all',
  );
  const deleted = useDeletedMarks(lessonId, canRestore);

  /** Для кого выбираем причину отметки: ученик и то, что ставим. */
  const [pending, setPending] = useState<{ studentId: string; mark: PendingMark } | null>(null);
  /** Для кого спрашиваем подтверждение замены: отметка с такой причиной уже есть. */
  const [duplicate, setDuplicate] = useState<{
    studentId: string;
    mark: PendingMark;
    categoryId: string;
  } | null>(null);
  /** Окно «Н»: отсутствие с необязательной уважительной причиной. */
  const [absenceFor, setAbsenceFor] = useState<string | null>(null);
  const [absenceExcused, setAbsenceExcused] = useState(false);
  const [absenceReason, setAbsenceReason] = useState('');
  /** Раскрытая правка отметки. */
  const [editingGradeId, setEditingGradeId] = useState<string | null>(null);
  /** Удаление отметки посещаемости: спрашиваем причину. */
  const [deletingAttendance, setDeletingAttendance] = useState<string | null>(null);
  const [attendanceDeleteReason, setAttendanceDeleteReason] = useState('');
  /** Чья история посещаемости раскрыта. */
  const [historyAttendanceId, setHistoryAttendanceId] = useState<string | null>(null);

  /** История правок: хуки нельзя вызывать условно, поэтому читаем по выбранным идентификаторам. */
  const gradeRevisions = useGradeRevisions(editingGradeId);
  const attendanceRevisions = useAttendanceRevisions(historyAttendanceId);

  const canWrite = session.permissions.some((grant) => grant.permission === 'grades:write');
  const canAttend = session.permissions.some((grant) => grant.permission === 'attendance:write');
  /** Удаление посещаемости: включено ли в интерфейсе (сейчас скрыто, см. константу). */
  const canDeleteAttendance = ATTENDANCE_DELETE_ENABLED && canAttend;
  const reasonList = reasons.data?.items ?? [];

  if (journal.isLoading) {
    return (
      <Card title="Журнал урока">
        <EmptyState>Загружаем…</EmptyState>
      </Card>
    );
  }

  if (journal.isError || journal.data === undefined) {
    return (
      <Card title="Журнал урока">
        <Alert tone="error">
          {journal.isError ? errorMessage(journal.error) : 'Журнал не найден'}
        </Alert>
        <div className="mt-3">
          <Button tone="secondary" type="button" onClick={() => void navigate({ to: '/lessons' })}>
            Вернуться к урокам
          </Button>
        </div>
      </Card>
    );
  }

  const { lesson, students, signRules } = journal.data;
  const cancelled = lesson.status === 'cancelled';
  /** Включённые знаки: по ним пересчёт действительно выдаёт оценки. */
  const activeSignRules = signRules.filter((rule) => rule.isActive);

  /** Постановка отметки: цифра или знак, всегда с причиной. */
  const putMark = async (
    studentId: string,
    mark: PendingMark,
    categoryId: string,
    replace = false,
  ): Promise<void> => {
    try {
      await saveGrade.mutateAsync({
        studentId,
        categoryId,
        ...(mark.kind === 'value' ? { value: mark.value } : { sign: mark.sign }),
        ...(replace ? { replace: true } : {}),
      });
      setPending(null);
      setDuplicate(null);
    } catch (error) {
      /**
       * Сервер отвечает конфликтом, если отметка с такой же причиной за урок уже
       * есть: спрашиваем подтверждение замены вместо молчаливой второй отметки.
       */
      const details =
        typeof error === 'object' && error !== null && 'details' in error
          ? ((error as { details?: { reason?: string } }).details ?? {})
          : {};

      if (details.reason === 'duplicate_grade') {
        setPending(null);
        setDuplicate({ studentId, mark, categoryId });
        return;
      }

      throw error;
    }
  };

  const openAbsence = (studentId: string): void => {
    setAbsenceFor(studentId);
    setAbsenceExcused(false);
    setAbsenceReason('');
  };

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Журнал урока"
        description={`${lesson.lessonDate} · ${lesson.pairNumber}-я пара ${lesson.timeStart}–${lesson.timeEnd} · ${lesson.groupName}`}
        actions={
          <Button tone="secondary" type="button" onClick={() => void navigate({ to: '/lessons' })}>
            К урокам
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <SubjectDot subjectId={lesson.subjectId} enabled={appearance.colorsEnabled} />
          <span className="font-medium">{lesson.subjectName}</span>
          <Badge tone={cancelled ? 'danger' : 'neutral'}>
            {cancelled ? 'Урок отменён' : 'Занятие по плану'}
          </Badge>
          <span className="text-slate-500">{lesson.teacherName}</span>
          {lesson.topic !== null && <span className="text-slate-500">· тема: {lesson.topic}</span>}
        </div>

        {signRules.length > 0 && (
          <p className="mt-2 text-sm text-slate-500">
            Оценка за знаки:{' '}
            {signRules
              .map(
                (rule) =>
                  `${String(rule.threshold)} ${rule.sign === 'plus' ? 'плюсов' : 'точек'} → ${rule.sign === 'plus' ? '5' : '2'}${
                    rule.isActive ? '' : ' (выключено)'
                  }`,
              )
              .join('; ')}
            . Пересчёт запускается кнопкой и заменяет накопленные знаки оценкой.
          </p>
        )}

        {canWrite && !cancelled && activeSignRules.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              tone="secondary"
              type="button"
              disabled={applySignRules.isPending}
              onClick={() =>
                void applySignRules
                  .mutateAsync({ studyGroupId: lesson.studyGroupId })
                  .catch(() => undefined)
              }
            >
              Пересчитать + / ·
            </Button>
            {applySignRules.isSuccess && (
              <span className="text-sm text-slate-600">
                {applySignRules.data.awarded === 0
                  ? 'Знаков на оценку не набралось'
                  : `Выдано оценок: ${String(applySignRules.data.awarded)}`}
              </span>
            )}
            {applySignRules.isError && (
              <Alert tone="error">{errorMessage(applySignRules.error)}</Alert>
            )}
          </div>
        )}

        {cancelled && (
          <div className="mt-3">
            <Alert tone="warning">
              Урок отменён: отметки по нему не ставятся. Если занятие всё же состоялось, верните его
              в план в разделе «Уроки».
            </Alert>
          </div>
        )}
      </Card>

      <Card
        title="Ученики"
        description={
          canWrite
            ? 'Оценка ставится в два шага: цифра или знак, затем причина. Причина обязательна — она задаёт вес оценки в аналитике.'
            : 'Отметки ставит преподаватель или администратор: здесь только просмотр.'
        }
      >
        {students.length === 0 ? (
          <EmptyState>В группе на эту дату учеников нет.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-3 py-2 font-medium">Ученик</th>
                  <th className="px-3 py-2 font-medium">Отметки за урок</th>
                  <th className="px-3 py-2 font-medium">Посещаемость</th>
                  <th className="px-3 py-2 font-medium">Знаки</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <Fragment key={student.studentId}>
                    <tr className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2 font-medium">{student.fullName}</td>

                      <td className="px-3 py-2">
                        {student.grades.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          /*
                            Отметки идут в строку, а не столбцом: они компактные, и так
                            за урок видно всё сразу. Ширина ограничена пятью отметками —
                            шестая переносится на следующую строку (утилита `marks-row`).
                          */
                          <ul className="marks-row">
                            {student.grades.map((grade: GradeEntryDto) => (
                              <li key={grade.id} className="flex items-center">
                                {/*
                                  Отметка читается как «5₁д»: сама оценка, вес —
                                  подстрочно (кроме веса 1: он по умолчанию и только
                                  засорял бы журнал), код причины — надстрочно.
                                  Полное название причины и вес — в подсказке и в
                                  доступном имени кнопки, чтобы расшифровка была
                                  и при наведении, и у программы чтения с экрана.
                                */}
                                <button
                                  type="button"
                                  disabled={!canWrite || cancelled}
                                  title={gradeDescription(grade)}
                                  aria-label={`${describeGradeValue(grade)}, ${gradeDescription(grade)}`}
                                  onClick={() =>
                                    setEditingGradeId(editingGradeId === grade.id ? null : grade.id)
                                  }
                                  className={`rounded-md border px-2 py-1 transition ${
                                    canWrite && !cancelled
                                      ? 'border-transparent hover:border-sky-400 hover:bg-sky-50'
                                      : 'border-transparent'
                                  } ${editingGradeId === grade.id ? 'border-sky-400 bg-sky-50' : ''}`}
                                >
                                  <span className="text-lg font-semibold">
                                    {describeGradeValue(grade)}
                                  </span>
                                  {grade.categoryWeight !== null && grade.categoryWeight > 1 && (
                                    <sub className="text-xs font-medium text-slate-500">
                                      {grade.categoryWeight}
                                    </sub>
                                  )}
                                  {grade.categoryCode !== null && (
                                    <sup className="text-xs font-medium text-sky-700">
                                      {grade.categoryCode}
                                    </sup>
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {canWrite && !cancelled && reasonList.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {VALUES.map((value) => (
                              <Button
                                key={value}
                                tone="secondary"
                                type="button"
                                disabled={saveGrade.isPending}
                                onClick={() =>
                                  setPending({
                                    studentId: student.studentId,
                                    mark: { kind: 'value', value },
                                  })
                                }
                              >
                                {value}
                              </Button>
                            ))}
                            {SIGNS.map((item) => (
                              <Button
                                key={item.sign}
                                tone="ghost"
                                type="button"
                                title={item.hint}
                                disabled={saveGrade.isPending}
                                onClick={() =>
                                  setPending({
                                    studentId: student.studentId,
                                    mark: { kind: 'sign', sign: item.sign },
                                  })
                                }
                              >
                                {item.label}
                              </Button>
                            ))}
                          </div>
                        )}

                        {pending !== null && pending.studentId === student.studentId && (
                          <ReasonPicker
                            reasons={reasonList}
                            pending={pending.mark}
                            busy={saveGrade.isPending}
                            onCancel={() => setPending(null)}
                            onPick={(categoryId) =>
                              void putMark(student.studentId, pending.mark, categoryId).catch(
                                () => undefined,
                              )
                            }
                          />
                        )}

                        {duplicate !== null && duplicate.studentId === student.studentId && (
                          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                            <span>
                              Уже есть отметка с этой причиной за урок — заменить её новой?
                            </span>
                            <Button
                              type="button"
                              disabled={saveGrade.isPending}
                              onClick={() =>
                                void putMark(
                                  duplicate.studentId,
                                  duplicate.mark,
                                  duplicate.categoryId,
                                  true,
                                ).catch(() => undefined)
                              }
                            >
                              Заменить
                            </Button>
                            <Button tone="ghost" type="button" onClick={() => setDuplicate(null)}>
                              Отмена
                            </Button>
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        {student.attendance === null ? (
                          canAttend && !cancelled ? (
                            <span className="flex flex-wrap gap-1">
                              {ATTENDANCE_CHOICES.map((status) => (
                                <Button
                                  key={status}
                                  tone="secondary"
                                  type="button"
                                  title={ATTENDANCE_LABELS[status]}
                                  disabled={saveAttendance.isPending}
                                  onClick={() => {
                                    // «Н» открывает окно: там можно поставить галочку
                                    // уважительной причины и ввести её текст.
                                    if (status === 'not_present') {
                                      openAbsence(student.studentId);
                                      return;
                                    }

                                    void saveAttendance
                                      .mutateAsync({ studentId: student.studentId, status })
                                      .catch(() => undefined);
                                  }}
                                >
                                  {attendanceLetter(status)}
                                </Button>
                              ))}
                            </span>
                          ) : (
                            <span className="text-slate-400">не отмечено</span>
                          )
                        ) : (
                          <span className="flex flex-wrap items-center gap-2">
                            {/*
                              В журнале видно только букву: полное название и причина —
                              во всплывающей подсказке. У отсутствия с уважительной
                              причиной подсказка говорит «Не был, уважительно · причина»:
                              «У» — это не отдельное состояние, а та же неявка.
                            */}
                            <span
                              title={attendanceDescription(
                                student.attendance.status as AttendanceStatusDto,
                                student.attendance.isExcused,
                                student.attendance.reason,
                              )}
                            >
                              <Badge
                                tone={
                                  student.attendance.status === 'present'
                                    ? 'success'
                                    : student.attendance.isExcused
                                      ? 'warning'
                                      : 'danger'
                                }
                              >
                                {attendanceLetter(
                                  student.attendance.status as AttendanceStatusDto,
                                  student.attendance.isExcused,
                                )}
                              </Badge>
                            </span>
                            {canAttend && !cancelled && (
                              <span className="flex flex-wrap gap-1">
                                {ATTENDANCE_CHOICES.map((status) => (
                                  <Button
                                    key={status}
                                    tone="ghost"
                                    type="button"
                                    title={`Изменить на «${ATTENDANCE_LABELS[status]}»`}
                                    disabled={saveAttendance.isPending}
                                    onClick={() => {
                                      if (status === 'not_present') {
                                        openAbsence(student.studentId);
                                        return;
                                      }

                                      void saveAttendance
                                        .mutateAsync({ studentId: student.studentId, status })
                                        .catch(() => undefined);
                                    }}
                                  >
                                    {attendanceLetter(status)}
                                  </Button>
                                ))}
                                {/*
                                  Удаление отметки посещаемости скрыто по решению владельца:
                                  один раз поставив посещение, его пока можно только заменить
                                  другой буквой. Функционал (кнопка, окно причины, маршрут API)
                                  оставлен целым — вернуть его значит поменять `canDeleteAttendance`
                                  на `canAttend && !cancelled`.
                                */}
                                {canDeleteAttendance && (
                                  <Button
                                    tone="ghost"
                                    type="button"
                                    title="Удалить отметку посещаемости"
                                    onClick={() => {
                                      setDeletingAttendance(student.attendance?.id ?? null);
                                      setAttendanceDeleteReason('');
                                    }}
                                  >
                                    Удалить
                                  </Button>
                                )}
                                <Button
                                  tone="ghost"
                                  type="button"
                                  title="История правок отметки"
                                  onClick={() =>
                                    setHistoryAttendanceId(
                                      historyAttendanceId === student.attendance?.id
                                        ? null
                                        : (student.attendance?.id ?? null),
                                    )
                                  }
                                >
                                  История
                                </Button>
                              </span>
                            )}

                            {historyAttendanceId !== null &&
                              historyAttendanceId === student.attendance?.id && (
                                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                                  <p className="mb-1 text-sm font-medium text-slate-700">
                                    История отметки
                                  </p>
                                  <RevisionList revisions={attendanceRevisions.data?.items} />
                                </div>
                              )}

                            {deletingAttendance !== null &&
                              deletingAttendance === student.attendance?.id && (
                                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                                  <div className="flex-1">
                                    <Field
                                      label="Причина удаления"
                                      hint="Отметка скроется, но останется в списке удалённого"
                                    >
                                      <TextInput
                                        name="attendanceDeleteReason"
                                        value={attendanceDeleteReason}
                                        onChange={(event) =>
                                          setAttendanceDeleteReason(event.target.value)
                                        }
                                      />
                                    </Field>
                                  </div>
                                  <Button
                                    tone="danger"
                                    type="button"
                                    disabled={
                                      deleteAttendance.isPending ||
                                      attendanceDeleteReason.trim().length < 3
                                    }
                                    onClick={() =>
                                      void deleteAttendance
                                        .mutateAsync({
                                          attendanceId: student.attendance?.id ?? '',
                                          reason: attendanceDeleteReason,
                                        })
                                        .then(() => setDeletingAttendance(null))
                                        .catch(() => undefined)
                                    }
                                  >
                                    Удалить отметку
                                  </Button>
                                  <Button
                                    tone="ghost"
                                    type="button"
                                    onClick={() => setDeletingAttendance(null)}
                                  >
                                    Отмена
                                  </Button>
                                </div>
                              )}
                          </span>
                        )}

                        {absenceFor !== null && absenceFor === student.studentId && (
                          <div className="mt-2 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <div className="text-sm text-slate-700">
                              «Н» — не был. Отметьте уважительную причину, если она есть.
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="isExcused"
                                checked={absenceExcused}
                                onChange={(event) => setAbsenceExcused(event.target.checked)}
                              />
                              У — уважительная
                            </label>
                            {absenceExcused && (
                              <Field label="Причина">
                                <TextInput
                                  name="excuseReason"
                                  value={absenceReason}
                                  onChange={(event) => setAbsenceReason(event.target.value)}
                                />
                              </Field>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                disabled={
                                  saveAttendance.isPending ||
                                  (absenceExcused && absenceReason.trim().length < 3)
                                }
                                onClick={() =>
                                  void saveAttendance
                                    .mutateAsync({
                                      studentId: student.studentId,
                                      status: 'not_present',
                                      isExcused: absenceExcused,
                                      ...(absenceExcused ? { reason: absenceReason } : {}),
                                    })
                                    .then(() => setAbsenceFor(null))
                                    .catch(() => undefined)
                                }
                              >
                                Ок
                              </Button>
                              <Button
                                tone="ghost"
                                type="button"
                                onClick={() => setAbsenceFor(null)}
                              >
                                Отмена
                              </Button>
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2 text-xs text-slate-500">
                        {student.signs.plus} плюсов · {student.signs.dot} точек
                        {student.signs.plusRemaining > 0 && (
                          <span className="block">
                            до оценки: {student.signs.plusRemaining} плюс(ов)
                          </span>
                        )}
                        {student.signs.dotRemaining > 0 && (
                          <span className="block">
                            до оценки: {student.signs.dotRemaining} точ(ек)
                          </span>
                        )}
                      </td>

                      {/*
                      Панель правки — отдельная временная строка под строкой ученика,
                      во всю ширину таблицы: в колонке отметок она была бы зажата, а
                      между отметками и посещаемостью выглядела лишним столбцом.
                    */}
                    </tr>

                    {/*
                      Панель правки — временная строка под всей строкой ученика:
                      во всю ширину таблицы и под всеми колонками. В ячейке отметок
                      она была бы зажата, а между отметками и посещаемостью
                      выглядела бы лишним столбцом.
                    */}
                    {editingGradeId !== null &&
                      student.grades.some((grade) => grade.id === editingGradeId) &&
                      lessonId !== null && (
                        <tr className="border-b border-slate-100">
                          <td colSpan={4} className="px-3 pt-0 pb-3">
                            <EditPanel
                              gradeId={editingGradeId}
                              lessonId={lessonId}
                              reasons={reasonList}
                              revisions={gradeRevisions.data?.items}
                              onClose={() => setEditingGradeId(null)}
                            />
                          </td>
                        </tr>
                      )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {saveGrade.isError && duplicate === null && (
          <Alert tone="error">{errorMessage(saveGrade.error)}</Alert>
        )}
        {saveAttendance.isError && <Alert tone="error">{errorMessage(saveAttendance.error)}</Alert>}
        {reasons.isError && <Alert tone="error">{errorMessage(reasons.error)}</Alert>}
      </Card>

      {/*
        Удалённые отметки: только администратору. Из журнала удалённое исчезает, и
        без этого списка вернуть отметку было бы нечем.
      */}
      {canRestore && deleted.data !== undefined && (
        <Card
          title="Удалённые отметки"
          description="Отметки не стёрты: их можно вернуть. Видно, кто и почему удалил."
        >
          {deleted.data.grades.length === 0 && deleted.data.attendance.length === 0 ? (
            <EmptyState>Удалённых отметок нет.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {deleted.data.grades.map((grade) => (
                <li key={grade.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{grade.mark}</span>
                  <span className="text-slate-500">{grade.studentName}</span>
                  {grade.categoryTitle !== null && (
                    <span className="text-xs text-slate-500">{grade.categoryTitle}</span>
                  )}
                  <span className="text-xs text-slate-400">
                    {grade.deletedByName ?? 'система'} · {grade.deletedReason ?? 'без причины'}
                  </span>
                  <Button
                    tone="secondary"
                    type="button"
                    disabled={restoreMark.isPending}
                    onClick={() =>
                      void restoreMark
                        .mutateAsync({ kind: 'grade', id: grade.id })
                        .catch(() => undefined)
                    }
                  >
                    Восстановить
                  </Button>
                </li>
              ))}

              {deleted.data.attendance.map((mark) => (
                <li key={mark.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {attendanceLetter(mark.status as AttendanceStatusDto, mark.isExcused)}
                  </span>
                  <span className="text-slate-500">{mark.studentName}</span>
                  <span className="text-xs text-slate-400">
                    {mark.deletedByName ?? 'система'} · {mark.deletedReason ?? 'без причины'}
                  </span>
                  <Button
                    tone="secondary"
                    type="button"
                    disabled={restoreMark.isPending}
                    onClick={() =>
                      void restoreMark
                        .mutateAsync({ kind: 'attendance', id: mark.id })
                        .catch(() => undefined)
                    }
                  >
                    Восстановить
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {restoreMark.isError && <Alert tone="error">{errorMessage(restoreMark.error)}</Alert>}
        </Card>
      )}
    </div>
  );
}
