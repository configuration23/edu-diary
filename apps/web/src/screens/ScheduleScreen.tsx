import type { LessonDto, SessionResponseDto } from '@edu-diary/contracts';
import { useState } from 'react';

import { useAcademicContext } from '../components/AcademicContext';
import { Alert, Badge, Button, Card, EmptyState, Field, Table } from '../components/ui';
import { errorMessage } from '../lib/api-client';
import { useLessons, useScheduleGroups } from '../lib/queries';

/**
 * Расписание: итоговые занятия на дату и на неделю.
 *
 * Это то, что видят все роли: ученик и родитель — занятия своих групп,
 * преподаватель — свои, администратор — все. Отдельный экран «Сетка (шаблон)»
 * остаётся конструктором повторяющихся занятий.
 *
 * Данные уже материализованы генерацией: замена, отмена и перенос видны прямо в
 * уроке (`status`, `plannedTeacherName`, `substitutionId`), поэтому дневной вид
 * ничего не собирает заново.
 */

const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAYS_FULL = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];

const PAIRS = [1, 2, 3, 4, 5, 6, 7, 8];

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

/** Локальная дата в формате `ГГГГ-ММ-ДД` (без сдвига часового пояса). */
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

/** Сдвиг даты на дни: даты сравниваются как календарные, а не как моменты времени. */
function shiftIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

function dayIndex(iso: string): number {
  const date = new Date(`${iso}T00:00:00`);
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
}

/** Понедельник недели, в которую попадает дата: лента дней всегда одна и та же. */
function mondayOf(iso: string): string {
  return shiftIso(iso, -dayIndex(iso));
}

function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return `${date.getDate()} ${DAYS_SHORT[dayIndex(iso)]}`;
}

const STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  planned: { label: 'По плану', tone: 'neutral' },
  done: { label: 'Проведён', tone: 'success' },
  cancelled: { label: 'Отменена', tone: 'danger' },
  replaced: { label: 'Замена', tone: 'warning' },
};

