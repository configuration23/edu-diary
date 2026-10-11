import type { LessonDto, SessionResponseDto } from '@edu-diary/contracts';
import { useState } from 'react';

import { useAcademicContext } from '../components/AcademicContext';
import { Alert, Badge, Button, Card, EmptyState, Field, Table, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api-client';
import {
  useCreateSubstitution,
  useDeleteLesson,
  useGenerateLessons,
  useLessons,
  useRestoreLesson,
  useScheduleGroups,
  useTeachers,
  useUpdateLesson,
} from '../lib/queries';

/**
 * Уроки: занятия по датам, порождённые из шаблона расписания.
 *
 * Здесь же оформляются отклонения от шаблона: отмена конкретного урока, правка
 * темы и замена преподавателя с причиной. Генерация идемпотентна: повторный
 * запуск за период не создаёт дублей и не трогает уроки, правленные вручную.
 */

const STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  planned: { label: 'По плану', tone: 'neutral' },
  done: { label: 'Проведён', tone: 'success' },
  cancelled: { label: 'Отменён', tone: 'danger' },
  replaced: { label: 'Замена', tone: 'warning' },
};

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

/** Сдвиг даты на дни от сегодняшнего дня. */
function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function canManageAll(session: SessionResponseDto, permission: string): boolean {
  return session.permissions.some(
    (grant) => grant.permission === permission && grant.scope === 'all',
  );
}

/** Правка темы урока и замена преподавателя. */
function LessonEditor({ lesson, canReplace }: { lesson: LessonDto; canReplace: boolean }) {
  const update = useUpdateLesson();
  const teachers = useTeachers();
  const createSubstitution = useCreateSubstitution();

  const [topic, setTopic] = useState(lesson.topic ?? '');
  const [substituteUserId, setSubstituteUserId] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 pt-3">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await update.mutateAsync({ id: lesson.id, topic: topic === '' ? null : topic });
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <div className="flex-1">
          <Field label="Тема занятия">
            <TextInput
              name="topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Например: Введение в язык"
            />
          </Field>
        </div>
        <Button type="submit" disabled={update.isPending}>
          Сохранить тему
        </Button>
      </form>

      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}

      {canReplace && (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await createSubstitution.mutateAsync({
                lessonId: lesson.id,
                substituteUserId,
                startsOn: lesson.lessonDate,
                endsOn: lesson.lessonDate,
                reason,
              });
              setSubstituteUserId('');
              setReason('');
            } catch {
              // Ошибка показывается ниже.
            }
          }}
        >
          <div className="flex-1">
            <Field label="Замена: кто ведёт" hint="Причина обязательна">
              <select
                required
                name="substituteUserId"
                className={selectClass}
                value={substituteUserId}
                onChange={(event) => setSubstituteUserId(event.target.value)}
              >
                <option value="">Выберите преподавателя</option>
                {(teachers.data?.items ?? [])
                  .filter((teacher) => teacher.roles.some((role) => role.code === 'teacher'))
                  .filter((teacher) => teacher.id !== lesson.teacherUserId)
                  .map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.fullName}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Причина">
              <TextInput
                required
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Болезнь, обучение, сессия"
              />
            </Field>
          </div>
          <Button
            type="submit"
            disabled={createSubstitution.isPending || substituteUserId === '' || reason === ''}
          >
            Оформить замену
          </Button>
        </form>
      )}

      {createSubstitution.isError && (
        <Alert tone="error">{errorMessage(createSubstitution.error)}</Alert>
      )}
    </div>
  );
}

/**
 * Выбор группы для уроков.
 *
 * Группа выбирается в блоке «Создать уроки» (или в списке, если генерации нет по
 * правам): два разных «Группа» на одной странице путают.
 */
