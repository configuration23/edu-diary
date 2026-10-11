import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { requiredISODateSchema } from '@edu-diary/contracts';
import type { StudyGroupDto } from '@edu-diary/contracts';
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
  useDeleteGroup,
  useEnrollStudent,
  useGroupEnrollments,
  useGroups,
  useStudents,
  useUpdateGroup,
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
    startsOn: requiredISODateSchema,
    endsOn: requiredISODateSchema,
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

      {students.data !== undefined && students.data.items.length === 0 && (
        <Alert tone="warning">
          Учеников ещё нет — заведите их в разделе{' '}
          <Link to="/users" className="underline">
            Пользователи и роли
          </Link>{' '}
          (блок «Новый ученик»).
        </Alert>
      )}

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
  const [withdrawFor, setWithdrawFor] = useState<string | null>(null);
  const [leftOn, setLeftOn] = useState('');

  return (
    <Card title={`Состав группы «${groupName}»`} description="Отчисление закрывает запись датой.">
      {/* Порядок как в работе: сначала зачисляем, потом смотрим список и
          отчисляем по конкретному ученику. */}
      <EnrollForm groupId={groupId} groupName={groupName} />

      <div className="mt-4 border-t border-slate-100 pt-4">
        {enrollments.isLoading && <p className="text-sm text-slate-500">Загружаем…</p>}
        {enrollments.isError && <Alert tone="error">{errorMessage(enrollments.error)}</Alert>}

        {enrollments.data !== undefined && enrollments.data.items.length === 0 && (
          <EmptyState>В группе пока никого нет.</EmptyState>
        )}

        {enrollments.data !== undefined && enrollments.data.items.length > 0 && (
          <Table head={['Ученик', 'Зачислен', 'Состояние', 'Примечание', '']}>
            {enrollments.data.items.map((enrollment) => (
              <tr key={enrollment.id} className="border-b border-slate-100">
                <td className="px-3 py-2">{enrollment.studentName}</td>
                <td className="px-3 py-2">{formatDate(enrollment.joinedOn)}</td>
                <td className="px-3 py-2">
                  {enrollment.leftOn === null ? (
                    <Badge tone="success">числится</Badge>
                  ) : (
                    <span className="text-slate-500">отчислен {formatDate(enrollment.leftOn)}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{enrollment.note ?? '—'}</td>
                <td className="px-3 py-2">
                  {enrollment.leftOn === null && (
                    <Button tone="ghost" onClick={() => setWithdrawFor(enrollment.id)}>
                      Отчислить
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}

        {withdrawFor !== null && (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-4">
            <Field label="Дата отчисления" hint="Закроет зачисление, история останется">
              <TextInput
                type="date"
                value={leftOn}
                onChange={(event) => setLeftOn(event.target.value)}
              />
            </Field>
            <Button
              tone="secondary"
              disabled={withdraw.isPending || leftOn === ''}
              onClick={() => {
                void withdraw.mutateAsync({ enrollmentId: withdrawFor, leftOn });
                setWithdrawFor(null);
                setLeftOn('');
              }}
            >
              Отчислить
            </Button>
            <Button tone="secondary" onClick={() => setWithdrawFor(null)}>
              Отмена
            </Button>
          </div>
        )}

        {withdraw.isError && <Alert tone="error">{errorMessage(withdraw.error)}</Alert>}
      </div>
    </Card>
  );
}

/**
 * Правка группы: название, курс, специальность и границы периода.
 *
 * Учебный год не меняется: группа принадлежит году, и перенос означал бы другую
 * группу — для этого её создают заново.
 */
function EditGroupForm({
  group,
  onDone,
}: {
  group: StudyGroupDto;
  onDone: (message: string) => void;
}) {
  const update = useUpdateGroup();
  const form = useForm<z.infer<typeof groupFormSchema>>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: {
      name: group.name,
      course: group.course === null ? '' : String(group.course),
      specialty: group.specialty ?? '',
      startsOn: group.startsOn,
      endsOn: group.endsOn,
    },
  });

  return (
    <form
      className="mt-4 flex flex-col gap-4 rounded-md border border-slate-200 p-4"
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await update.mutateAsync({
            id: group.id,
            name: values.name.trim(),
            course:
              values.course === undefined || values.course === '' ? null : Number(values.course),
            specialty: values.specialty === '' ? null : (values.specialty ?? null),
            startsOn: values.startsOn,
            endsOn: values.endsOn,
          });
          onDone(`Группа «${values.name.trim()}» сохранена.`);
        } catch {
          // Ошибка показывается ниже.
        }
      })}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Название" error={form.formState.errors.name?.message}>
          <TextInput {...form.register('name')} />
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

      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}

      <div className="flex gap-2">
        <Button type="submit" disabled={update.isPending}>
          Сохранить
        </Button>
        <Button tone="secondary" onClick={() => onDone('')}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

export function GroupsScreen() {
  const [search, setSearch] = useState('');
  const groups = useGroups({ search: search === '' ? undefined : search });
  const [openGroup, setOpenGroup] = useState<{ id: string; name: string } | null>(null);
  const [editingGroup, setEditingGroup] = useState<StudyGroupDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const removeGroup = useDeleteGroup();

  return (
    <div className="flex flex-col gap-6">
      <CreateGroupCard />

      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {removeGroup.isError && <Alert tone="error">{errorMessage(removeGroup.error)}</Alert>}

      <Card
        title="Группы"
        description="«Состав» — зачисление и отчисление, «Править» — название и период."
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
                  <span className="flex flex-wrap gap-2">
                    <Button
                      tone="secondary"
                      onClick={() => setOpenGroup({ id: group.id, name: group.name })}
                    >
                      Состав
                    </Button>
                    <Button tone="ghost" onClick={() => setEditingGroup(group)}>
                      Править
                    </Button>
                    {/* Удалять можно только пустую группу: непустую сервер
                        отклонит с объяснением, что именно на неё ссылается. */}
                    <Button
                      tone="ghost"
                      disabled={removeGroup.isPending || group.studentsCount > 0}
                      onClick={() => {
                        setNotice(null);
                        void removeGroup
                          .mutateAsync(group.id)
                          .then(() => setNotice(`Группа «${group.name}» удалена.`))
                          .catch(() => setNotice(null));
                      }}
                    >
                      Удалить
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}

        {editingGroup !== null && (
          <EditGroupForm
            group={editingGroup}
            onDone={(message) => {
              setEditingGroup(null);
              if (message !== '') setNotice(message);
            }}
          />
        )}
      </Card>

      {openGroup !== null && <GroupComposition groupId={openGroup.id} groupName={openGroup.name} />}
    </div>
  );
}