/** Карточка занятия: всё, что нужно знать перед парой. */
function LessonCard({ lesson, showGroup }: { lesson: LessonDto; showGroup: boolean }) {
  const status = STATUS[lesson.status] ?? { label: lesson.status, tone: 'neutral' as const };

  return (
    <div
      className={`rounded-md border p-3 ${
        lesson.status === 'cancelled'
          ? 'border-slate-200 bg-slate-50 text-slate-400'
          : lesson.status === 'replaced'
            ? 'border-amber-300 bg-amber-50'
            : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">{lesson.pairNumber}-я пара</span>
        <span className="text-sm text-slate-500">
          {lesson.timeStart}–{lesson.timeEnd}
        </span>
        <Badge tone={status.tone}>{status.label}</Badge>
        {lesson.isManual && <Badge tone="warning">Правка вручную</Badge>}
      </div>

      <div className={`mt-1 font-medium ${lesson.status === 'cancelled' ? 'line-through' : ''}`}>
        {lesson.subjectName}
      </div>

      <div className="mt-1 text-sm text-slate-600">
        {lesson.teacherName}
        {lesson.plannedTeacherName !== null && (
          <span className="text-amber-800">
            {' '}
            · вместо: <span className="line-through">{lesson.plannedTeacherName}</span>
          </span>
        )}
      </div>

      <div className="mt-1 text-xs text-slate-500">
        {showGroup ? `${lesson.groupName} · ` : ''}
        {lesson.roomName ?? 'аудитория не указана'}
        {lesson.topic === null ? '' : ` · тема: ${lesson.topic}`}
      </div>
    </div>
  );
}

export function ScheduleScreen({ session }: { session: SessionResponseDto }) {
  const {
    groups: contextGroups,
    selectedGroupId,
    selectGroup,
    activeYearTitle,
  } = useAcademicContext();
  const ownGroups = useScheduleGroups();

  /**
   * Список групп для выбора. У ролей без права на справочник групп контекст пуст,
   * поэтому свои группы отдаёт расписание (маршрут «мои группы»).
   */
  const groups =
    contextGroups.length > 0
      ? contextGroups
      : (ownGroups.data?.items ?? []).map((group) => ({ id: group.id, name: group.name }));

  const [date, setDate] = useState(todayIso());
  const [view, setView] = useState<'day' | 'week'>('day');
  /**
   * Неделя, которую показываем: отдельно от выбранного дня.
   *
   * Так клик по дню только выделяет его, а лента дней не «уезжает»; листают неделю
   * стрелки и поле даты.
   */
  const [anchor, setAnchor] = useState(todayIso());

  const weekStart = mondayOf(anchor);
  const weekDays = Array.from({ length: 6 }, (_, index) => shiftIso(weekStart, index));

  /** Сдвиг недели: выбранный день недели сохраняем, чтобы контекст не терялся. */
  const shiftWeek = (weeks: number): void => {
    const next = shiftIso(weekStart, weeks * 7);
    setAnchor(next);
    setDate(shiftIso(next, dayIndex(date)));
  };

  const lessons = useLessons({
    ...(selectedGroupId === null ? {} : { studyGroupId: selectedGroupId }),
    from: shiftIso(weekStart, -7),
    to: shiftIso(weekStart, 13),
  });

  void session;

  const items = lessons.data?.items ?? [];
  const dayLessons = items.filter((lesson) => lesson.lessonDate === date);
  const visibleDayLessons = dayLessons.filter((lesson) => lesson.status !== 'cancelled');

  /** Замены по дням: бейдж в дата-стрипе. */
  const hasSubstitutions = (iso: string): boolean =>
    items.some(
      (lesson) =>
        lesson.lessonDate === iso &&
        (lesson.status === 'replaced' || lesson.substitutionId !== null),
    );

  /** «Идёт сейчас»: сравниваем время браузера со временем пары. */
  const now = new Date();
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const runningPair = dayLessons.find(
    (lesson) =>
      lesson.status !== 'cancelled' && lesson.timeStart <= nowTime && nowTime <= lesson.timeEnd,
  );

  const emptyPairs = PAIRS.filter(
    (pair) =>
      !dayLessons.some((lesson) => lesson.pairNumber === pair && lesson.status !== 'cancelled'),
  );

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Расписание"
        description={`Занятия на дату${activeYearTitle === null ? '' : ` · ${activeYearTitle}`}. Замена, отмена и перенос видны в карточке занятия.`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Группа" hint="«Все доступные» — занятия по всем группам">
            <select
              name="studyGroupId"
              className={selectClass}
              value={selectedGroupId ?? ''}
              onChange={(event) =>
                selectGroup(event.target.value === '' ? null : event.target.value)
              }
            >
              <option value="">Все доступные группы</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Вид">
            <span className="flex gap-2">
              <Button
                tone={view === 'day' ? 'primary' : 'secondary'}
                type="button"
                id="view-day"
                onClick={() => setView('day')}
              >
                День
              </Button>
              <Button
                tone={view === 'week' ? 'primary' : 'secondary'}
                type="button"
                id="view-week"
                onClick={() => setView('week')}
              >
                Неделя
              </Button>
            </span>
          </Field>

          <Field label="Дата" hint="Стрелки листают неделю">
            <span className="flex items-center gap-2">
              <Button tone="ghost" type="button" onClick={() => shiftWeek(-1)}>
                ←
              </Button>
              <input
                type="date"
                name="date"
                className={selectClass}
                value={date}
                onChange={(event) => {
                  const next = event.target.value === '' ? todayIso() : event.target.value;
                  setDate(next);
                  setAnchor(next);
                }}
              />
              <Button tone="ghost" type="button" onClick={() => shiftWeek(1)}>
                →
              </Button>
              <Button
                tone="secondary"
                type="button"
                onClick={() => {
                  setDate(todayIso());
                  setAnchor(todayIso());
                }}
              >
                Сегодня
              </Button>
            </span>
          </Field>
        </div>

        {/* Дата-стрип: неделя (понедельник — воскресенье) с бейджем замен. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {weekDays.map((iso) => (
            <button
              key={iso}
              type="button"
              onClick={() => setDate(iso)}
              className={`rounded-md border px-3 py-2 text-sm ${
                iso === date
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              {formatDay(iso)}
              {iso === todayIso() && <span className="ml-1 text-xs">сегодня</span>}
              {hasSubstitutions(iso) && <span className="ml-1 text-xs text-amber-600">•</span>}
            </button>
          ))}
        </div>

        {lessons.isError && <Alert tone="error">{errorMessage(lessons.error)}</Alert>}

        {view === 'day' && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="text-sm text-slate-600">
              {DAYS_FULL[dayIndex(date)]}, {date}
              {runningPair === undefined ? (
                ''
              ) : (
                <span className="ml-2 rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                  идёт сейчас: {runningPair.pairNumber}-я пара
                </span>
              )}
            </div>

            {dayLessons.length === 0 && (
              <EmptyState>
                {selectedGroupId === null
                  ? 'Выберите группу, чтобы увидеть её занятия на день.'
                  : 'На эту дату занятий нет.'}
              </EmptyState>
            )}

            {visibleDayLessons.length > 0 && (
              <div className="flex flex-col gap-2">
                {visibleDayLessons.map((lesson) => (
                  <LessonCard
                    key={lesson.id}
                    lesson={lesson}
                    showGroup={selectedGroupId === null}
                  />
                ))}
              </div>
            )}

            {dayLessons.length > 0 && (
              <div className="text-xs text-slate-500">
                Свободные пары: {emptyPairs.join(', ') || 'нет'}
              </div>
            )}
          </div>
        )}

        {view === 'week' && (
          <div className="mt-4">
            <Table head={['Пара', ...weekDays.map((iso) => formatDay(iso))]}>
              {PAIRS.map((pair) => (
                <tr key={pair} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2 font-medium">{pair}-я</td>
                  {weekDays.map((iso) => {
                    const cell = items.filter(
                      (lesson) =>
                        lesson.lessonDate === iso &&
                        lesson.pairNumber === pair &&
                        lesson.status !== 'cancelled',
                    );

                    return (
                      <td key={iso} className="px-3 py-2">
                        {cell.length === 0 ? (
                          <span className="text-xs text-slate-400">окно</span>
                        ) : (
                          <button
                            type="button"
                            className="flex flex-col gap-1 text-left"
                            onClick={() => {
                              setDate(iso);
                              setView('day');
                            }}
                          >
                            {cell.map((lesson) => (
                              <span
                                key={lesson.id}
                                className={`rounded px-1 text-xs ${
                                  lesson.status === 'replaced'
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'text-slate-700'
                                }`}
                              >
                                {lesson.subjectName}
                                {/* Замена и её причина видны прямо в сетке недели. */}
                                {lesson.status === 'replaced' && (
                                  <span className="ml-1 font-medium">замена</span>
                                )}
                                <span className="block text-slate-500">
                                  {lesson.groupName} · {lesson.roomName ?? '—'}
                                </span>
                              </span>
                            ))}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
