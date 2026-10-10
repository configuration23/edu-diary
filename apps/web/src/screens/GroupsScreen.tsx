import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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
  useAcademicYears,
  useCreateGroup,
  useEnrollStudent,
  useGroupEnrollments,
  useGroups,
  useStudents,
  useWithdrawStudent,
} from '../lib/queries';

/**
 * Группы, состав и зачисления.
 *
 * Группа привязана к учебному году, ученик — к группе с датами. Отчисление не
 * удаляет запись: она закрывается датой, и состав показывает историю.
 */

const groupFormSchema = z
  .object({
    name: z.string().min(1, 'Укажите название').max(60),
    course: z.string().optional(),
    specialty: z.string().max(120).optional(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат ГГГГ-ММ-ДД'),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат ГГГГ-ММ-ДД'),
  })
  .refine((values) => values.startsOn <= values.endsOn, {
    message: 'Дата начала позже даты окончания',
    path: ['endsOn'],
  });

function CreateGroupCard() {
  const years = useAcademicYears();
  const create = useCreateGroup();

  // Группа создаётся в активном году: выбор года в форме не нужен — активный год
  // один, и он же контекст всей работы (ARCHITECTURE.md §4.1).
  const activeYear = years.data?.items.find((year) => year.isActive) ?? null;

  const form = useForm<z.infer<typeof groupFormSchema>>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: { name: '', course: '', specialty: '', startsOn: '', endsOn: '' },
  });

  return (
    <Card
      title="Новая группа"
      description={
        activeYear === null
          ? 'Сначала создайте учебный год в разделе «Учебный год».'
          : `Группа войдёт в активный год ${activeYear.title} — с ${formatDate(activeYear.startsOn)} по ${formatDate(activeYear.endsOn)}.`
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          if (activeYear === null) return;
          try {
            await create.mutateAsync({
              academicYearId: activeYear.id,
              name: values.name,
              course:
                values.course === undefined || values.course === '' ? null : Number(values.course),
              specialty: values.specialty === '' ? null : (values.specialty ?? null),
              startsOn: values.startsOn,
              endsOn: values.endsOn,
            });
            form.reset({ name: '', course: '', specialty: '', startsOn: '', endsOn: '' });
          } catch {
            // Ошибка показывается ниже.
          }
        })}
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Название" error={form.formState.errors.name?.message}>
            <TextInput placeholder="ПКС-21" {...form.register('name')} />
          </Field>
          <Field label="Курс" hint="Необязательно" error={form.formState.errors.course?.message}>
            <TextInput inputMode="numeric" {...form.register('course')} />
          </Field>
          <Field label="Начало" error={form.formState.errors.startsOn?.message}>
            <TextInput type="date" {...form.register('startsOn')} />
          </Field>
          <Field label="Окончание" error={form.formState.errors.endsOn?.message}>
            <TextInput type="date" {...form.register('endsOn')} />
          </Field>
        </div>

        <Field label="Специальность" hint="Необязательно">
          <TextInput {...form.register('specialty')} />
        </Field>

        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}

        <div>
          <Button type="submit" disabled={create.isPending || activeYear === null}>
            Создать группу
          </Button>
        </div>
      </form>
    </Card>
  );
}

function EnrollForm({ groupId, groupName }: { groupId: string; groupName: string }) {
  const students = useStudents({ limit: 200 });
  const enroll = useEnrollStudent();
  const [studentId, setStudentId] = useState('');
  const [joinedOn, setJoinedOn] = useState('');

  return (
    <form
      className="flex flex-col gap-3 border-t border-slate-100 pt-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await enroll.mutateAsync({ groupId, studentId, joinedOn });
          setStudentId('');
          setJoinedOn('');
        } catch {
          // Ошибка показывается ниже.
        }
      }}
    >
      <p className="text-sm text-slate-600">
        Зачислить в «{groupName}»: дата должна попадать в период существования группы.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Ученик">
          <select
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
          >
            <option value="">— выберите —</option>
            {(students.data?.items ?? []).map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Дата зачисления">
          <TextInput
            required
            type="date"
            value={joinedOn}
            onChange={(event) => setJoinedOn(event.target.value)}
          />
        </Field>
        <div className="flex items-end pb-2">
          <Button type="submit" tone="secondary" disabled={enroll.isPending}>
            Зачислить
          </Button>
        </div>
      </div>

      {enroll.isError && <Alert tone="error">{errorMessage(enroll.error)}</Alert>}
    </form>
  );
}

