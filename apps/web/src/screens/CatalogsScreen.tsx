import { Fragment, useState } from 'react';

import type { BellScheduleDto, GradeCategoryDto, RoomDto, SubjectDto } from '@edu-diary/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  FormActions,
  Select,
  Table,
  TextInput,
} from '../components/ui';
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

/**
 * Правка предмета — в строке таблицы под самим предметом.
 *
 * Состояние полей живёт здесь: компонент монтируется для конкретного предмета и получает его
 * значения как начальные. Так не нужно ни синхронизировать пять состояний карточки, ни сбрасывать
 * их при переходе на другую строку.
 */
function SubjectEditForm({ subject, onDone }: { subject: SubjectDto; onDone: () => void }) {
  const update = useUpdateSubject();

  const [name, setName] = useState(subject.name);
  const [shortName, setShortName] = useState(subject.shortName ?? '');
  const [kind, setKind] = useState<'mandatory' | 'optional' | 'practice'>(
    subject.kind as 'mandatory' | 'optional' | 'practice',
  );
  const [color, setColor] = useState(subject.color ?? '');

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await update.mutateAsync({
            id: subject.id,
            name,
            shortName: shortName === '' ? null : shortName,
            kind,
            color: color === '' ? null : color,
          });
          onDone();
        } catch {
          // Ошибка показывается ниже из состояния запроса.
        }
      }}
    >
      <Field label="Название">
        <TextInput required value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Короткое имя" hint="Код для плиток расписания, 2–4 символа">
        <TextInput value={shortName} onChange={(event) => setShortName(event.target.value)} />
      </Field>
      <Field label="Вид">
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as 'mandatory' | 'optional' | 'practice')}
        >
          {SUBJECT_KINDS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Цвет" hint="Заливка плиток и маркер в строках">
        <span className="flex items-center gap-2">
          <input
            type="color"
            name="editColor"
            className="h-9 w-12 rounded border border-border"
            value={color === '' ? subjectColor(subject.id) : color}
            onChange={(event) => setColor(event.target.value)}
          />
          <Button tone="ghost" type="button" onClick={() => setColor('')}>
            Автоматически
          </Button>
        </span>
      </Field>
      <FormActions submitLabel="Сохранить" pending={update.isPending} onCancel={onDone} />
      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
    </form>
  );
}

