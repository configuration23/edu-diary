import { useState } from 'react';

import { Alert, Badge, Button, Card, EmptyState, Field, Table, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api-client';
import {
  useCreateGradeCategory,
  useCreateRoom,
  useCreateSubject,
  useDeleteSubject,
  useGradeCategories,
  useRooms,
  useSubjects,
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
  const remove = useDeleteSubject();

  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [kind, setKind] = useState<'mandatory' | 'optional' | 'practice'>('mandatory');

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
            });
            setName('');
            setShortName('');
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Название">
            <TextInput required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Короткое имя" hint="Для журнала">
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
                <td className="px-3 py-2 font-medium">{subject.name}</td>
                <td className="px-3 py-2 text-slate-600">{subject.shortName ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge>{subjectKindLabel(subject.kind)}</Badge>
                </td>
                <td className="px-3 py-2">
                  <Button
                    tone="ghost"
                    disabled={remove.isPending}
                    onClick={() => void remove.mutateAsync(subject.id)}
                  >
                    Удалить
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Card>
  );
}

function RoomsCard() {
  const rooms = useRooms();
  const create = useCreateRoom();
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');

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
            });
            setName('');
            setCapacity('');
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
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
          <Table head={['Аудитория', 'Вместимость', 'Примечание']}>
            {rooms.data.items.map((room) => (
              <tr key={room.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{room.name}</td>
                <td className="px-3 py-2">{room.capacity ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{room.note ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Card>
  );
}

function CategoriesCard() {
  const categories = useGradeCategories();
  const create = useCreateGradeCategory();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [weight, setWeight] = useState('1');

  return (
    <Card
      title="Категории оценок"
      description="Вес учитывается в среднем балле: контрольная весит больше ответа у доски."
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
          <Field label="Код" hint="Латиницей: test, project">
            <TextInput
              required
              pattern="[a-z][a-z0-9_]*"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <Field label="Название">
            <TextInput required value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Вес" hint="1–10">
            <TextInput
              required
              inputMode="numeric"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
            />
          </Field>
          <div className="flex items-end pb-2">
            <Button type="submit" disabled={create.isPending}>
              Добавить категорию
            </Button>
          </div>
        </div>

        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
      </form>

      <div className="mt-4">
        {categories.data !== undefined && categories.data.items.length === 0 && (
          <EmptyState>Категорий пока нет.</EmptyState>
        )}

        {categories.data !== undefined && categories.data.items.length > 0 && (
          <Table head={['Код', 'Название', 'Вес', '']}>
            {categories.data.items.map((category) => (
              <tr key={category.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{category.code}</td>
                <td className="px-3 py-2">{category.title}</td>
                <td className="px-3 py-2">{category.weight}</td>
                <td className="px-3 py-2">
                  {category.isDefault && <Badge tone="success">по умолчанию</Badge>}
                </td>
              </tr>
            ))}
          </Table>
        )}
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
    </div>
  );
}
