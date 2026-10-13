import { useState } from 'react';

import type { GradeCategoryDto, RoomDto, SubjectDto } from '@edu-diary/contracts';
import { Alert, Badge, Button, Card, EmptyState, Field, Table, TextInput } from '../components/ui';
import { SUBJECT_COLOR_PALETTE, SubjectDot, subjectColor } from '../lib/appearance';
import { errorMessage } from '../lib/api-client';
import {
  useBells,
  useCreateGradeCategory,
  useCreateRoom,
  useCreateSubject,
  useDeleteBell,
  useDeleteGradeCategory,
  useDeleteRoom,
  useDeleteSubject,
  useGradeCategories,
  useSignRules,
  useUpdateSignRule,
  useRooms,
  useSaveBell,
  useSubjects,
  useUpdateGradeCategory,
  useUpdateRoom,
  useUpdateSubject,
} from '../lib/queries';

/**
 * Справочники: предметы, аудитории, категории оценок с весами.
 *
 * Удаление разрешено только для свободного справочника: если предмет уже
 * используется в назначениях, сервер отвечает 409 и объясняет причину —
 * сообщение показываем как есть.
 */

const SUBJECT_KINDS = [
  { value: 'mandatory', label: 'Обязательный' },
  { value: 'optional', label: 'По выбору' },
  { value: 'practice', label: 'Практика' },
] as const;

function subjectKindLabel(kind: string): string {
  return SUBJECT_KINDS.find((item) => item.value === kind)?.label ?? kind;
}

