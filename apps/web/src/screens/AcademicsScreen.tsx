import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { AcademicYearDto, PeriodDto } from '@edu-diary/contracts';
import { requiredISODateSchema } from '@edu-diary/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Table,
  TextInput,
  formatDate,
} from '../components/ui';
import { errorMessage } from '../lib/api-client';
import {
  useAcademicYear,
  useAcademicYears,
  useActivateAcademicYear,
  useCreateAcademicYear,
  useCreatePeriod,
  useDeletePeriod,
  useUpdateAcademicYear,
  useUpdatePeriod,
} from '../lib/queries';

/**
 * Учебные годы и периоды.
 *
 * Активный год ровно один: он подсвечен, а «Сделать активным» выключает
 * остальные на сервере. Периоды правятся внутри выбранного года, потому что
 * сервер проверяет их границы относительно года.
 */

const yearFormSchema = z
  .object({
    title: z.string().min(1, 'Укажите название').max(60),
    startsOn: requiredISODateSchema,
    endsOn: requiredISODateSchema,
    isActive: z.boolean(),
  })
  .refine((values) => values.startsOn <= values.endsOn, {
    message: 'Дата начала позже даты окончания',
    path: ['endsOn'],
  });

const periodFormSchema = z
  .object({
    title: z.string().min(1, 'Укажите название').max(60),
    kind: z.enum(['term', 'semester', 'quarter']),
    startsOn: requiredISODateSchema,
    endsOn: requiredISODateSchema,
  })
  .refine((values) => values.startsOn <= values.endsOn, {
    message: 'Дата начала позже даты окончания',
    path: ['endsOn'],
  });

const PERIOD_KINDS: Array<{ value: 'term' | 'semester' | 'quarter'; label: string }> = [
  { value: 'semester', label: 'Семестр' },
  { value: 'term', label: 'Триместр' },
  { value: 'quarter', label: 'Четверть' },
];

function kindLabel(kind: string): string {
  return PERIOD_KINDS.find((item) => item.value === kind)?.label ?? kind;
}

function CreateYearCard({ onDone }: { onDone: () => void }) {
  const create = useCreateAcademicYear();
  const form = useForm<z.infer<typeof yearFormSchema>>({
    resolver: zodResolver(yearFormSchema),
    defaultValues: { title: '', startsOn: '', endsOn: '', isActive: false },
  });

  return (
    <Card title="Новый учебный год" description="Даты периода задают границы для групп.">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await create.mutateAsync(values);
            form.reset({ title: '', startsOn: '', endsOn: '', isActive: false });
            /** Закрываем форму: после создания человеку нужен список, а не пустая форма. */
            onDone();
          } catch {
            // Ошибка показывается ниже из состояния запроса.
          }
        })}
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Название" error={form.formState.errors.title?.message}>
            <TextInput placeholder="2026/2027" {...form.register('title')} />
          </Field>
          <Field label="Начало" error={form.formState.errors.startsOn?.message}>
            <TextInput type="date" {...form.register('startsOn')} />
          </Field>
          <Field label="Окончание" error={form.formState.errors.endsOn?.message}>
            <TextInput type="date" {...form.register('endsOn')} />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" {...form.register('isActive')} />
            Сделать активным
          </label>
        </div>

        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={create.isPending}>
            Создать год
          </Button>
          <Button tone="secondary" onClick={onDone}>
            Отмена
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AddPeriodCard({ year }: { year: AcademicYearDto }) {
  const create = useCreatePeriod();
  const form = useForm<z.infer<typeof periodFormSchema>>({
    resolver: zodResolver(periodFormSchema),
    defaultValues: {
      title: '',
      kind: 'semester',
      startsOn: year.startsOn,
      endsOn: year.endsOn,
    },
  });

  return (
    <form
      className="flex flex-col gap-3 border-t border-slate-100 pt-4"
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await create.mutateAsync({ academicYearId: year.id, ...values });
          form.reset({
            title: '',
            kind: 'semester',
            startsOn: year.startsOn,
            endsOn: year.endsOn,
          });
        } catch {
          // Ошибка показывается ниже.
        }
      })}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Период" error={form.formState.errors.title?.message}>
          <TextInput placeholder="1 семестр" {...form.register('title')} />
        </Field>
        <Field label="Тип">
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            {...form.register('kind')}
          >
            {PERIOD_KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Начало" error={form.formState.errors.startsOn?.message}>
          <TextInput type="date" {...form.register('startsOn')} />
        </Field>
        <Field label="Окончание" error={form.formState.errors.endsOn?.message}>
          <TextInput type="date" {...form.register('endsOn')} />
        </Field>
      </div>

      {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}

      <div>
        <Button type="submit" tone="secondary" disabled={create.isPending}>
          Добавить период
        </Button>
      </div>
    </form>
  );
}