function GroupComposition({ groupId, groupName }: { groupId: string; groupName: string }) {
  const enrollments = useGroupEnrollments(groupId);
  const withdraw = useWithdrawStudent();
  const [leftOn, setLeftOn] = useState('');

  const active = enrollments.data?.items.find((item) => item.leftOn === null);

  return (
    <Card title={`Состав группы «${groupName}»`} description="Отчисление закрывает запись датой.">
      {enrollments.isLoading && <p className="text-sm text-slate-500">Загружаем…</p>}
      {enrollments.isError && <Alert tone="error">{errorMessage(enrollments.error)}</Alert>}

      {enrollments.data !== undefined && enrollments.data.items.length === 0 && (
        <EmptyState>В группе пока никого нет.</EmptyState>
      )}

      {enrollments.data !== undefined && enrollments.data.items.length > 0 && (
        <Table head={['Ученик', 'Зачислен', 'Отчислен', 'Примечание']}>
          {enrollments.data.items.map((enrollment) => (
            <tr key={enrollment.id} className="border-b border-slate-100">
              <td className="px-3 py-2">{enrollment.studentName}</td>
              <td className="px-3 py-2">{formatDate(enrollment.joinedOn)}</td>
              <td className="px-3 py-2">
                {enrollment.leftOn === null ? (
                  <Badge tone="success">числится</Badge>
                ) : (
                  formatDate(enrollment.leftOn)
                )}
              </td>
              <td className="px-3 py-2 text-slate-500">{enrollment.note ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
        <Field label="Дата отчисления" hint="Для ученика, который числится сейчас">
          <TextInput
            type="date"
            value={leftOn}
            onChange={(event) => setLeftOn(event.target.value)}
          />
        </Field>
        <Button
          tone="secondary"
          disabled={withdraw.isPending || active === undefined}
          onClick={() => {
            if (active === undefined || leftOn === '') return;
            void withdraw.mutateAsync({ enrollmentId: active.id, leftOn });
          }}
        >
          {active === undefined ? 'Некого отчислять' : `Отчислить: ${active.studentName}`}
        </Button>
      </div>

      {withdraw.isError && <Alert tone="error">{errorMessage(withdraw.error)}</Alert>}

      <div className="mt-4">
        <EnrollForm groupId={groupId} groupName={groupName} />
      </div>
    </Card>
  );
}

export function GroupsScreen() {
  const [search, setSearch] = useState('');
  const groups = useGroups({ search: search === '' ? undefined : search });
  const [openGroup, setOpenGroup] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <CreateGroupCard />

      <Card
        title="Группы"
        description="Нажмите «Состав», чтобы зачислить учеников."
        actions={
          <TextInput
            placeholder="Поиск по названию"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="sm:w-64"
          />
        }
      >
        {groups.isLoading && <p className="text-sm text-slate-500">Загружаем…</p>}
        {groups.isError && <Alert tone="error">{errorMessage(groups.error)}</Alert>}

        {groups.data !== undefined && groups.data.items.length === 0 && (
          <EmptyState>Групп нет — создайте первую выше.</EmptyState>
        )}

        {groups.data !== undefined && groups.data.items.length > 0 && (
          <Table head={['Группа', 'Курс', 'Специальность', 'Даты', 'Учеников', '']}>
            {groups.data.items.map((group) => (
              <tr key={group.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{group.name}</td>
                <td className="px-3 py-2">{group.course ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{group.specialty ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">
                  {formatDate(group.startsOn)} — {formatDate(group.endsOn)}
                </td>
                <td className="px-3 py-2">{group.studentsCount}</td>
                <td className="px-3 py-2">
                  <Button
                    tone="secondary"
                    onClick={() => setOpenGroup({ id: group.id, name: group.name })}
                  >
                    Состав
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {openGroup !== null && <GroupComposition groupId={openGroup.id} groupName={openGroup.name} />}
    </div>
  );
}
