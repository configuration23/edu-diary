import type { ScheduleEntryDto, SessionResponseDto } from '@edu-diary/contracts';
import { useEffect, useRef, useState } from 'react';

import { useAcademicContext } from '../components/AcademicContext';
import { Alert, Button, Card, EmptyState, Field, Table, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api-client';
import {
  useAssignments,
  useBells,
  useCreateScheduleEntry,
  useDeleteScheduleEntry,
  useRooms,
  useScheduleEntries,
  useScheduleGroups,
  useTeachers,
  useUpdateScheduleEntry,
} from '../lib/queries';

/**
 * Расписание: недельная сетка группы.
 *
 * Шаблон повторяется каждую неделю в границах дат действия, поэтому сетка — это
 * «день недели × пара», а не календарь. Исключения на конкретные даты (отмена,
 * перенос, замена) и порождённые уроки живут на экране «Уроки»: здесь — основа,
 * из которой они получаются.
 *
 * Правка расписания доступна только администратору (`schedule:write@all`),
 * поэтому форма показывается по праву, а не по роли: у преподавателя раздел
 * остаётся просмотром.
 */

const DAYS = [
  { value: 1, label: 'Понедельник' },
  { value: 2, label: 'Вторник' },
  { value: 3, label: 'Среда' },
  { value: 4, label: 'Четверг' },
  { value: 5, label: 'Пятница' },
  { value: 6, label: 'Суббота' },
  { value: 7, label: 'Воскресенье' },
];

const PAIRS = [1, 2, 3, 4, 5, 6, 7, 8];

function canManageSchedule(session: SessionResponseDto): boolean {
  return session.permissions.some(
    (grant) => grant.permission === 'schedule:write' && grant.scope === 'all',
  );
}

function dayLabel(dayOfWeek: number): string {
  return DAYS.find((day) => day.value === dayOfWeek)?.label ?? String(dayOfWeek);
}

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

/**
 * Выбор группы для расписания.
 *
 * Группа выбирается в блоке добавления занятия, а список ниже подгружается по ней.
 * Отдельного селекта в шапке на этом экране нет: два разных «Группа» на одной
 * странице путают (в шапке — контекст всего приложения).
 */
function GroupField({
  groups,
  selectedGroupId,
  selectGroup,
  disabled = false,
}: {
  groups: Array<{ id: string; name: string }>;
  selectedGroupId: string | null;
  selectGroup: (id: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <Field label="Группа" hint="«Все доступные» — занятия по всем группам">
      <select
        name="studyGroupId"
        required={disabled}
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

/** Форма постановки занятия в сетку. */
function EntryForm({
  groupId,
  groups,
  selectedGroupId,
  selectGroup,
  yearStart,
}: {
  groupId: string | null;
  groups: Array<{ id: string; name: string }>;
  selectedGroupId: string | null;
  selectGroup: (id: string | null) => void;
  yearStart: string;
}) {
  const assignments = useAssignments(groupId === null ? {} : { studyGroupId: groupId });
  const rooms = useRooms();
  const bells = useBells();
  const create = useCreateScheduleEntry();

  const [assignmentId, setAssignmentId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [pairNumber, setPairNumber] = useState('1');
  const [manualTime, setManualTime] = useState(false);
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [validFrom, setValidFrom] = useState(yearStart);
  const [validTo, setValidTo] = useState('');

  /**
   * Начало действия по умолчанию — начало активного учебного года. Пока
   * пользователь не трогал поле, оно следует за годом: контекст подгружается
   * после первого рендера.
   */
  const validFromTouched = useRef(false);
  useEffect(() => {
    if (validFromTouched.current || yearStart === '') return;
    setValidFrom(yearStart);
  }, [yearStart]);

  const assignmentOptions = assignments.data?.items ?? [];
  const selectedAssignment = assignmentOptions.find((item) => item.id === assignmentId);

  /**
   * Занятие не может начинаться раньше назначения. Если выбранное назначение
   * стартует позже подставленной даты, подтягиваем её — но только пока
   * пользователь не правил поле сам: иначе форма упиралась бы в отказ сервера.
   */
  useEffect(() => {
    if (validFromTouched.current || selectedAssignment === undefined) return;
    setValidFrom((current) =>
      current === '' || current < selectedAssignment.startsOn
        ? selectedAssignment.startsOn
        : current,
    );
  }, [selectedAssignment]);

  /**
   * Список аудиторий: название и примечание отдельными частями, чтобы номер
   * аудитории не путался (названия вида «301» без пояснения бесполезны).
   */
  const roomOptions = rooms.data?.items ?? [];
  const selectedRoom = roomOptions.find((room) => room.id === roomId);

  const bell = bells.data?.items.find((item) => item.pairNumber === Number(pairNumber));
  const needsManualTime = manualTime || bells.data === undefined || bell === undefined;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await create.mutateAsync({
            assignmentId,
            roomId: roomId === '' ? null : roomId,
            dayOfWeek: Number(dayOfWeek),
            pairNumber: Number(pairNumber),
            // Время не отправляем, когда оно берётся из звонков: источник истины —
            // справочник, и подстановка на сервере не разойдётся с формой.
            ...(needsManualTime ? { timeStart, timeEnd } : {}),
            validFrom,
            validTo: validTo === '' ? null : validTo,
          });
        } catch {
          // Ошибка показывается ниже.
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <GroupField groups={groups} selectedGroupId={selectedGroupId} selectGroup={selectGroup} />

        <Field label="Назначение" hint="Предмет и преподаватель из назначений группы">
          <select
            required
            name="assignmentId"
            className={selectClass}
            value={assignmentId}
            onChange={(event) => setAssignmentId(event.target.value)}
            disabled={groupId === null}
          >
            <option value="">
              {groupId === null ? 'Сначала выберите группу' : 'Выберите назначение'}
            </option>
            {assignmentOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.subjectName} — {item.teacherName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="День недели">
          <select
            name="dayOfWeek"
            className={selectClass}
            value={dayOfWeek}
            onChange={(event) => setDayOfWeek(event.target.value)}
          >
            {DAYS.map((day) => (
              <option key={day.value} value={String(day.value)}>
                {day.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Пара">
          <select
            name="pairNumber"
            className={selectClass}
            value={pairNumber}
            onChange={(event) => setPairNumber(event.target.value)}
          >
            {PAIRS.map((number) => (
              <option key={number} value={String(number)}>
                {number}-я пара
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
            <option value="">Без аудитории</option>
            {roomOptions.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
          {/* Название серым под селектом: в списке из одних номеров легко запутаться. */}
          {selectedRoom !== undefined && selectedRoom.note !== null && (
            <span className="mt-1 block text-xs text-slate-500">{selectedRoom.note}</span>
          )}
        </Field>

        <Field label="Действует с" hint="По умолчанию — начало учебного года">
          <TextInput
            required
            name="validFrom"
            type="date"
            value={validFrom}
            onChange={(event) => {
              validFromTouched.current = true;
              setValidFrom(event.target.value);
            }}
          />
        </Field>

        <Field label="Действует по" hint="Пусто — до конца года">
          <TextInput
            name="validTo"
            type="date"
            value={validTo}
            onChange={(event) => setValidTo(event.target.value)}
          />
        </Field>
      </div>

      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
        {needsManualTime ? (
          <div className="flex flex-col gap-3">
            <p>
              {bells.data === undefined
                ? 'Звонки не заполнены.'
                : `Для ${pairNumber}-й пары звонок не задан.`}{' '}
              Укажите время вручную или заполните справочник «Звонки».
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Начало">
                <TextInput
                  required
                  type="time"
                  value={timeStart}
                  onChange={(event) => setTimeStart(event.target.value)}
                />
              </Field>
              <Field label="Окончание">
                <TextInput
                  required
                  type="time"
                  value={timeEnd}
                  onChange={(event) => setTimeEnd(event.target.value)}
                />
              </Field>
            </div>
          </div>
        ) : (
          <p>
            Время по звонкам: <strong>{bell?.timeStart}</strong> — <strong>{bell?.timeEnd}</strong>.{' '}
            <button
              type="button"
              className="text-sky-700 underline"
              onClick={() => setManualTime(true)}
            >
              Указать другое время
            </button>
          </p>
        )}
      </div>

      <div>
        <Button type="submit" disabled={create.isPending || assignmentId === ''}>
          Добавить в расписание
        </Button>
      </div>

      {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
    </form>
  );
}

/**
 * Правка занятия: перенос на другую пару, смена аудитории и дат действия.
 *
 * Занятие приходит строкой из списка, а не берётся повторным запросом: строка в
 * списке уже отфильтрована (группа), и редактор закрывается кнопкой, а не «сам»
 * после сохранения.
 */
function EntryEditor({ entry, onDone }: { entry: ScheduleEntryDto; onDone: () => void }) {
  const rooms = useRooms();
  const update = useUpdateScheduleEntry();
  const [pairNumber, setPairNumber] = useState(String(entry.pairNumber));
  const [roomId, setRoomId] = useState(entry.roomId ?? '');
  const [validTo, setValidTo] = useState(entry.validTo ?? '');

  const roomOptions = rooms.data?.items ?? [];
  const selectedRoom = roomOptions.find((room) => room.id === roomId);

  return (
    <form
      className="flex flex-wrap items-end gap-3 py-2"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await update.mutateAsync({
            id: entry.id,
            pairNumber: Number(pairNumber),
            roomId: roomId === '' ? null : roomId,
            ...(validTo === '' ? {} : { validTo }),
          });
          onDone();
        } catch {
          // Ошибка показывается ниже.
        }
      }}
    >
      <Field label="Пара">
        <select
          className={selectClass}
          value={pairNumber}
          onChange={(event) => setPairNumber(event.target.value)}
        >
          {PAIRS.map((number) => (
            <option key={number} value={String(number)}>
              {number}-я пара
            </option>
          ))}
        </select>
      </Field>

      <Field label="Аудитория">
        <select
          className={selectClass}
          value={roomId}
          onChange={(event) => setRoomId(event.target.value)}
        >
          <option value="">Без аудитории</option>
          {roomOptions.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
        {selectedRoom !== undefined && selectedRoom.note !== null && (
          <span className="mt-1 block text-xs text-slate-500">{selectedRoom.note}</span>
        )}
      </Field>
      <Field label="Действует по" hint="Пусто — не менять">
        <TextInput
          type="date"
          value={validTo}
          onChange={(event) => setValidTo(event.target.value)}
        />
      </Field>

      <span className="flex gap-2">
        <Button type="submit" disabled={update.isPending}>
          Сохранить
        </Button>
        <Button tone="ghost" type="button" onClick={onDone}>
          Закрыть
        </Button>
      </span>

      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
    </form>
  );
}

export function ScheduleScreen({ session }: { session: SessionResponseDto }) {
  const {
    groups: contextGroups,
    selectedGroupId,
    selectGroup,
    activeYearTitle,
    activeYearStartsOn,
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
  const entries = useScheduleEntries(
    selectedGroupId === null ? {} : { studyGroupId: selectedGroupId },
  );
  const remove = useDeleteScheduleEntry();
  const users = useTeachers();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editable = canManageSchedule(session);

  const items = entries.data?.items ?? [];

  /**
   * Имя преподавателя расписание не хранит: оно принадлежит учётной записи.
   * Разрешаем его из списка пользователей, чтобы не дублировать данные и не
   * связывать таблицы учебного процесса с учётными записями (ADR-027).
   */
  const teacherName = (userId: string): string =>
    users.data?.items.find((user) => user.id === userId)?.fullName ?? '—';

  return (
    <div className="flex flex-col gap-6">
      {editable && (
        <Card
          title="Добавить занятие"
          description="Занятие повторяется каждую неделю в указанных датах действия. Группа выбирается здесь — список ниже показывает её занятия."
        >
          <EntryForm
            groupId={selectedGroupId}
            groups={groups}
            selectedGroupId={selectedGroupId}
            selectGroup={selectGroup}
            yearStart={activeYearStartsOn ?? ''}
          />
        </Card>
      )}

      <Card
        title="Занятия в сетке"
        description={`Шаблон занятий на неделю${activeYearTitle === null ? '' : ` · ${activeYearTitle}`}. Уроки по датам появляются на экране «Уроки».`}
      >
        {!editable && (
          <GroupField groups={groups} selectedGroupId={selectedGroupId} selectGroup={selectGroup} />
        )}

        {entries.isError && <Alert tone="error">{errorMessage(entries.error)}</Alert>}

        {items.length === 0 && !entries.isLoading && (
          <div className="mt-4">
            <EmptyState>
              {selectedGroupId === null
                ? 'Выберите группу, чтобы увидеть её расписание, или заполните расписание для всех групп.'
                : 'В расписании этой группы пока нет занятий.'}
            </EmptyState>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-4">
            <Table head={['День', 'Пара', 'Время', 'Предмет', 'Преподаватель', 'Аудитория', '']}>
              {items.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2">{dayLabel(entry.dayOfWeek)}</td>
                  <td className="px-3 py-2">{entry.pairNumber}-я</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {entry.timeStart}–{entry.timeEnd}
                  </td>
                  <td className="px-3 py-2">
                    {entry.subjectName}
                    <div className="text-xs text-slate-500">
                      {entry.groupName} · с {entry.validFrom}
                      {entry.validTo === null ? '' : ` по ${entry.validTo}`}
                    </div>
                    {editingId === entry.id && (
                      <EntryEditor entry={entry} onDone={() => setEditingId(null)} />
                    )}
                  </td>
                  <td className="px-3 py-2">{teacherName(entry.teacherUserId)}</td>
                  <td className="px-3 py-2 text-slate-500">{entry.roomName ?? '—'}</td>
                  <td className="px-3 py-2">
                    {editable && editingId !== entry.id && (
                      <span className="flex flex-wrap gap-2">
                        <Button tone="ghost" onClick={() => setEditingId(entry.id)}>
                          Править
                        </Button>
                        <Button
                          tone="ghost"
                          disabled={remove.isPending}
                          onClick={() => void remove.mutateAsync(entry.id).catch(() => undefined)}
                        >
                          Убрать
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        )}

        {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
      </Card>
    </div>
  );
}