function YearDetails({ yearId, onClose }: { yearId: string; onClose: () => void }) {
  const detail = useAcademicYear(yearId);
  const update = useUpdatePeriod();
  const remove = useDeletePeriod();
  const [editing, setEditing] = useState<PeriodDto | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editStartsOn, setEditStartsOn] = useState('');
  const [editEndsOn, setEditEndsOn] = useState('');

  if (detail.isLoading) return <p className="text-sm text-slate-500">Загружаем год…</p>;
  if (detail.isError || detail.data === undefined) {
    return <Alert tone="error">{errorMessage(detail.error)}</Alert>;
  }

  const year = detail.data;

  return (
    <Card
      title={`Год ${year.title}`}
      description={`Границы: ${formatDate(year.startsOn)} — ${formatDate(year.endsOn)}`}
      actions={
        <Button tone="secondary" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      {year.periods.length === 0 ? (
        <EmptyState>Периодов пока нет — добавьте первый.</EmptyState>
      ) : (
        <>
          <Table head={['Период', 'Тип', 'Начало', 'Окончание', '']}>
            {year.periods.map((period: PeriodDto) => (
              <tr key={period.id} className="border-b border-slate-100">
                <td className="px-3 py-2">{period.title}</td>
                <td className="px-3 py-2 text-slate-600">{kindLabel(period.kind)}</td>
                <td className="px-3 py-2">{formatDate(period.startsOn)}</td>
                <td className="px-3 py-2">{formatDate(period.endsOn)}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-2">
                    <Button
                      tone="ghost"
                      onClick={() => {
                        setEditing(period);
                        setEditTitle(period.title);
                        setEditStartsOn(period.startsOn);
                        setEditEndsOn(period.endsOn);
                      }}
                    >
                      Править
                    </Button>
                    <Button
                      tone="ghost"
                      disabled={remove.isPending}
                      onClick={() => void remove.mutateAsync(period.id).catch(() => undefined)}
                    >
                      Удалить
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </Table>

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
                    startsOn: editStartsOn,
                    endsOn: editEndsOn,
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
              <Field label="Начало">
                <TextInput
                  required
                  type="date"
                  value={editStartsOn}
                  onChange={(event) => setEditStartsOn(event.target.value)}
                />
              </Field>
              <Field label="Окончание">
                <TextInput
                  required
                  type="date"
                  value={editEndsOn}
                  onChange={(event) => setEditEndsOn(event.target.value)}
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
        </>
      )}

      <div className="mt-4">
        <AddPeriodCard year={year} />
      </div>
    </Card>
  );
}

/**
 * Правка года: название и границы. Активность меняется отдельной кнопкой —
 * «активный» это состояние года, а не поле формы.
 */
function EditYearForm({
  year,
  onDone,
}: {
  year: AcademicYearDto;
  onDone: (message: string) => void;
}) {
  const update = useUpdateAcademicYear();
  const form = useForm<z.infer<typeof yearFormSchema>>({
    resolver: zodResolver(yearFormSchema),
    defaultValues: {
      title: year.title,
      startsOn: year.startsOn,
      endsOn: year.endsOn,
      isActive: year.isActive,
    },
  });

  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-4"
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await update.mutateAsync({
            id: year.id,
            title: values.title.trim(),
            startsOn: values.startsOn,
            endsOn: values.endsOn,
          });
          onDone(`Год «${values.title.trim()}» сохранён.`);
        } catch {
          // Ошибка показывается ниже.
        }
      })}
    >
      <Field label="Название" error={form.formState.errors.title?.message}>
        <TextInput {...form.register('title')} />
      </Field>
      <Field label="Начало" error={form.formState.errors.startsOn?.message}>
        <TextInput type="date" {...form.register('startsOn')} />
      </Field>
      <Field label="Окончание" error={form.formState.errors.endsOn?.message}>
        <TextInput type="date" {...form.register('endsOn')} />
      </Field>
      <Button type="submit" disabled={update.isPending}>
        Сохранить
      </Button>
      <Button tone="secondary" onClick={() => onDone('')}>
        Отмена
      </Button>
      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
    </form>
  );
}