function SubjectsCard() {
  /** Форма создания скрыта, пока её не позовут кнопкой: список важнее формы. */
  const [creating, setCreating] = useState(false);
  const subjects = useSubjects();
  const create = useCreateSubject();
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

  return (
    <Card
      title="Предметы"
      description="По предмету ставятся оценки и строятся назначения."
      actions={
        creating ? undefined : <Button onClick={() => setCreating(true)}>Добавить предмет</Button>
      }
    >
      {creating && (
        <>
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
                setCreating(false);
              } catch {
                // Ошибка показывается ниже.
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Название">
                <TextInput
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field
                label="Короткое имя"
                hint="Код для плиток расписания, 2–4 символа (необязательно)"
              >
                <TextInput
                  value={shortName}
                  onChange={(event) => setShortName(event.target.value)}
                />
              </Field>
              <Field label="Вид">
                <Select
                  className="rounded-md border border-border px-3 py-2 text-sm"
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
                </Select>
              </Field>
              <Field label="Цвет" hint="Пусто — подберём автоматически">
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    name="color"
                    className="h-9 w-12 rounded border border-border"
                    value={color === '' ? nextSubjectColor : color}
                    onChange={(event) => setColor(event.target.value)}
                  />
                  {color === '' && (
                    <span className="text-xs text-muted-foreground">по кругу оттенков</span>
                  )}
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
            <div className="mt-3">
              <Button tone="secondary" onClick={() => setCreating(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </>
      )}

      <div className="mt-4">
        {subjects.isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
        {subjects.isError && <Alert tone="error">{errorMessage(subjects.error)}</Alert>}

        {subjects.data !== undefined && subjects.data.items.length === 0 && (
          <EmptyState>Предметов пока нет.</EmptyState>
        )}

        {subjects.data !== undefined && subjects.data.items.length > 0 && (
          <Table head={['Предмет', 'Коротко', 'Вид', '']}>
            {subjects.data.items.map((subject) => (
              <Fragment key={subject.id}>
                <tr className="border-b border-border">
                  <td className="px-3 py-2 font-medium">
                    <SubjectDot subjectId={subject.id} color={subject.color} />
                    {subject.name}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{subject.shortName ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge>{subjectKindLabel(subject.kind)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-2">
                      <Button tone="ghost" onClick={() => setEditing(subject)}>
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

                {editing?.id === subject.id && (
                  <tr data-static className="border-b border-border">
                    <td colSpan={4} className="px-3 py-3">
                      <SubjectEditForm subject={editing} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </div>
    </Card>
  );
}

/** Правка аудитории — в строке таблицы под самой аудиторией. */
function RoomEditForm({ room, onDone }: { room: RoomDto; onDone: () => void }) {
  const update = useUpdateRoom();

  const [name, setName] = useState(room.name);
  const [capacity, setCapacity] = useState(room.capacity === null ? '' : String(room.capacity));
  const [note, setNote] = useState(room.note ?? '');

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await update.mutateAsync({
            id: room.id,
            name,
            capacity: capacity === '' ? null : Number(capacity),
            note: note === '' ? null : note,
          });
          onDone();
        } catch {
          // Ошибка показывается ниже из состояния запроса.
        }
      }}
    >
      <Field label="Название">
        <TextInput required value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Вместимость">
        <TextInput
          inputMode="numeric"
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
        />
      </Field>
      <Field label="Примечание">
        <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <FormActions submitLabel="Сохранить" pending={update.isPending} onCancel={onDone} />
      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
    </form>
  );
}

function RoomsCard() {
  /** Форма создания скрыта, пока её не позовут кнопкой: список важнее формы. */
  const [creating, setCreating] = useState(false);
  const rooms = useRooms();
  const create = useCreateRoom();
  const remove = useDeleteRoom();

  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<RoomDto | null>(null);

  return (
    <Card
      title="Аудитории"
      description="Аудитория указывается в уроке расписания."
      actions={
        creating ? undefined : <Button onClick={() => setCreating(true)}>Добавить аудиторию</Button>
      }
    >
      {creating && (
        <>
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
                setCreating(false);
              } catch {
                // Ошибка показывается ниже.
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Название">
                <TextInput
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
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
            <div className="mt-3">
              <Button tone="secondary" onClick={() => setCreating(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </>
      )}

      <div className="mt-4">
        {rooms.data !== undefined && rooms.data.items.length === 0 && (
          <EmptyState>Аудиторий пока нет.</EmptyState>
        )}

        {rooms.data !== undefined && rooms.data.items.length > 0 && (
          <Table head={['Аудитория', 'Вместимость', 'Примечание', '']}>
            {rooms.data.items.map((room) => (
              <Fragment key={room.id}>
                <tr className="border-b border-border">
                  <td className="px-3 py-2 font-medium">{room.name}</td>
                  <td className="px-3 py-2">{room.capacity ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{room.note ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-2">
                      <Button tone="ghost" onClick={() => setEditing(room)}>
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

                {editing?.id === room.id && (
                  <tr data-static className="border-b border-border">
                    <td colSpan={4} className="px-3 py-3">
                      <RoomEditForm room={editing} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}

        {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
      </div>
    </Card>
  );
}

/** Правка причины оценки — в строке таблицы под самой причиной. */
function CategoryEditForm({
  category,
  onDone,
}: {
  category: GradeCategoryDto;
  onDone: () => void;
}) {
  const update = useUpdateGradeCategory();

  const [title, setTitle] = useState(category.title);
  const [weight, setWeight] = useState(String(category.weight));

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await update.mutateAsync({ id: category.id, title, weight: Number(weight) });
          onDone();
        } catch {
          // Ошибка показывается ниже из состояния запроса.
        }
      }}
    >
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
      <FormActions submitLabel="Сохранить" pending={update.isPending} onCancel={onDone} />
      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
    </form>
  );
}

function CategoriesCard() {
  /** Форма создания скрыта, пока её не позовут кнопкой: список важнее формы. */
  const [creating, setCreating] = useState(false);
  const categories = useGradeCategories();
  const create = useCreateGradeCategory();
  const remove = useDeleteGradeCategory();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [weight, setWeight] = useState('1');
  const [editing, setEditing] = useState<GradeCategoryDto | null>(null);

  return (
    <Card
      title="Причины оценок"
      description="Причина обязательна при выставлении оценки и задаёт её вес в среднем балле."
      actions={
        creating ? undefined : <Button onClick={() => setCreating(true)}>Добавить причину</Button>
      }
    >
      {creating && (
        <>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await create.mutateAsync({ code, title, weight: Number(weight) });
                setCode('');
                setTitle('');
                setWeight('1');
                setCreating(false);
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
                <TextInput
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
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
            <div className="mt-3">
              <Button tone="secondary" onClick={() => setCreating(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </>
      )}

      <div className="mt-4">
        {categories.data !== undefined && categories.data.items.length === 0 && (
          <EmptyState>Причин пока нет.</EmptyState>
        )}

        {categories.data !== undefined && categories.data.items.length > 0 && (
          <Table head={['Код', 'Название', 'Вес', '', '']}>
            {categories.data.items.map((category) => (
              <Fragment key={category.id}>
                <tr className="border-b border-border">
                  <td className="px-3 py-2 font-mono text-xs">{category.code}</td>
                  <td className="px-3 py-2">{category.title}</td>
                  <td className="px-3 py-2">{category.weight}</td>
                  <td className="px-3 py-2">
                    {category.isDefault && <Badge tone="success">по умолчанию</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-2">
                      <Button tone="ghost" onClick={() => setEditing(category)}>
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

                {editing?.id === category.id && (
                  <tr data-static className="border-b border-border">
                    <td colSpan={5} className="px-3 py-3">
                      <CategoryEditForm category={editing} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}

        {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
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
            <tr key={rule.id} className="border-b border-border">
              <td className="px-3 py-2 text-lg font-semibold">
                {rule.sign === 'plus' ? '+' : '·'}
              </td>
              <td className="px-3 py-2">
                {rule.categoryTitle}
                <span className="block text-xs text-muted-foreground">
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
                <Checkbox
                  checked={rule.isActive}
                  aria-label={`Пересчитывать ${rule.sign === 'plus' ? 'плюсы' : 'точки'} в оценки`}
                  onChange={(event) =>
                    void update
                      .mutateAsync({ sign: rule.sign, isActive: event.target.checked })
                      .catch(() => undefined)
                  }
                  label={rule.isActive ? 'включён' : 'выключен'}
                />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                порог меняется при уходе из поля
              </td>
            </tr>
          ))}
        </Table>
      )}

      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
    </Card>
  );
}

/** Правка звонка — в строке таблицы под самой парой. */
function BellEditForm({ bell, onDone }: { bell: BellScheduleDto; onDone: () => void }) {
  const save = useSaveBell();

  const [timeStart, setTimeStart] = useState(bell.timeStart);
  const [timeEnd, setTimeEnd] = useState(bell.timeEnd);
  const [breakMinutes, setBreakMinutes] = useState(
    bell.breakMinutes === null ? '' : String(bell.breakMinutes),
  );

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await save.mutateAsync({
            pairNumber: bell.pairNumber,
            timeStart,
            timeEnd,
            breakMinutes: breakMinutes === '' ? null : Number(breakMinutes),
          });
          onDone();
        } catch {
          // Ошибка показывается ниже из состояния запроса.
        }
      }}
    >
      <Field label="Начало">
        <TextInput
          required
          inputMode="numeric"
          placeholder="08:30"
          value={timeStart}
          onChange={(event) => setTimeStart(event.target.value)}
        />
      </Field>
      <Field label="Окончание">
        <TextInput
          required
          inputMode="numeric"
          placeholder="10:00"
          value={timeEnd}
          onChange={(event) => setTimeEnd(event.target.value)}
        />
      </Field>
      <Field label="Перемена" hint="Минуты, необязательно">
        <TextInput
          inputMode="numeric"
          value={breakMinutes}
          onChange={(event) => setBreakMinutes(event.target.value)}
        />
      </Field>
      <FormActions submitLabel="Сохранить" pending={save.isPending} onCancel={onDone} />
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
    </form>
  );
}

function BellsCard() {
  /** Форма создания скрыта, пока её не позовут кнопкой: список важнее формы. */
  const [creating, setCreating] = useState(false);
  /** Пара, которую правим: её форма показывается строкой в таблице. */
  const [editing, setEditing] = useState<BellScheduleDto | null>(null);
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
      actions={
        creating ? undefined : <Button onClick={() => setCreating(true)}>Добавить звонок</Button>
      }
    >
      {creating && (
        <>
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
                setCreating(false);
              } catch {
                // Ошибка показывается ниже.
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Пара">
                <Select
                  className="rounded-md border border-border px-3 py-2 text-sm"
                  value={pairNumber}
                  onChange={(event) => setPairNumber(event.target.value)}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((number) => (
                    <option key={number} value={String(number)}>
                      {number}-я пара
                    </option>
                  ))}
                </Select>
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
            <div className="mt-3">
              <Button tone="secondary" onClick={() => setCreating(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </>
      )}

      <div className="mt-4">
        {bells.data !== undefined && bells.data.items.length === 0 && (
          <EmptyState>
            Звонки не заполнены: при составлении расписания время придётся указывать вручную.
          </EmptyState>
        )}

        {bells.data !== undefined && bells.data.items.length > 0 && (
          <Table head={['Пара', 'Начало', 'Окончание', 'Перемена', '']}>
            {bells.data.items.map((bell) => (
              <Fragment key={bell.id}>
                <tr className="border-b border-border">
                  <td className="px-3 py-2 font-medium">{bell.pairNumber}-я</td>
                  <td className="px-3 py-2">{bell.timeStart}</td>
                  <td className="px-3 py-2">{bell.timeEnd}</td>
                  <td className="px-3 py-2 text-muted-foreground">{bell.breakMinutes ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-2">
                      <Button tone="ghost" onClick={() => setEditing(bell)}>
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

                {editing?.pairNumber === bell.pairNumber && (
                  <tr data-static className="border-b border-border">
                    <td colSpan={5} className="px-3 py-3">
                      <BellEditForm bell={editing} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
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
