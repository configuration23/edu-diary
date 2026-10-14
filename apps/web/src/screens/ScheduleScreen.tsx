import type { LessonDto, LessonMarksResponseDto, SessionResponseDto } from '@edu-diary/contracts';
import { useState } from 'react';

import { subjectCode } from '@edu-diary/domain';

import { useAcademicContext } from '../components/AcademicContext';
import { useAppearanceSettings } from '../components/AppearanceContext';
import { LessonAttendance, LessonGrades, LessonGradesCount } from '../components/LessonMarks';
import { Alert, Badge, Button, Card, EmptyState, Field, Table } from '../components/ui';
import { SubjectDot, lessonMarker, subjectColor } from '../lib/appearance';
import { errorMessage } from '../lib/api-client';
import { hasBells, pairsFromBells } from '../lib/schedule-pairs';
import { useLessonMarks } from '../lib/journal-queries';
import { useBells, useLessons, useScheduleGroups } from '../lib/queries';

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
function LessonCard({
  lesson,
  showGroup,
  marker,
  colorsEnabled,
  grades,
  attendance,
  learnerView,
}: {
  lesson: LessonDto;
  showGroup: boolean;
  marker: string | null;
  colorsEnabled: boolean;
  grades: LessonMarksResponseDto['grades'];
  attendance: LessonMarksResponseDto['attendance'][number] | undefined;
  /**
   * Ученик и законный представитель: им показываем отметки, а служебные плашки
   * расписания («По плану», «Правка вручную») — нет: это внутренние пометки.
   */
  learnerView: boolean;
}) {
  const status = STATUS[lesson.status] ?? { label: lesson.status, tone: 'neutral' as const };

  return (
    /*
      Большая плашка (вид «День»): цвет предмета показывается **только кружком**
      рядом с названием, заливки нет — большой блок целиком в цвете выглядит
      тяжёлым. Событие (замена, отмена) показывает значок в углу, перенос не
      обозначаем вовсе. Мелкая плитка сетки (вид «Неделя») устроена наоборот: там
      цвет — заливкой и без кружка.
    */
    <div
      className={`relative rounded-md border p-3 ${
        lesson.status === 'cancelled'
          ? 'border-slate-200 bg-slate-50 text-slate-400'
          : 'border-slate-200 bg-white'
      }`}
    >
      {/* Значок события в углу: не мешает основной информации о занятии. */}
      {marker !== null && (
        <span className="absolute top-1 right-2 text-base leading-none" title="Событие занятия">
          {marker}
        </span>
      )}

      {/* Оценки за занятие — в правом верхнем углу, как в журнале урока. */}
      {learnerView && (
        <span className="absolute top-2 right-2">
          <LessonGrades grades={grades} />
        </span>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">{lesson.pairNumber}-я пара</span>
        <span className="text-sm text-slate-500">
          {lesson.timeStart}–{lesson.timeEnd}
        </span>
        {!learnerView && <Badge tone={status.tone}>{status.label}</Badge>}
        {!learnerView && lesson.isManual && <Badge tone="warning">Правка вручную</Badge>}
      </div>

      <div className={`mt-1 font-medium ${lesson.status === 'cancelled' ? 'line-through' : ''}`}>
        {colorsEnabled ? (
          <SubjectDot subjectId={lesson.subjectId} color={lesson.subjectColor} />
        ) : null}
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

      {/* Отметка посещаемости — в правом нижнем углу, буквой журнала. */}
      {learnerView && (
        <span className="absolute right-2 bottom-2">
          <LessonAttendance mark={attendance} />
        </span>
      )}
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

  const appearance = useAppearanceSettings();
  const bells = useBells();

  // Строки сетки — только заведённые пары: незачем показывать восемь, если их четыре.
  const pairs = pairsFromBells(bells.data?.items);

  const weekStart = mondayOf(anchor);
  /**
   * Неделя — семь дней, включая воскресенье.
   *
   * Здесь стояло `length: 6`, и в сетке недели не было воскресенья, хотя полоса дат над
   * ней показывала семь дней: суббота и воскресенье — обычные учебные дни, и занятие в
   * воскресенье просто негде было увидеть.
   */
  const weekDays = Array.from({ length: DAYS_SHORT.length }, (_, index) =>
    shiftIso(weekStart, index),
  );

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

  /**
   * Отметки в расписании показываем ученику и законному представителю: им важно видеть,
   * что получено на занятии. Преподавателю и администратору это ни к чему — у них есть
   * журнал урока с правкой.
   */
  const showMarks = session.permissions.some(
    (grant) => grant.permission === 'grades:read' && grant.scope === 'own',
  );

  const items = lessons.data?.items ?? [];
  const marks = useLessonMarks(showMarks ? items.map((lesson) => lesson.id) : []);

  /** Отметки по занятию: в плитке нужны и оценки, и посещаемость. */
  const gradesOf = (lessonId: string) =>
    (marks.data?.grades ?? []).filter((grade) => grade.lessonId === lessonId);
  const attendanceOf = (lessonId: string) =>
    (marks.data?.attendance ?? []).find((mark) => mark.lessonId === lessonId);
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

  const emptyPairs = pairs.filter(
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

        {!hasBells(bells.data?.items) && (
          <div className="mt-3">
            <Alert tone="warning">
              В справочнике «Звонки» не задано ни одной пары, поэтому сетка показывает только
              первую. Заполните звонки — и появится столько строк, сколько пар в заведении.
            </Alert>
          </div>
        )}

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
                    marker={lessonMarker(lesson, appearance)}
                    colorsEnabled={appearance.colorsEnabled}
                    grades={gradesOf(lesson.id)}
                    attendance={attendanceOf(lesson.id)}
                    learnerView={showMarks}
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
              {pairs.map((pair) => (
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
                      <td key={iso} className="px-0.5 py-1">
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
                              /*
                                Мелкая плитка сетки: цвет предмета — **только
                                заливкой**, без кружка. В большой плашке дня
                                наоборот: кружок и никакой заливки.
                              */
                              <span
                                key={lesson.id}
                                /*
                                  Строго три строки фиксированной высоты и фиксированная
                                  ширина (решение владельца): иначе плитка меняет размер от
                                  того, заполнены отметки или нет, и сетка «дышит».

                                  Размер: было `text-xs` (12 px), стало `text-sm` (14 px) —
                                  решение владельца увеличить на 2 px. Межстрочный держим
                                  `leading-4`: строки по-прежнему ровно три по 16 px.
                                */
                                className={`block h-12 w-24 overflow-hidden rounded px-1 text-sm leading-4 font-semibold ${
                                  lesson.status === 'cancelled'
                                    ? 'text-slate-400'
                                    : 'text-slate-700'
                                }`}
                                style={
                                  appearance.colorsEnabled && lesson.status !== 'cancelled'
                                    ? {
                                        backgroundColor: `${subjectColor(lesson.subjectId, lesson.subjectColor)}22`,
                                      }
                                    : undefined
                                }
                              >
                                {/*
                                  Плитка недели — три строки (решение владельца):
                                  код предмета с аудиторией, группа, затем посещаемость слева
                                  и количество оценок справа. Раньше отметки стояли по углам,
                                  и посещаемость уезжала на третью строку сама собой — это
                                  понравилось, поэтому расположение закрепили строками.
                                */}
                                <span className="flex h-4 items-baseline justify-between gap-1">
                                  <span className="truncate">
                                    {subjectCode(lesson.subjectName, lesson.subjectShortName)}
                                    {/* Событие видно и в сетке недели: значок вместо слова. */}
                                    {lessonMarker(lesson, appearance) !== null && (
                                      <span className="ml-1">
                                        {lessonMarker(lesson, appearance)}
                                      </span>
                                    )}
                                  </span>
                                  <span className="shrink-0 text-slate-500">
                                    {lesson.roomName ?? '—'}
                                  </span>
                                </span>

                                <span className="block h-4 truncate text-slate-500">
                                  {lesson.groupName}
                                </span>

                                <span className="flex h-4 items-center justify-between gap-1">
                                  {showMarks ? (
                                    <LessonAttendance mark={attendanceOf(lesson.id)} />
                                  ) : (
                                    <span />
                                  )}
                                  {showMarks && <LessonGradesCount grades={gradesOf(lesson.id)} />}
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