export function AcademicsScreen() {
  const years = useAcademicYears();
  const activate = useActivateAcademicYear();
  const [openYearId, setOpenYearId] = useState<string | null>(null);
  const [editingYear, setEditingYear] = useState<AcademicYearDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Форма создания года скрыта, пока её не позовут кнопкой: список важнее формы. */
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/*
        Форма — **над списком** и только по кнопке (просьба владельца). Так первый экран занят тем,
        ради чего страницу открывают: самими годами.
      */}
      {creating && <CreateYearCard onDone={() => setCreating(false)} />}

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {activate.isError && <Alert tone="error">{errorMessage(activate.error)}</Alert>}

      <Card
        title="Учебные годы"
        description="Активный год один: на него ориентируются группы и назначения."
        actions={
          /**
           * Скрыта, пока форма открыта: у самой формы есть «создать» и «отмена», а две одинаковые
           * кнопки на экране путают — этим и попался сквозной сценарий.
           */
          creating ? undefined : <Button onClick={() => setCreating(true)}>Создать год</Button>
        }
      >
        {years.isLoading && <p className="text-sm text-slate-500">Загружаем…</p>}
        {years.isError && <Alert tone="error">{errorMessage(years.error)}</Alert>}

        {years.data !== undefined && years.data.items.length === 0 && (
          <EmptyState>Учебных годов пока нет — создайте первый выше.</EmptyState>
        )}

        {years.data !== undefined && years.data.items.length > 0 && (
          <Table head={['Год', 'Начало', 'Окончание', 'Состояние', '']}>
            {years.data.items.map((year) => (
              <tr key={year.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{year.title}</td>
                <td className="px-3 py-2">{formatDate(year.startsOn)}</td>
                <td className="px-3 py-2">{formatDate(year.endsOn)}</td>
                <td className="px-3 py-2">
                  {year.isActive ? <Badge tone="success">активный</Badge> : <Badge>обычный</Badge>}
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-2">
                    <Button tone="secondary" onClick={() => setOpenYearId(year.id)}>
                      Периоды
                    </Button>
                    <Button tone="ghost" onClick={() => setEditingYear(year)}>
                      Править
                    </Button>
                    {!year.isActive && (
                      <Button
                        tone="ghost"
                        disabled={activate.isPending}
                        onClick={() => void activate.mutateAsync(year.id)}
                      >
                        Сделать активным
                      </Button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}

        {editingYear !== null && (
          <EditYearForm
            year={editingYear}
            onDone={(message) => {
              setEditingYear(null);
              if (message !== '') setNotice(message);
            }}
          />
        )}
      </Card>

      {openYearId !== null && (
        <YearDetails yearId={openYearId} onClose={() => setOpenYearId(null)} />
      )}
    </div>
  );
}
