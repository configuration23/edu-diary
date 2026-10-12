import type { LessonDto, SessionResponseDto } from '@edu-diary/contracts';
import { subjectCode } from '@edu-diary/domain';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { useAcademicContext } from '../components/AcademicContext';
import { Alert, Badge, Button, Card, EmptyState, Field, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api-client';
import {
  useDeleteLesson,
  useGenerateLessons,
  useLessons,
  useRestoreLesson,
  useScheduleGroups,
  useSubstitutions,
  useUpdateLesson,
} from '../lib/queries';

/**
 * Уроки: рабочий инструмент администратора и преподавателя.
 *
 * Период показываем сеткой («пары × дни»), а не длинным списком: так видно
 * загрузку группы и свободные пары. Плитка компактная (код предмета и цвет),
 * подробности и действия — в панели деталей, поэтому править в ячейке не нужно.
 *
 * Ученику и родителю этот раздел не нужен: у них есть «Расписание».
 */

const PAIRS = [1, 2, 3, 4, 5, 6, 7, 8];
const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Палитра плиток: цвет закрепляется за предметом, а не за позицией в списке. */
const PALETTE = [
  'bg-sky-100 text-sky-900 border-sky-200',
  'bg-emerald-100 text-emerald-900 border-emerald-200',
  'bg-amber-100 text-amber-900 border-amber-200',
  'bg-violet-100 text-violet-900 border-violet-200',
  'bg-rose-100 text-rose-900 border-rose-200',
  'bg-teal-100 text-teal-900 border-teal-200',
];

const STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  planned: { label: 'По плану', tone: 'neutral' },
  done: { label: 'Проведён', tone: 'success' },
  cancelled: { label: 'Отменён', tone: 'danger' },
  replaced: { label: 'Замена', tone: 'warning' },
};

const STATUS_TILE: Record<string, string> = {
  cancelled: 'bg-slate-100 text-slate-400 border-slate-200 line-through',
  replaced: 'bg-amber-100 text-amber-900 border-amber-300',
};

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

function toIso(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function todayIso(): string {
  return toIso(new Date());
}

function shiftIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

/** Понедельник недели, в которую попадает дата. */
function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  return shiftIso(iso, 1 - weekday);
}

function dayIndex(iso: string): number {
  const date = new Date(`${iso}T00:00:00`);
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

/** Устойчивый цвет плитки: один предмет — один цвет. */
function colorOf(subjectId: string): string {
  let hash = 0;
  for (const char of subjectId) hash = (hash + char.charCodeAt(0)) % PALETTE.length;
  return PALETTE[hash] ?? PALETTE[0]!;
}

/** Действия и подробности одного урока: заменяет правку прямо в ячейке. */
function LessonDetails({
  lesson,
  reasons,
  onClose,
  canEditTopic,
  canManage,
}: {
  lesson: LessonDto;
  reasons: string[];
  onClose: () => void;
  canEditTopic: boolean;
  canManage: boolean;
}) {
  const update = useUpdateLesson();
  const remove = useDeleteLesson();
  const restore = useRestoreLesson();
  const navigate = useNavigate();
  const [topic, setTopic] = useState(lesson.topic ?? '');

  const status = STATUS[lesson.status] ?? { label: lesson.status, tone: 'neutral' as const };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {lesson.lessonDate}, {lesson.pairNumber}-я пара, {lesson.timeStart}–{lesson.timeEnd}
          </span>
          <Badge tone={status.tone}>{status.label}</Badge>
          {lesson.isManual && <Badge tone="warning">Правка вручную</Badge>}
        </div>
        <Button tone="ghost" type="button" onClick={onClose}>
          Закрыть
        </Button>
      </div>

      <div className="text-sm text-slate-700">
        {lesson.subjectName} · {lesson.groupName}
      </div>
      <div className="text-sm text-slate-600">
        {lesson.teacherName}
        {lesson.plannedTeacherName !== null && (
          <span className="text-amber-800"> · вместо: {lesson.plannedTeacherName}</span>
        )}
        {` · ${lesson.roomName ?? 'аудитория не указана'}`}
      </div>

      {reasons.length > 0 && (
        <div className="text-sm text-amber-800">Замены: {reasons.join('; ')}</div>
      )}

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
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
              disabled={!canEditTopic || lesson.status === 'cancelled'}
            />
          </Field>
        </div>
        {canEditTopic && lesson.status !== 'cancelled' && (
          <Button type="submit" disabled={update.isPending}>
            Сохранить тему
          </Button>
        )}
      </form>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {lesson.status !== 'cancelled' && (
            <Button
              tone="ghost"
              type="button"
              onClick={() =>
                void navigate({ to: '/substitutions', search: { lessonId: lesson.id } })
              }
            >
              Заменить
            </Button>
          )}

          {lesson.status !== 'cancelled' && (
            <Button
              tone="ghost"
              type="button"
              disabled={remove.isPending}
              onClick={() =>
                void remove
                  .mutateAsync(lesson.id)
                  .then(() => onClose())
                  .catch(() => undefined)
              }
            >
              Отменить занятие
            </Button>
          )}

          {lesson.status === 'cancelled' && (
            <Button
              tone="ghost"
              type="button"
              disabled={restore.isPending}
              onClick={() =>
                void restore
                  .mutateAsync(lesson)
                  .then(() => onClose())
                  .catch(() => undefined)
              }
            >
              Восстановить
            </Button>
          )}

          {reasons.length > 0 && (
            <Button
              tone="ghost"
              type="button"
              onClick={() =>
                void navigate({ to: '/substitutions', search: { lessonId: undefined } })
              }
            >
              Открыть журнал замен
            </Button>
          )}
        </div>
      )}

      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
      {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
      {restore.isError && <Alert tone="error">{errorMessage(restore.error)}</Alert>}
    </div>
  );
}

