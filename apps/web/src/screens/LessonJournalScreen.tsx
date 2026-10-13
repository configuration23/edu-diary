import {
  ATTENDANCE_LABELS,
  ATTENDANCE_SHORT,
  type AttendanceStatusDto,
  type SessionResponseDto,
} from '@edu-diary/contracts';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';

import { useAppearanceSettings } from '../components/AppearanceContext';
import { Alert, Badge, Button, Card, EmptyState, Field, TextInput } from '../components/ui';
import { SubjectDot } from '../lib/appearance';
import { errorMessage } from '../lib/api-client';
import {
  useDeleteJournalGrade,
  useGradeRevisions,
  useLessonJournal,
  useMarkAllPresent,
  useSaveAttendance,
  useSaveGrade,
  useUpdateJournalGrade,
} from '../lib/journal-queries';

/**
 * Журнал урока: оценки и посещаемость (Этап 4, шаг 1).
 *
 * Экран рассчитан на работу **на уроке**: преподаватель открывает занятие, отмечает
 * посещаемость и ставит оценки. Поэтому оценка ставится одним нажатием по кнопке —
 * выбор ученика, выбор оценки и сохранение не разводятся по шагам: это и есть
 * требование «не более трёх действий».
 *
 * Отметки ссылаются на урок (ADR-006), поэтому замена, отмена и перенос видны
 * здесь же; на отменённом уроке отметки не ставятся, и сервер это тоже проверяет.
 */

const VALUES = ['5', '4', '3', '2'] as const;
const SIGNS: { sign: 'plus' | 'dot'; label: string; hint: string }[] = [
  { sign: 'plus', label: '+', hint: 'Плюс: накапливается и по правилу даёт оценку' },
  { sign: 'dot', label: '·', hint: 'Точка: накапливается и по правилу даёт оценку' },
];

const ATTENDANCE_ORDER = ['present', 'late', 'excused', 'sick', 'absent'] as const;

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