function SubjectsCard() {
  const subjects = useSubjects();
  const create = useCreateSubject();
  const update = useUpdateSubject();
  const remove = useDeleteSubject();

  /**
   * Цвет нового предмета: первый свободный из палитры.
   *
   * Случайный выбор мог бы дать два почти одинаковых цвета подряд, поэтому идём по
   * кругу оттенков и пропускаем занятые. Администратор может выбрать цвет вручную;
   * пустое поле означает «подобрать автоматически».
   */
  const usedColors = new Set(
    (subjects.data?.items ?? [])
      .map((item) => item.color)
      .filter((value): value is string => value !== null),
  );
  const nextSubjectColor =
    SUBJECT_COLOR_PALETTE.find((candidate) => !usedColors.has(candidate)) ??
    SUBJECT_COLOR_PALETTE[0]!;

  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [kind, setKind] = useState<'mandatory' | 'optional' | 'practice'>('mandatory');
  const [color, setColor] = useState('');
  const [editing, setEditing] = useState<SubjectDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editShortName, setEditShortName] = useState('');
  const [editKind, setEditKind] = useState<'mandatory' | 'optional' | 'practice'>('mandatory');
  const [editColor, setEditColor] = useState('');

  return (
    <Card title="Предметы" description="По предмету ставятся оценки и строятся назначения.">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await create.mutateAsync({
              name,
              shortName: shortName === '' ? null : shortName,
              kind,
              color: color === '' ? null : color,
            });
            setName('');
            setShortName('');
            setColor('');
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Название">
            <TextInput required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Короткое имя" hint="Код для плиток расписания, 2–4 символа (необязательно)">
            <TextInput value={shortName} onChange={(event) => setShortName(event.target.value)} />
          </Field>
          <Field label="Вид">
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as 'mandatory' | 'optional' | 'practice')
              }
            >
              {SUBJECT_KINDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Цвет" hint="Пусто — подберём автоматически">
            <span className="flex items-center gap-2">
              <input
                type="color"
                name="color"
                className="h-9 w-12 rounded border border-slate-300"
                value={color === '' ? nextSubjectColor : color}
                onChange={(event) => setColor(event.target.value)}
              />
              {color === '' && <span className="text-xs text-slate-500">по кругу оттенков</span>}
            </span>
          </Field>
          <div className="flex items-end pb-2">
            <Button type="submit" disabled={create.isPending}>
              Добавить предмет
            </Button>
          </div>
        </div>

        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
        {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
        {remove.isSuccess && <Alert tone="success">Предмет удалён.</Alert>}
      </form>

      <div className="mt-4">
        {subjects.isLoading && <p className="text-sm text-slate-500">Загружаем…</p>}
        {subjects.isError && <Alert tone="error">{errorMessage(subjects.error)}</Alert>}

        {subjects.data !== undefined && subjects.data.items.length === 0 && (
          <EmptyState>Предметов пока нет.</EmptyState>
        )}

        {subjects.data !== undefined && subjects.data.items.length > 0 && (
          <Table head={['Предмет', 'Коротко', 'Вид', '']}>
            {subjects.data.items.map((subject) => (
              <tr key={subject.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">
                  <SubjectDot subjectId={subject.id} color={subject.color} />
                  {subject.name}
                </td>
                <td className="px-3 py-2 text-slate-600">{subject.shortName ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge>{subjectKindLabel(subject.kind)}</Badge>
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-2">
                    <Button
                      tone="ghost"
                      onClick={() => {
                        setEditing(subject);
                        setEditName(subject.name);
                        setEditShortName(subject.shortName ?? '');
                        setEditColor(subject.color ?? '');
                        setEditKind(subject.kind as 'mandatory' | 'optional' | 'practice');
                      }}
                    >
                      Править
                    </Button>
                    <Button
                      tone="ghost"
                      disabled={remove.isPending}
                      onClick={() => void remove.mutateAsync(subject.id).catch(() => undefined)}
                    >
                      Удалить
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}

        {editing !== null && (
          <form
            className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-4"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await update.mutateAsync({
                  id: editing.id,
                  name: editName,
                  shortName: editShortName === '' ? null : editShortName,
                  kind: editKind,
                  color: editColor === '' ? null : editColor,
                });
                setEditing(null);
              } catch {
                // Ошибка показывается ниже.
              }
            }}
          >
            <Field label="Название">
              <TextInput
                required
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </Field>
            <Field label="Короткое имя" hint="Код для плиток расписания, 2–4 символа">
              <TextInput
                value={editShortName}
                onChange={(event) => setEditShortName(event.target.value)}
              />
            </Field>
            <Field label="Вид">
              <select
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={editKind}
                onChange={(event) =>
                  setEditKind(event.target.value as 'mandatory' | 'optional' | 'practice')
                }
              >
                {SUBJECT_KINDS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Цвет" hint="Заливка плиток и маркер в строках">
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  name="editColor"
                  className="h-9 w-12 rounded border border-slate-300"
                  value={editColor === '' ? subjectColor(editing.id) : editColor}
                  onChange={(event) => setEditColor(event.target.value)}
                />
                <Button tone="ghost" type="button" onClick={() => setEditColor('')}>
                  Автоматически
                </Button>
              </span>
            </Field>
            <Button type="submit" disabled={update.isPending}>
              Сохранить
            </Button>
            <Button tone="secondary" onClick={() => setEditing(null)}>
              Отмена
            </Button>
            {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
          </form>
        )}
      </div>
    </Card>
  );
}

function RoomsCard() {
  const rooms = useRooms();
  const create = useCreateRoom();
  const update = useUpdateRoom();
  const remove = useDeleteRoom();

  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<RoomDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [editNote, setEditNote] = useState('');

  const startEditing = (room: RoomDto): void => {
    setEditing(room);
    setEditName(room.name);
    setEditCapacity(room.capacity === null ? '' : String(room.capacity));
    setEditNote(room.note ?? '');
  };

  return (
    <Card title="Аудитории" description="Аудитория указывается в уроке расписания.">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await create.mutateAsync({
              name,
              capacity: capacity === '' ? null : Number(capacity),
              note: note === '' ? null : note,
            });
            setName('');
            setCapacity('');
            setNote('');
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Название">
            <TextInput required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Вместимость" hint="Необязательно">
            <TextInput
              inputMode="numeric"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </Field>
          <Field label="Примечание" hint="Необязательно">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <div className="flex items-end pb-2">
            <Button type="submit" disabled={create.isPending}>
              Добавить аудиторию
            </Button>
          </div>
        </div>

        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
      </form>

      <div className="mt-4">
        {rooms.data !== undefined && rooms.data.items.length === 0 && (
          <EmptyState>Аудиторий пока нет.</EmptyState>
        )}

        {rooms.data !== undefined && rooms.data.items.length > 0 && (
          <Table head={['Аудитория', 'Вместимость', 'Примечание', '']}>
            {rooms.data.items.map((room) => (
              <tr key={room.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{room.name}</td>
                <td className="px-3 py-2">{room.capacity ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{room.note ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-2">
                    <Button tone="ghost" onClick={() => startEditing(room)}>
                      Править
                    </Button>
                    <Button
                      tone="ghost"
                      disabled={remove.isPending}
                      onClick={() => void remove.mutateAsync(room.id).catch(() => undefined)}
                    >
                      Удалить
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}

        {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}

        {editing !== null && (
          <form
            className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-4"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await update.mutateAsync({
                  id: editing.id,
                  name: editName,
                  capacity: editCapacity === '' ? null : Number(editCapacity),
                  note: editNote === '' ? null : editNote,
                });
                setEditing(null);
              } catch {
                // Ошибка показывается ниже.
              }
            }}
          >
            <Field label="Название">
              <TextInput
                required
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </Field>
            <Field label="Вместимость">
              <TextInput
                inputMode="numeric"
                value={editCapacity}
                onChange={(event) => setEditCapacity(event.target.value)}
              />
            </Field>
            <Field label="Примечание">
              <TextInput value={editNote} onChange={(event) => setEditNote(event.target.value)} />
            </Field>
            <Button type="submit" disabled={update.isPending}>
              Сохранить
            </Button>
            <Button tone="secondary" onClick={() => setEditing(null)}>
              Отмена
            </Button>
            {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
          </form>
        )}
      </div>
    </Card>
  );
}

function CategoriesCard() {
  const categories = useGradeCategories();
  const create = useCreateGradeCategory();
  const update = useUpdateGradeCategory();
  const remove = useDeleteGradeCategory();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [weight, setWeight] = useState('1');
  const [editing, setEditing] = useState<GradeCategoryDto | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editWeight, setEditWeight] = useState('1');

  return (
    <Card
      title="Причины оценок"
      description="Причина обязательна при выставлении оценки и задаёт её вес в среднем балле."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await create.mutateAsync({ code, title, weight: Number(weight) });
            setCode('');
            setTitle('');
            setWeight('1');
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Код" hint="До двух символов: Д, К, Пр">
            <TextInput
              required
              maxLength={2}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <Field label="Название">
            <TextInput required value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Вес" hint="1–5">
            <TextInput
              required
              inputMode="numeric"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            />
          </Field>
          <div className="flex items-end pb-2">
            <Button type="submit" disabled={create.isPending}>
              Добавить причину
            </Button>
          </div>
        </div>

        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
      </form>

      <div className="mt-4">
        {categories.data !== undefined && categories.data.items.length === 0 && (
          <EmptyState>Причин пока нет.</EmptyState>
        )}

        {categories.data !== undefined && categories.data.items.length > 0 && (
          <Table head={['Код', 'Название', 'Вес', '', '']}>
            {categories.data.items.map((category) => (
              <tr key={category.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{category.code}</td>
                <td className="px-3 py-2">{category.title}</td>
                <td className="px-3 py-2">{category.weight}</td>
                <td className="px-3 py-2">
                  {category.isDefault && <Badge tone="success">по умолчанию</Badge>}
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-2">
                    <Button
                      tone="ghost"
                      onClick={() => {
                        setEditing(category);
                        setEditTitle(category.title);
                        setEditWeight(String(category.weight));
                      }}
                    >
                      Править
                    </Button>
                    {/* Причину по умолчанию удалять нельзя: сервер объяснит,
                        что она нужна как запасной вариант. */}
                    <Button
                      tone="ghost"
                      disabled={remove.isPending || category.isDefault}
                      onClick={() => void remove.mutateAsync(category.id).catch(() => undefined)}
                    >
                      Удалить
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}

        {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}

        {editing !== null && (
          <form
            className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-4"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await update.mutateAsync({
                  id: editing.id,
                  title: editTitle,
                  weight: Number(editWeight),
                });
                setEditing(null);
              } catch {
                // Ошибка показывается ниже.
              }
            }}
          >
            <Field label="Название">
              <TextInput
                required
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
              />
            </Field>
            <Field label="Вес" hint="1–5">
              <TextInput
                required
                inputMode="numeric"
                value={editWeight}
                onChange={(event) => setEditWeight(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={update.isPending}>
              Сохранить
            </Button>
            <Button tone="secondary" onClick={() => setEditing(null)}>
              Отмена
            </Button>
            {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
          </form>
        )}
      </div>
    </Card>
  );
}

/**
 * Звонки: сетка времени по номеру пары.
 *
 * Сетка различается между заведениями, поэтому живёт в справочнике, а не в коде.
 * При составлении расписания время подставляется по номеру пары, но остаётся
 * правимым — в отдельных случаях пара идёт в другое время.
 */
/**
 * Накопительные знаки: сколько плюсов и точек даёт оценку.
 *
 * Награда не настраивается: плюсы всегда дают «5», точки «2» — это правило
 * предметной области. Заведение решает, сколько знаков нужно и включён ли
 * пересчёт: пока выключено, знаки копятся, но оценки за них не появляются.
 */
function SignRulesCard() {
  const rules = useSignRules();
  const update = useUpdateSignRule();

  return (
    <Card
      title="Знаки: сколько нужно для оценки"
      description="Плюсы дают «5», точки дают «2». Пересчёт запускается вручную из журнала урока."
    >
      {rules.isLoading && <EmptyState>Загружаем…</EmptyState>}
      {rules.isError && <Alert tone="error">{errorMessage(rules.error)}</Alert>}

      {rules.data !== undefined && (
        <Table head={['Знак', 'Причина оценки', 'Сколько знаков', 'Пересчёт', '']}>
          {rules.data.items.map((rule) => (
            <tr key={rule.id} className="border-b border-slate-100">
              <td className="px-3 py-2 text-lg font-semibold">
                {rule.sign === 'plus' ? '+' : '·'}
              </td>
              <td className="px-3 py-2">
                {rule.categoryTitle}
                <span className="block text-xs text-slate-500">
                  выдаётся оценка «{rule.sign === 'plus' ? '5' : '2'}»
                </span>
              </td>
              <td className="px-3 py-2">
                <TextInput
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={String(rule.threshold)}
                  aria-label={`Сколько знаков для оценки (${rule.sign === 'plus' ? 'плюсы' : 'точки'})`}
                  onBlur={(event) => {
                    const threshold = Number(event.target.value);
                    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 20) return;
                    if (threshold === rule.threshold) return;

                    void update.mutateAsync({ sign: rule.sign, threshold }).catch(() => undefined);
                  }}
                />
              </td>
              <td className="px-3 py-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rule.isActive}
                    aria-label={`Пересчитывать ${rule.sign === 'plus' ? 'плюсы' : 'точки'} в оценки`}
                    onChange={(event) =>
                      void update
                        .mutateAsync({ sign: rule.sign, isActive: event.target.checked })
                        .catch(() => undefined)
                    }
                  />
                  {rule.isActive ? 'включён' : 'выключен'}
                </label>
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">порог меняется при уходе из поля</td>
            </tr>
          ))}
        </Table>
      )}

      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
    </Card>
  );
}

function BellsCard() {
  const bells = useBells();
  const save = useSaveBell();
  const remove = useDeleteBell();

  const [pairNumber, setPairNumber] = useState('1');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('');

  return (
    <Card
      title="Звонки"
      description="Время пары подставляется в расписание по номеру пары и остаётся правимым."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await save.mutateAsync({
              pairNumber: Number(pairNumber),
              timeStart,
              timeEnd,
              breakMinutes: breakMinutes === '' ? null : Number(breakMinutes),
            });
            setTimeStart('');
            setTimeEnd('');
            setBreakMinutes('');
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Пара">
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={pairNumber}
              onChange={(event) => setPairNumber(event.target.value)}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((number) => (
                <option key={number} value={String(number)}>
                  {number}-я пара
                </option>
              ))}
            </select>
          </Field>
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
          <Field label="Перемена, мин" hint="Необязательно">
            <TextInput
              inputMode="numeric"
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(event.target.value)}
            />
          </Field>
        </div>

        <div>
          <Button type="submit" disabled={save.isPending}>
            Сохранить звонок
          </Button>
        </div>

        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      </form>

      <div className="mt-4">
        {bells.data !== undefined && bells.data.items.length === 0 && (
          <EmptyState>
            Звонки не заполнены: при составлении расписания время придётся указывать вручную.
          </EmptyState>
        )}

        {bells.data !== undefined && bells.data.items.length > 0 && (
          <Table head={['Пара', 'Начало', 'Окончание', 'Перемена', '']}>
            {bells.data.items.map((bell) => (
              <tr key={bell.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{bell.pairNumber}-я</td>
                <td className="px-3 py-2">{bell.timeStart}</td>
                <td className="px-3 py-2">{bell.timeEnd}</td>
                <td className="px-3 py-2 text-slate-500">{bell.breakMinutes ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-2">
                    <Button
                      tone="ghost"
                      onClick={() => {
                        setPairNumber(String(bell.pairNumber));
                        setTimeStart(bell.timeStart);
                        setTimeEnd(bell.timeEnd);
                        setBreakMinutes(
                          bell.breakMinutes === null ? '' : String(bell.breakMinutes),
                        );
                      }}
                    >
                      Править
                    </Button>
                    <Button
                      tone="ghost"
                      disabled={remove.isPending}
                      onClick={() =>
                        void remove.mutateAsync(bell.pairNumber).catch(() => undefined)
                      }
                    >
                      Удалить
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}

        {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
      </div>
    </Card>
  );
}

export function CatalogsScreen() {
  return (
    <div className="flex flex-col gap-6">
      <SubjectsCard />
      <RoomsCard />
      <CategoriesCard />
      <SignRulesCard />
      <BellsCard />
    </div>
  );
}