function GroupField({
  groups,
  selectedGroupId,
  selectGroup,
}: {
  groups: Array<{ id: string; name: string }>;
  selectedGroupId: string | null;
  selectGroup: (id: string | null) => void;
}) {
  return (
    <Field label="Группа" hint="«Все доступные» — уроки по всем группам">
      <select
        name="studyGroupId"
        className={`${selectClass} max-w-sm`}
        value={selectedGroupId ?? ''}
        onChange={(event) => selectGroup(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">Все доступные группы</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Генерация уроков за период: только администратор. */
function GenerateForm({
  groupId,
  groups,
  selectedGroupId,
  selectGroup,
}: {
  groupId: string | null;
  groups: Array<{ id: string; name: string }>;
  selectedGroupId: string | null;
  selectGroup: (id: string | null) => void;
}) {
  const generate = useGenerateLessons();
  const [from, setFrom] = useState(shiftDays(1));
  const [to, setTo] = useState(shiftDays(28));
  const [result, setResult] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (groupId === null) return;
        setResult(null);
        try {
          const response = await generate.mutateAsync({ studyGroupId: groupId, from, to });
          setResult(
            `Создано уроков: ${response.created}, обновлено: ${response.updated}, ` +
              `пропущено (правки вручную): ${response.skippedManual}.`,
          );
        } catch {
          // Ошибка показывается ниже.
        }
      }}
    >
      <GroupField groups={groups} selectedGroupId={selectedGroupId} selectGroup={selectGroup} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="С даты">
          <TextInput
            required
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field label="По дату">
          <TextInput
            required
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
      </div>

      <div>
        <Button type="submit" disabled={generate.isPending || groupId === null}>
          Создать уроки за период
        </Button>
      </div>

      {result !== null && <Alert tone="success">{result}</Alert>}
      {generate.isError && <Alert tone="error">{errorMessage(generate.error)}</Alert>}
    </form>
  );
}

export function LessonsScreen({ session }: { session: SessionResponseDto }) {
  const {
    groups: contextGroups,
    selectedGroupId,
    selectGroup,
    activeYearTitle,
  } = useAcademicContext();
  const ownGroups = useScheduleGroups();

  /**
   * Список групп для выбора. У ролей без права на справочник групп контекст
   * пуст, поэтому берём свои группы у расписания — иначе выбрать расписание
   * нечего (ученик и родитель).
   */
  const groups =
    contextGroups.length > 0
      ? contextGroups
      : (ownGroups.data?.items ?? []).map((group) => ({ id: group.id, name: group.name }));
  const lessons = useLessons({
    ...(selectedGroupId === null ? {} : { studyGroupId: selectedGroupId }),
    from: shiftDays(-14),
    to: shiftDays(28),
  });
  const remove = useDeleteLesson();
  const restore = useRestoreLesson();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const canReplace = canManageAll(session, 'substitutions:write');
  const canEditTopic = session.permissions.some((grant) => grant.permission === 'lessons:write');
  const canRemove = canManageAll(session, 'lessons:write');
  const canGenerate = canManageAll(session, 'schedule:write');

  const allItems = lessons.data?.items ?? [];
  /**
   * Отменённые уроки по умолчанию скрыты: их накапливается много, и они мешают
   * читать расписание. Переключатель возвращает их в список — вместе с кнопкой
   * восстановления, потому что отмена не должна быть дорогой в одну сторону.
   */
  const items = showCancelled
    ? allItems
    : allItems.filter((lesson) => lesson.status !== 'cancelled');
  const cancelledCount = allItems.filter((lesson) => lesson.status === 'cancelled').length;

  return (
    <div className="flex flex-col gap-6">
      {canGenerate && (
        <Card
          title="Создать уроки"
          description="Повторный запуск за тот же период ничего не дублирует и не перезаписывает правки. Группа выбирается здесь — список ниже показывает её уроки."
        >
          <GenerateForm
            groupId={selectedGroupId}
            groups={groups}
            selectedGroupId={selectedGroupId}
            selectGroup={selectGroup}
          />
        </Card>
      )}

      <Card
        title="Уроки"
        description={`Занятия по датам${activeYearTitle === null ? '' : ` · ${activeYearTitle}`}. Показаны две недели назад и четыре вперёд.`}
      >
        {!canGenerate && (
          <GroupField groups={groups} selectedGroupId={selectedGroupId} selectGroup={selectGroup} />
        )}

        <div className="mt-3 text-sm text-slate-600">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(event) => setShowCancelled(event.target.checked)}
            />
            Показать отменённые ({cancelledCount})
          </label>
        </div>

        {lessons.isError && <Alert tone="error">{errorMessage(lessons.error)}</Alert>}

        {items.length === 0 && !lessons.isLoading && (
          <div className="mt-4">
            <EmptyState>
              {selectedGroupId === null
                ? 'Выберите группу, чтобы увидеть её уроки, или создайте уроки для всех групп.'
                : cancelledCount > 0 && !showCancelled
                  ? 'За этот период есть только отменённые занятия — включите их показ выше.'
                  : 'Уроков за этот период нет. Их можно создать из расписания группы.'}
            </EmptyState>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-4">
            <Table
              head={['Дата', 'Пара', 'Время', 'Предмет и группа', 'Преподаватель', 'Тема', '']}
            >
              {items.map((lesson) => {
                const status = STATUS[lesson.status] ?? {
                  label: lesson.status,
                  tone: 'neutral' as const,
                };

                return (
                  <tr key={lesson.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2 whitespace-nowrap">{lesson.lessonDate}</td>
                    <td className="px-3 py-2">{lesson.pairNumber}-я</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {lesson.timeStart}–{lesson.timeEnd}
                    </td>
                    <td className="px-3 py-2">
                      {lesson.subjectName}
                      <div className="text-xs text-slate-500">{lesson.groupName}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {lesson.isManual && <Badge tone="warning">Правка вручную</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {lesson.teacherName}
                      {lesson.plannedTeacherName !== null && (
                        <div className="text-xs text-slate-500">
                          вместо: {lesson.plannedTeacherName}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {lesson.topic ?? <span className="text-slate-400">не задана</span>}
                      {editingId === lesson.id && (
                        <LessonEditor lesson={lesson} canReplace={canReplace} />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingId !== lesson.id && (
                        <span className="flex flex-wrap gap-2">
                          {canEditTopic && lesson.status !== 'cancelled' && (
                            <Button tone="ghost" onClick={() => setEditingId(lesson.id)}>
                              Править
                            </Button>
                          )}
                          {canRemove && lesson.status !== 'cancelled' && (
                            <Button
                              tone="ghost"
                              disabled={remove.isPending}
                              onClick={() =>
                                void remove.mutateAsync(lesson.id).catch(() => undefined)
                              }
                            >
                              Отменить занятие
                            </Button>
                          )}
                          {canRemove && lesson.status === 'cancelled' && (
                            <Button
                              tone="ghost"
                              disabled={restore.isPending}
                              onClick={() =>
                                void restore.mutateAsync(lesson).catch(() => undefined)
                              }
                            >
                              Восстановить
                            </Button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
        )}

        {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
        {restore.isError && <Alert tone="error">{errorMessage(restore.error)}</Alert>}
      </Card>
    </div>
  );
}