/** Что именно правим у ученика: оценку или посещаемость. */
function EditPanel({
  gradeId,
  lessonId,
  onClose,
}: {
  gradeId: string;
  lessonId: string;
  onClose: () => void;
}) {
  const update = useUpdateJournalGrade(lessonId);
  const remove = useDeleteJournalGrade(lessonId);
  const revisions = useGradeRevisions(gradeId);

  const [value, setValue] = useState('');
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
        <div className="flex-1">
          <Field label="Причина правки" hint="Без причины история правок бесполезна">
            <TextInput
              name="gradeReason"
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
                reason,
              })
              .then(() => {
                setReason('');
                setValue('');
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
        {revisions.data === undefined || revisions.data.items.length === 0 ? (
          <p className="text-sm text-slate-500">Правок не было.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-slate-600">
            {revisions.data.items.map((item) => (
              <li key={item.id}>
                {item.actorName ?? 'система'}: {item.before ?? '—'} → {item.after ?? '—'}
                {item.reason === null ? '' : ` · ${item.reason}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function LessonJournalScreen({ session }: { session: SessionResponseDto }) {
  const params = useParams({ strict: false }) as { lessonId?: string };
  const lessonId = params.lessonId ?? null;
  const navigate = useNavigate();

  const journal = useLessonJournal(lessonId);
  const appearance = useAppearanceSettings();
  const saveGrade = useSaveGrade(lessonId ?? '');
  const saveAttendance = useSaveAttendance(lessonId ?? '');
  const markAll = useMarkAllPresent(lessonId ?? '');

  /** Кого правим: идентификатор оценки в раскрытой панели. */
  const [editingGradeId, setEditingGradeId] = useState<string | null>(null);
  /** Для кого вводим причину отсутствия. */
  const [reasonFor, setReasonFor] = useState<{ studentId: string; status: string } | null>(null);
  const [reason, setReason] = useState('');

  const canWrite = session.permissions.some((grant) => grant.permission === 'grades:write');
  const canAttend = session.permissions.some((grant) => grant.permission === 'attendance:write');

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

  const { lesson, students, rules } = journal.data;
  const cancelled = lesson.status === 'cancelled';

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

        {rules.length > 0 && (
          <p className="mt-2 text-sm text-slate-500">
            Правило накопления знаков:{' '}
            {rules
              .map(
                (rule) =>
                  `${rule.threshold} ${rule.sign === 'plus' ? 'плюсов' : 'точек'} → ${rule.reward}`,
              )
              .join('; ')}
          </p>
        )}

        {cancelled && (
          <div className="mt-3">
            <Alert tone="warning">
              Урок отменён: отметки по нему не ставятся. Если занятие всё же состоялось, верните его
              в план в разделе «Уроки».
            </Alert>
          </div>
        )}

        {canAttend && !cancelled && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              tone="secondary"
              type="button"
              disabled={markAll.isPending}
              onClick={() => void markAll.mutateAsync({}).catch(() => undefined)}
            >
              Отметить всех присутствующими
            </Button>
            {markAll.isSuccess && (
              <span className="self-center text-sm text-slate-600">
                Отмечено: {markAll.data.marked}
              </span>
            )}
            {markAll.isError && <Alert tone="error">{errorMessage(markAll.error)}</Alert>}
          </div>
        )}
      </Card>

      <Card
        title="Ученики"
        description={
          canWrite
            ? 'Оценка ставится одним нажатием. «+» и «·» накапливаются и по правилу превращаются в оценку.'
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
                  <th className="px-3 py-2 font-medium">Оценка</th>
                  <th className="px-3 py-2 font-medium">Посещаемость</th>
                  <th className="px-3 py-2 font-medium">Знаки</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.studentId} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2 font-medium">
                      {student.fullName}
                      {editingGradeId !== null &&
                        student.grade !== null &&
                        editingGradeId === student.grade.id && (
                          <span className="block text-xs text-slate-500">правка отметки</span>
                        )}
                    </td>

                    <td className="px-3 py-2">
                      {student.grade === null ? (
                        canWrite && !cancelled ? (
                          <span className="flex flex-wrap gap-1">
                            {VALUES.map((value) => (
                              <Button
                                key={value}
                                tone="secondary"
                                type="button"
                                disabled={saveGrade.isPending}
                                onClick={() =>
                                  void saveGrade
                                    .mutateAsync({ studentId: student.studentId, value })
                                    .catch(() => undefined)
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
                                  void saveGrade
                                    .mutateAsync({ studentId: student.studentId, sign: item.sign })
                                    .catch(() => undefined)
                                }
                              >
                                {item.label}
                              </Button>
                            ))}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold">
                            {student.grade.value ?? (student.grade.sign === 'plus' ? '+' : '·')}
                          </span>
                          {student.grade.categoryTitle !== null && (
                            <span className="text-xs text-slate-500">
                              {student.grade.categoryTitle}
                            </span>
                          )}
                          {canWrite && !cancelled && (
                            <Button
                              tone="ghost"
                              type="button"
                              onClick={() =>
                                setEditingGradeId(
                                  editingGradeId === student.grade?.id
                                    ? null
                                    : (student.grade?.id ?? null),
                                )
                              }
                            >
                              Править
                            </Button>
                          )}
                        </span>
                      )}

                      {editingGradeId !== null &&
                        student.grade !== null &&
                        editingGradeId === student.grade.id &&
                        lessonId !== null && (
                          <EditPanel
                            gradeId={student.grade.id}
                            lessonId={lessonId}
                            onClose={() => setEditingGradeId(null)}
                          />
                        )}
                    </td>

                    <td className="px-3 py-2">
                      {student.attendance === null ? (
                        canAttend && !cancelled ? (
                          <span className="flex flex-wrap gap-1">
                            {ATTENDANCE_ORDER.map((status) => (
                              <Button
                                key={status}
                                tone="secondary"
                                type="button"
                                title={ATTENDANCE_LABELS[status]}
                                disabled={saveAttendance.isPending}
                                onClick={() => {
                                  /**
                                   * Для прогула и уважительной причина обязательна:
                                   * сервер отклонит такую отметку, поэтому спрашиваем
                                   * сразу, а не после отказа.
                                   */
                                  if (status === 'absent' || status === 'excused') {
                                    setReasonFor({ studentId: student.studentId, status });
                                    setReason('');
                                    return;
                                  }

                                  void saveAttendance
                                    .mutateAsync({ studentId: student.studentId, status })
                                    .catch(() => undefined);
                                }}
                              >
                                {ATTENDANCE_SHORT[status]}
                              </Button>
                            ))}
                          </span>
                        ) : (
                          <span className="text-slate-400">не отмечено</span>
                        )
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={
                              student.attendance.status === 'present'
                                ? 'success'
                                : student.attendance.status === 'absent'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {ATTENDANCE_LABELS[student.attendance.status]}
                          </Badge>
                          {student.attendance.reason !== null && (
                            <span className="text-xs text-slate-500">
                              {student.attendance.reason}
                            </span>
                          )}
                          {canAttend && !cancelled && (
                            <span className="flex flex-wrap gap-1">
                              {ATTENDANCE_ORDER.filter(
                                (status) => status !== student.attendance?.status,
                              ).map((status) => (
                                <Button
                                  key={status}
                                  tone="ghost"
                                  type="button"
                                  title={`Изменить на «${ATTENDANCE_LABELS[status]}»`}
                                  disabled={saveAttendance.isPending}
                                  onClick={() => {
                                    if (status === 'absent' || status === 'excused') {
                                      setReasonFor({ studentId: student.studentId, status });
                                      setReason('');
                                      return;
                                    }

                                    void saveAttendance
                                      .mutateAsync({ studentId: student.studentId, status })
                                      .catch(() => undefined);
                                  }}
                                >
                                  {ATTENDANCE_SHORT[status]}
                                </Button>
                              ))}
                            </span>
                          )}
                        </span>
                      )}

                      {reasonFor !== null && reasonFor.studentId === student.studentId && (
                        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                          <div className="flex-1">
                            <Field
                              label={`Причина: ${ATTENDANCE_LABELS[reasonFor.status as AttendanceStatusDto]}`}
                            >
                              <TextInput
                                name="attendanceReason"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                              />
                            </Field>
                          </div>
                          <Button
                            type="button"
                            disabled={saveAttendance.isPending || reason.trim().length < 3}
                            onClick={() =>
                              void saveAttendance
                                .mutateAsync({
                                  studentId: student.studentId,
                                  status: reasonFor.status,
                                  reason,
                                })
                                .then(() => {
                                  setReasonFor(null);
                                  setReason('');
                                })
                                .catch(() => undefined)
                            }
                          >
                            Сохранить
                          </Button>
                          <Button tone="ghost" type="button" onClick={() => setReasonFor(null)}>
                            Отмена
                          </Button>
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2 text-xs text-slate-500">
                      {student.signs.plus} плюсов · {student.signs.dot} точек
                      {rules.length > 0 && student.signs.plusRemaining > 0 && (
                        <span className="block">до оценки: {student.signs.plusRemaining}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {saveGrade.isError && <Alert tone="error">{errorMessage(saveGrade.error)}</Alert>}
        {saveAttendance.isError && <Alert tone="error">{errorMessage(saveAttendance.error)}</Alert>}
      </Card>
    </div>
  );
}
