import type { LessonDto, SessionResponseDto } from '@edu-diary/contracts';
import { subjectCode } from '@edu-diary/domain';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { useAcademicContext } from '../components/AcademicContext';
import { useAppearanceSettings } from '../components/AppearanceContext';
import { Alert, Badge, Button, Card, EmptyState, Field, TextInput } from '../components/ui';
import { SubjectDot, lessonMarker, subjectColor } from '../lib/appearance';
import { errorMessage } from '../lib/api-client';
import { hasBells, pairsFromBells } from '../lib/schedule-pairs';
import {
  useCreateLesson,
  useBells,
  useDeleteLesson,
  useGenerateLessons,
  useGenerationPreview,
  useLessons,
  useRestoreLesson,
  useRooms,
  useScheduleGroups,
  useSubjects,
  useSubstitutions,
  useTeachers,
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

const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

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

/** Форма нового урока: ставим занятие в конкретную клетку сетки. */
function ManualLessonForm({
  studyGroupId,
  lessonDate,
  pairNumber,
  onDone,
}: {
  studyGroupId: string;
  lessonDate: string;
  pairNumber: number;
  onDone: () => void;
}) {
  const subjects = useSubjects();
  const teachers = useTeachers();
  const rooms = useRooms();
  const create = useCreateLesson();

  const [subjectId, setSubjectId] = useState('');
  const [teacherUserId, setTeacherUserId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await create.mutateAsync({
            studyGroupId,
            subjectId,
            teacherUserId,
            ...(roomId === '' ? {} : { roomId }),
            lessonDate,
            pairNumber,
            // Время необязательно: если не указали, сервер возьмёт его из звонков.
            ...(timeStart === '' ? {} : { timeStart }),
            ...(timeEnd === '' ? {} : { timeEnd }),
          });
          onDone();
        } catch {
          // Ошибка показывается ниже.
        }
      }}
    >
      <div className="text-sm text-slate-600">
        Новый урок: {lessonDate}, {pairNumber}-я пара
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Предмет">
          <select
            required
            name="subjectId"
            className={selectClass}
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
          >
            <option value="">— выберите предмет —</option>
            {(subjects.data?.items ?? []).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Преподаватель">
          <select
            required
            name="teacherUserId"
            className={selectClass}
            value={teacherUserId}
            onChange={(event) => setTeacherUserId(event.target.value)}
          >
            <option value="">— выберите преподавателя —</option>
            {(teachers.data?.items ?? []).map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.fullName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Аудитория" hint="Необязательно">
          <select
            name="roomId"
            className={selectClass}
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
          >
            <option value="">— не указана —</option>
            {(rooms.data?.items ?? []).map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Начало" hint="Из звонков">
            <TextInput
              type="time"
              value={timeStart}
              onChange={(event) => setTimeStart(event.target.value)}
            />
          </Field>
          <Field label="Конец">
            <TextInput
              type="time"
              value={timeEnd}
              onChange={(event) => setTimeEnd(event.target.value)}
            />
          </Field>
        </div>
      </div>

      {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={create.isPending || subjectId === '' || teacherUserId === ''}
        >
          Поставить урок
        </Button>
        <Button tone="ghost" type="button" onClick={onDone}>
          Отмена
        </Button>
      </div>
    </form>
  );
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
  const appearance = useAppearanceSettings();
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
        {/* Маркер цвета рядом с названием: в строках заливка была бы тяжёлой. */}
        <SubjectDot
          subjectId={lesson.subjectId}
          color={lesson.subjectColor}
          enabled={appearance.colorsEnabled}
        />
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
  const previewGenerate = useGenerationPreview();
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(shiftIso(todayIso(), 7));
  const [result, setResult] = useState<string | null>(null);
  /** Пересоздание: стереть уроки периода и создать заново по шаблону. */
  const [recreate, setRecreate] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [counts, setCounts] = useState<{
    lessons: number;
    manualLessons: number;
    substitutions: number;
  } | null>(null);

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
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (groupId === null) return;

            /*
              Пересоздание — опасная операция, поэтому она в два шага: включаем
              чекбокс, видим числа и предупреждение, затем отдельно подтверждаем.
              Обычная генерация (без чекбокса) работает одним нажатием.
            */
            if (recreate && !confirmed) {
              const preview = await previewGenerate
                .mutateAsync({ studyGroupId: groupId, from, to })
                .catch(() => null);
              if (preview === null) return;
              setCounts(preview);
              setConfirmed(true);
              return;
            }

            setResult(null);
            setConfirmed(false);
            try {
              const response = await generate.mutateAsync({
                studyGroupId: groupId,
                from,
                to,
                ...(recreate ? { recreate: true } : {}),
              });
              setResult(
                recreate
                  ? `Пересоздано за ${from} — ${to}: удалено уроков ${response.deleted} ` +
                      `(снято замен ${response.deletedSubstitutions}), создано ${response.created}. ` +
                      'Смотрите сетку ниже.'
                  : `Создано за ${from} — ${to}: уроков ${response.created}, обновлено ${response.updated}, ` +
                      `пропущено правок вручную ${response.skippedManual}. Смотрите сетку ниже.`,
              );
              setCounts(null);
            } catch {
              // Ошибка показывается ниже.
            }
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="С даты">
              <TextInput
                required
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setConfirmed(false);
                  setCounts(null);
                }}
              />
            </Field>
            <Field label="По дату">
              <TextInput
                required
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setConfirmed(false);
                  setCounts(null);
                }}
              />
            </Field>
            <Button type="submit" disabled={generate.isPending || groupId === null}>
              {recreate && !confirmed ? 'Показать, что будет удалено' : 'Создать уроки за период'}
            </Button>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="recreate"
              checked={recreate}
              onChange={(event) => {
                setRecreate(event.target.checked);
                setConfirmed(false);
                setCounts(null);
                setResult(null);
              }}
            />
            Пересоздать уроки за период
          </label>

          {recreate && (
            <Alert tone="warning">
              Все уроки за указанный период будут созданы заново
              {counts === null
                ? ', включая созданные вручную. Нажмите «Показать, что будет удалено», чтобы увидеть числа.'
                : `: будет удалено уроков ${counts.lessons}, из них созданных вручную ${counts.manualLessons}; снято замен ${counts.substitutions}.`}
            </Alert>
          )}

          {recreate && confirmed && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" tone="danger" disabled={generate.isPending}>
                Подтверждаю: пересоздать
              </Button>
              <span className="text-sm text-slate-600">
                Действие попадёт в аудит: кто, когда и за какой период пересоздал уроки.
              </span>
            </div>
          )}
        </form>
      )}

      {result !== null && <Alert tone="success">{result}</Alert>}
      {generate.isError && <Alert tone="error">{errorMessage(generate.error)}</Alert>}
      {previewGenerate.isError && <Alert tone="error">{errorMessage(previewGenerate.error)}</Alert>}
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
  /** Режим правки: пустые клетки сетки открывают форму нового урока. */
  const [editing, setEditing] = useState(false);
  const [newSlot, setNewSlot] = useState<{ date: string; pairNumber: number } | null>(null);

  const appearance = useAppearanceSettings();
  const bells = useBells();

  // Строки сетки — только заведённые пары: незачем показывать восемь, если их четыре.
  const pairs = pairsFromBells(bells.data?.items);

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

  /**
   * Плитка урока: состав одинаковый всегда — первая строка «код предмета и
   * аудитория», вторая «название группы». Название группы обрезается: полное
   * видно в подсказке и в панели деталей.
   *
   * Цвет плитки показывает предмет, значок события — в углу.
   */
  const tile = (lesson: LessonDto) => {
    const marker = lessonMarker(lesson, appearance);
    const cancelled = lesson.status === 'cancelled';
    const color = subjectColor(lesson.subjectId, lesson.subjectColor);
    const filled = appearance.colorsEnabled && !cancelled;

    return (
      <button
        key={lesson.id}
        type="button"
        onClick={() => setSelectedLessonId(lesson.id)}
        title={`${lesson.subjectName} · ${lesson.groupName} · ${lesson.teacherName} · ${lesson.roomName ?? 'без аудитории'}`}
        className={`relative w-full rounded border px-1 py-0.5 text-left text-[11px] leading-tight transition ${
          cancelled ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-slate-200'
        } hover:shadow-sm`}
        style={filled ? { backgroundColor: `${color}22`, borderColor: color } : undefined}
      >
        {marker !== null && (
          <span className="absolute top-0 right-0.5 text-[13px] leading-none">{marker}</span>
        )}

        <span className="flex items-baseline gap-1 pr-4">
          <span className="truncate font-medium">
            {subjectCode(lesson.subjectName, lesson.subjectShortName)}
          </span>
          <span className="ml-auto shrink-0 text-slate-500">{lesson.roomName ?? '—'}</span>
        </span>
        <span className="block truncate text-slate-600">{lesson.groupName}</span>
      </button>
    );
  };

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

          {/*
            Правка расписания — справа в строке: это самое «тяжёлое» действие на
            экране, и рядом с ним подсказка, что без выбранной группы оно не
            работает (выключенная кнопка курсор не меняет, поэтому объясняем
            текстом, а не только состоянием).
          */}
          {canGenerate && (
            <Field label="Правка расписания" hint="Уроки ставятся без шаблона" className="ml-auto">
              <span
                className="flex items-center gap-2"
                title={
                  selectedGroupId === null
                    ? 'Сначала выберите группу в блоке выше — уроки правятся по одной группе'
                    : undefined
                }
              >
                <Button
                  tone={editing ? 'primary' : 'secondary'}
                  type="button"
                  id="edit-week"
                  disabled={selectedGroupId === null}
                  onClick={() => {
                    setEditing((current) => !current);
                    setNewSlot(null);
                  }}
                >
                  {editing ? 'Выйти из правки' : 'Править неделю'}
                </Button>
              </span>
            </Field>
          )}
        </div>

        {canGenerate && selectedGroupId === null && (
          <p className="mt-2 text-sm text-slate-600">
            Чтобы включить правку расписания, сначала выберите группу: занятия ставятся по одной
            группе.
          </p>
        )}

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

        {editing && (
          <div className="mt-3">
            <Alert tone="info">
              Режим правки: нажмите на свободную клетку сетки, чтобы поставить урок. Такой урок не
              связан с шаблоном — генерация его не тронет, но «Пересоздать за период» затрёт.
            </Alert>
          </div>
        )}

        {!hasBells(bells.data?.items) && (
          <div className="mt-3">
            <Alert tone="warning">
              В справочнике «Звонки» не задано ни одной пары, поэтому сетка показывает только
              первую. Заполните звонки — и появится столько строк, сколько пар в заведении.
            </Alert>
          </div>
        )}

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

        {newSlot !== null && selectedGroupId !== null && (
          <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-4">
            <ManualLessonForm
              studyGroupId={selectedGroupId}
              lessonDate={newSlot.date}
              pairNumber={newSlot.pairNumber}
              onDone={() => setNewSlot(null)}
            />
          </div>
        )}

        {items.length === 0 && !lessons.isLoading && (
          <div className="mt-4">
            <EmptyState>
              {selectedGroupId === null
                ? 'Выберите группу: сетка строится по одной группе.'
                : 'За этот период уроков нет. Их можно создать выше или поставить вручную в режиме правки.'}
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
                    {pairs.map((pair) => (
                      <tr key={pair} className="border-t border-slate-100">
                        <td className="px-1 py-1 align-top text-xs font-medium text-slate-500">
                          {pair}
                        </td>
                        {week.map((iso) => {
                          const cell = visible.filter(
                            (lesson) => lesson.lessonDate === iso && lesson.pairNumber === pair,
                          );
                          const isNewSlot =
                            newSlot !== null && newSlot.date === iso && newSlot.pairNumber === pair;

                          return (
                            <td key={iso} className="px-0.5 py-1 align-top">
                              {cell.length === 0 ? (
                                editing && canGenerate && selectedGroupId !== null ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedLessonId(null);
                                      setNewSlot({ date: iso, pairNumber: pair });
                                    }}
                                    title="Поставить урок"
                                    className={`w-full rounded border border-dashed px-1 py-0.5 text-left text-[11px] ${
                                      isNewSlot
                                        ? 'border-sky-500 bg-sky-100 text-sky-800'
                                        : 'border-slate-300 text-slate-400 hover:border-sky-400 hover:text-sky-700'
                                    }`}
                                  >
                                    + урок
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-slate-300">·</span>
                                )
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
