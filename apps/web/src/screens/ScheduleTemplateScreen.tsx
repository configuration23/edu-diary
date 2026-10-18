import type { ScheduleEntryDto, SessionResponseDto } from '@edu-diary/contracts';
import { Fragment, useEffect, useRef, useState } from 'react';

import { useAcademicContext } from '../components/AcademicContext';
import { Alert, Button, Card, EmptyState, Field, Table, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api-client';
import { hasBells, pairsFromBells } from '../lib/schedule-pairs';
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
 * Сетка (шаблон) расписания: занятия, повторяющиеся каждую неделю.
 *
 * Это «конструктор» администратора: занятие ссылается на назначение, поэтому
 * предмет, группа и преподаватель не вводятся заново. Итоговое расписание на
 * дату (с заменами и отменами) живёт на экране «Расписание».
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

function canManageSchedule(session: SessionResponseDto): boolean {
  return session.permissions.some(
    (grant) => grant.permission === 'schedule:write' && grant.scope === 'all',
  );
}

function dayLabel(dayOfWeek: number): string {
  return DAYS.find((day) => day.value === dayOfWeek)?.label ?? String(dayOfWeek);
}

const selectClass = 'w-full rounded-md border border-border px-3 py-2 text-sm';

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
  onDone,
}: {
  groupId: string | null;
  groups: Array<{ id: string; name: string }>;
  selectedGroupId: string | null;
  selectGroup: (id: string | null) => void;
  yearStart: string;
  /** Закрыть форму после добавления: дальше человек работает со списком. */
  onDone: () => void;
}) {
  const assignments = useAssignments(groupId === null ? {} : { studyGroupId: groupId });
  const rooms = useRooms();
  const bells = useBells();
  const create = useCreateScheduleEntry();

  // Пары для выбора — только заведённые в звонках: остальные всё равно нельзя заполнить.
  const pairs = pairsFromBells(bells.data?.items);

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
          /** Форму закрываем: дальше человек работает со списком занятий. */
          onDone();
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
            {pairs.map((number) => (
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
            <span className="mt-1 block text-xs text-muted-foreground">{selectedRoom.note}</span>
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

      <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
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
              className="text-selected-foreground underline"
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

      <div className="mt-3">
        <Button tone="secondary" onClick={onDone}>
          Отмена
        </Button>
      </div>
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
function EntryEditor({
  entry,
  pairs,
  onDone,
  onRemove,
  removePending,
}: {
  entry: ScheduleEntryDto;
  /** Пары, заведённые в звонках: остальные в расписании не используются. */
  pairs: number[];
  onDone: () => void;
  /** Удаление живёт в форме правки: клик по строке не должен ничего удалять. */
  onRemove?: () => void;
  removePending?: boolean;
}) {
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
          {pairs.map((number) => (
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
          <span className="mt-1 block text-xs text-muted-foreground">{selectedRoom.note}</span>
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
        {onRemove !== undefined && (
          <Button tone="ghost" type="button" disabled={removePending === true} onClick={onRemove}>
            Убрать занятие
          </Button>
        )}
      </span>

      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
    </form>
  );
}

export function ScheduleTemplateScreen({ session }: { session: SessionResponseDto }) {
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
  const bells = useBells();

  // Пары для выбора — только заведённые в звонках: остальные всё равно нельзя заполнить.
  const pairs = pairsFromBells(bells.data?.items);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Форма добавления скрыта, пока её не позовут кнопкой: список важнее формы. */
  const [creating, setCreating] = useState(false);
  const editable = canManageSchedule(session);
  /**
   * Учётные записи запрашиваем только те, кто правит расписание: у преподавателя права
   * users:read нет, и список всё равно не нужен — правка ему недоступна.
   */
  const users = useTeachers({ enabled: editable });

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
      {/*
        Заголовок блока — «Шаблон недели» (решение владельца). Прежнее «Занятия в сетке» описывало
        то же самое словами из другого раздела, а сам раздел теперь называется «Шаблон недели» в
        «Учебном процессе».
      */}
      <Card
        title="Шаблон недели"
        description={`Постоянное расписание на неделю${activeYearTitle === null ? '' : ` · ${activeYearTitle}`}. Занятие повторяется каждую неделю в указанных датах действия; уроки по датам появляются на экране «Уроки».`}
        actions={
          editable ? (
            creating ? undefined : (
              <Button onClick={() => setCreating(true)}>Добавить занятие</Button>
            )
          ) : undefined
        }
      >
        {/*
          Отдельной карточки «Добавить занятие» больше нет: она стояла над списком постоянно и
          занимала первый экран, хотя занятие добавляют реже, чем смотрят существующие. Теперь форма
          открывается кнопкой и показывается **над списком** — там же, где её ждут.
        */}
        {editable && creating && (
          <div className="mb-4 rounded-md border border-border bg-muted p-4">
            <EntryForm
              groupId={selectedGroupId}
              groups={groups}
              selectedGroupId={selectedGroupId}
              selectGroup={selectGroup}
              yearStart={activeYearStartsOn ?? ''}
              onDone={() => setCreating(false)}
            />
          </div>
        )}

        {!editable && (
          <GroupField groups={groups} selectedGroupId={selectedGroupId} selectGroup={selectGroup} />
        )}

        {!hasBells(bells.data?.items) && (
          <div className="mt-3">
            <Alert tone="warning">
              В справочнике «Звонки» не задано ни одной пары: доступна только первая. Остальные
              появятся, когда заполните расписание звонков.
            </Alert>
          </div>
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
                // Фрагмент с ключом: к строке занятия добавляется строка правки.
                <Fragment key={entry.id}>
                  {/*
                    Клик по строке открывает правку занятия. Кнопка «Править»
                    остаётся как явная подсказка, а «Убрать» живёт в самой форме:
                    удаление не должно срабатывать случайным нажатием на строку.
                  */}
                  <tr
                    className={`border-b border-border align-top ${
                      editable ? 'cursor-pointer' : ''
                    } ${editingId === entry.id ? 'bg-muted' : ''}`}
                    onClick={editable ? () => setEditingId(entry.id) : undefined}
                  >
                    <td className="px-3 py-2">{dayLabel(entry.dayOfWeek)}</td>
                    <td className="px-3 py-2">{entry.pairNumber}-я</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {entry.timeStart}–{entry.timeEnd}
                    </td>
                    <td className="px-3 py-2">
                      {entry.subjectName}
                      <div className="text-xs text-muted-foreground">
                        {entry.groupName} · с {entry.validFrom}
                        {entry.validTo === null ? '' : ` по ${entry.validTo}`}
                      </div>
                    </td>
                    <td className="px-3 py-2">{teacherName(entry.teacherUserId)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.roomName ?? '—'}</td>
                    <td className="px-3 py-2">
                      {editable && editingId !== entry.id && (
                        <Button
                          tone="ghost"
                          onClick={(event) => {
                            // Кнопка внутри строки: не даём клику сработать дважды.
                            event.stopPropagation();
                            setEditingId(entry.id);
                          }}
                        >
                          Править
                        </Button>
                      )}
                    </td>
                  </tr>
                  {editingId === entry.id && (
                    // Правка — отдельной строкой таблицы: поля выстраиваются в линию,
                    // а не сжимаются в ячейку «Предмет».
                    <tr data-static className="border-b border-border bg-muted">
                      <td colSpan={7} className="px-3 py-2">
                        <EntryEditor
                          entry={entry}
                          pairs={pairs}
                          onDone={() => setEditingId(null)}
                          onRemove={() => {
                            void remove.mutateAsync(entry.id).catch(() => undefined);
                            setEditingId(null);
                          }}
                          removePending={remove.isPending}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Table>
          </div>
        )}

        {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
      </Card>
    </div>
  );
}