/** Группа, период и генерация уроков: то, с чего начинается работа на экране. */
function PeriodForm({
  groupId,
  groups,
  selectedGroupId,
  selectGroup,
  canGenerate,
}: {
  groupId: string | null;
  groups: Array<{ id: string; name: string }>;
  selectedGroupId: string | null;
  selectGroup: (id: string | null) => void;
  canGenerate: boolean;
}) {
  const generate = useGenerateLessons();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(shiftIso(todayIso(), 7));
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Группа" hint="Сетка уроков строится по одной группе">
        <select
          name="studyGroupId"
          className={selectClass}
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

      {canGenerate && (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            if (groupId === null) return;
            setResult(null);
            try {
              const response = await generate.mutateAsync({ studyGroupId: groupId, from, to });
              setResult(
                `Создано за ${from} — ${to}: уроков ${response.created}, обновлено ${response.updated}, ` +
                  `пропущено правок вручную ${response.skippedManual}. Смотрите сетку ниже.`,
              );
            } catch {
              // Ошибка показывается ниже.
            }
          }}
        >
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
          <Button type="submit" disabled={generate.isPending || groupId === null}>
            Создать уроки за период
          </Button>
        </form>
      )}

      {result !== null && <Alert tone="success">{result}</Alert>}
      {generate.isError && <Alert tone="error">{errorMessage(generate.error)}</Alert>}
    </div>
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

  const groups =
    contextGroups.length > 0
      ? contextGroups
      : (ownGroups.data?.items ?? []).map((group) => ({ id: group.id, name: group.name }));

  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [anchor, setAnchor] = useState(todayIso());
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);

  /** Окно запроса: неделя — 7 дней с понедельника, месяц — календарный месяц. */
  const rangeStart = period === 'week' ? mondayOf(anchor) : `${anchor.slice(0, 7)}-01`;
  const rangeEnd =
    period === 'week'
      ? shiftIso(rangeStart, 6)
      : toIso(new Date(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)), 0));

  const lessons = useLessons({
    ...(selectedGroupId === null ? {} : { studyGroupId: selectedGroupId }),
    from: rangeStart,
    to: rangeEnd,
  });
  const substitutions = useSubstitutions();

  const canManage = session.permissions.some(
    (grant) => grant.permission === 'lessons:write' && grant.scope === 'all',
  );
  const canEditTopic = session.permissions.some((grant) => grant.permission === 'lessons:write');
  const canGenerate = session.permissions.some(
    (grant) => grant.permission === 'schedule:write' && grant.scope === 'all',
  );

  const items = lessons.data?.items ?? [];
  const visible = items.filter((lesson) => showCancelled || lesson.status !== 'cancelled');
  const selectedLesson = items.find((lesson) => lesson.id === selectedLessonId) ?? null;

  const reasonsFor = (lessonId: string): string[] =>
    (substitutions.data?.items ?? [])
      .filter((item) => item.lessonId === lessonId)
      .map((item) => item.reason);

  const daysInRange: string[] = [];
  for (let iso = rangeStart; iso <= rangeEnd; iso = shiftIso(iso, 1)) daysInRange.push(iso);

  const weeks: string[][] = [];
  for (let index = 0; index < daysInRange.length; index += 7) {
    weeks.push(daysInRange.slice(index, index + 7));
  }

  const cancelledCount = items.filter((lesson) => lesson.status === 'cancelled').length;

  const tile = (lesson: LessonDto) => (
    <button
      key={lesson.id}
      type="button"
      onClick={() => setSelectedLessonId(lesson.id)}
      title={`${lesson.subjectName} · ${lesson.teacherName} · ${lesson.roomName ?? 'без аудитории'}`}
      className={`w-full rounded border px-1 py-0.5 text-left text-[11px] leading-tight ${
        STATUS_TILE[lesson.status] ?? colorOf(lesson.subjectId)
      }`}
    >
      <span className="font-medium">
        {subjectCode(lesson.subjectName, lesson.subjectShortName)}
      </span>
      {selectedGroupId === null && <span className="block truncate">{lesson.groupName}</span>}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Уроки"
        description={`Занятия по датам${activeYearTitle === null ? '' : ` · ${activeYearTitle}`}. Сетка показывает загрузку группы, список — быстрый поиск.`}
      >
        <PeriodForm
          groupId={selectedGroupId}
          groups={groups}
          selectedGroupId={selectedGroupId}
          selectGroup={selectGroup}
          canGenerate={canGenerate}
        />

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Период">
            <span className="flex gap-2">
              <Button
                tone={period === 'week' ? 'primary' : 'secondary'}
                type="button"
                id="period-week"
                onClick={() => setPeriod('week')}
              >
                Неделя
              </Button>
              <Button
                tone={period === 'month' ? 'primary' : 'secondary'}
                type="button"
                id="period-month"
                onClick={() => setPeriod('month')}
              >
                Месяц
              </Button>
            </span>
          </Field>

          <Field label="Вид">
            <span className="flex gap-2">
              <Button
                tone={view === 'grid' ? 'primary' : 'secondary'}
                type="button"
                id="view-grid"
                onClick={() => setView('grid')}
              >
                Сетка
              </Button>
              <Button
                tone={view === 'list' ? 'primary' : 'secondary'}
                type="button"
                id="view-list"
                onClick={() => setView('list')}
              >
                Список
              </Button>
            </span>
          </Field>

          <Field label="Отсчёт">
            <span className="flex items-center gap-2">
              <Button
                tone="ghost"
                type="button"
                onClick={() => setAnchor(shiftIso(anchor, period === 'week' ? -7 : -30))}
              >
                ←
              </Button>
              <input
                type="date"
                name="anchor"
                className={selectClass}
                value={anchor}
                onChange={(event) =>
                  setAnchor(event.target.value === '' ? todayIso() : event.target.value)
                }
              />
              <Button
                tone="ghost"
                type="button"
                onClick={() => setAnchor(shiftIso(anchor, period === 'week' ? 7 : 30))}
              >
                →
              </Button>
              <Button tone="secondary" type="button" onClick={() => setAnchor(todayIso())}>
                Сегодня
              </Button>
            </span>
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
          <span>
            {rangeStart} — {rangeEnd}
          </span>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(event) => setShowCancelled(event.target.checked)}
            />
            Показывать отменённые ({cancelledCount})
          </label>
        </div>

        {lessons.isError && <Alert tone="error">{errorMessage(lessons.error)}</Alert>}

        {selectedLesson !== null && (
          <div className="mt-4">
            <LessonDetails
              lesson={selectedLesson}
              reasons={reasonsFor(selectedLesson.id)}
              onClose={() => setSelectedLessonId(null)}
              canEditTopic={canEditTopic}
              canManage={canManage}
            />
          </div>
        )}

        {items.length === 0 && !lessons.isLoading && (
          <div className="mt-4">
            <EmptyState>
              {selectedGroupId === null
                ? 'Выберите группу: сетка строится по одной группе.'
                : 'За этот период уроков нет. Их можно создать выше.'}
            </EmptyState>
          </div>
        )}

        {view === 'grid' && items.length > 0 && (
          <div className="mt-4 flex flex-col gap-4">
            {weeks.map((week) => (
              <div key={week[0]} className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="w-14 px-1 py-1 text-left text-xs text-slate-500">Пара</th>
                      {week.map((iso) => (
                        <th
                          key={iso}
                          className={`px-1 py-1 text-left text-xs ${
                            iso === todayIso() ? 'text-sky-700' : 'text-slate-500'
                          }`}
                        >
                          {iso.slice(8)} {DAYS_SHORT[dayIndex(iso)]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PAIRS.map((pair) => (
                      <tr key={pair} className="border-t border-slate-100">
                        <td className="px-1 py-1 align-top text-xs font-medium text-slate-500">
                          {pair}
                        </td>
                        {week.map((iso) => {
                          const cell = visible.filter(
                            (lesson) => lesson.lessonDate === iso && lesson.pairNumber === pair,
                          );

                          return (
                            <td key={iso} className="px-0.5 py-1 align-top">
                              {cell.length === 0 ? (
                                <span className="text-[11px] text-slate-300">·</span>
                              ) : (
                                <span className="flex flex-col gap-0.5">
                                  {cell.slice(0, 2).map((lesson) => tile(lesson))}
                                  {cell.length > 2 && (
                                    <span className="text-[11px] text-slate-500">
                                      и ещё {cell.length - 2}
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {view === 'list' && visible.length > 0 && (
          <ul className="mt-4 flex flex-col divide-y divide-slate-100">
            {visible.map((lesson) => (
              <li key={lesson.id}>
                <button
                  type="button"
                  onClick={() => setSelectedLessonId(lesson.id)}
                  className="flex w-full flex-wrap items-center gap-2 px-2 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="w-24 text-slate-500">{lesson.lessonDate}</span>
                  <span className="w-14 text-slate-500">{lesson.pairNumber}-я</span>
                  <span className="font-medium">{lesson.subjectName}</span>
                  <span className="text-slate-500">{lesson.groupName}</span>
                  <span className="text-slate-500">{lesson.teacherName}</span>
                  <Badge tone={(STATUS[lesson.status] ?? { tone: 'neutral' as const }).tone}>
                    {(STATUS[lesson.status] ?? { label: lesson.status }).label}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
