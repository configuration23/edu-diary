import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { requiredISODateSchema } from '@edu-diary/contracts';
import type { StudyGroupDto } from '@edu-diary/contracts';
import { StudentsCard } from './StudentsCard';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  formatDate,
  Select,
  Table,
  TextInput,
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

function CreateGroupCard({ onDone }: { onDone: () => void }) {
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
            /** Форму закрываем: дальше человек работает со списком групп. */
            onDone();
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

        {/*
          «Отмена» обязательна: форма открывается кнопкой, и без неё единственный способ её закрыть —
          создать группу или перезагрузить страницу. Владелец это заметил.
        */}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={create.isPending || activeYear === null}>
            Создать группу
          </Button>
          <Button tone="secondary" onClick={onDone}>
            Отмена
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
  const [note, setNote] = useState('');

  return (
    <form
      className="flex flex-col gap-3 border-t border-border pt-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await enroll.mutateAsync({
            groupId,
            studentId,
            joinedOn,
            note: note === '' ? null : note,
          });
          setStudentId('');
          setJoinedOn('');
          setNote('');
        } catch {
          // Ошибка показывается ниже.
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        Зачислить в «{groupName}»: дата должна попадать в период существования группы.
      </p>

      {students.data !== undefined && students.data.items.length === 0 && (
        <Alert tone="warning">
          Учеников ещё нет — заведите их блоком «Новый ученик» выше на этой странице.
        </Alert>
      )}

      {/* Сетка из трёх полей: примечание идёт отдельной строкой, иначе в узкой
          колонке подпись и поле наезжают друг на друга. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ученик">
          <Select
            required
            className="rounded-md border border-border px-3 py-2 text-sm"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
          >
            <option value="">— выберите —</option>
            {(students.data?.items ?? []).map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Дата зачисления">
          <TextInput
            required
            type="date"
            value={joinedOn}
            onChange={(event) => setJoinedOn(event.target.value)}
          />
        </Field>
      </div>

      <Field label="Примечание" hint="Необязательно: основание, документ">
        <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>

      <div>
        <Button type="submit" tone="secondary" disabled={enroll.isPending}>
          Зачислить
        </Button>
      </div>

      {enroll.isError && <Alert tone="error">{errorMessage(enroll.error)}</Alert>}
    </form>
  );
}

function GroupComposition({
  groupId,
  groupName,
  onClose,
}: {
  groupId: string;
  groupName: string;
  onClose: () => void;
}) {
  const enrollments = useGroupEnrollments(groupId);
  const withdraw = useWithdrawStudent();
  const [withdrawFor, setWithdrawFor] = useState<string | null>(null);
  const [leftOn, setLeftOn] = useState('');
  const [leftNote, setLeftNote] = useState('');

  return (
    <Card title={`Состав группы «${groupName}»`} description="Отчисление закрывает запись датой.">
      {/* Кнопка закрытия: раньше состав открывался только повторным нажатием
          на «Состав», и это было неочевидно. */}
      <div className="flex justify-end">
        <Button tone="ghost" type="button" onClick={onClose}>
          Закрыть состав
        </Button>
      </div>

      {/* Порядок как в работе: сначала зачисляем, потом смотрим список и
          отчисляем по конкретному ученику. */}
      <EnrollForm groupId={groupId} groupName={groupName} />

      <div className="mt-4 border-t border-border pt-4">
        {enrollments.isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
        {enrollments.isError && <Alert tone="error">{errorMessage(enrollments.error)}</Alert>}

        {enrollments.data !== undefined && enrollments.data.items.length === 0 && (
          <EmptyState>В группе пока никого нет.</EmptyState>
        )}

        {enrollments.data !== undefined && enrollments.data.items.length > 0 && (
          <Table head={['Ученик', 'Зачислен', 'Состояние', 'Примечание', '']}>
            {enrollments.data.items.map((enrollment) => (
              <tr key={enrollment.id} className="border-b border-border">
                <td className="px-3 py-2">{enrollment.studentName}</td>
                <td className="px-3 py-2">{formatDate(enrollment.joinedOn)}</td>
                <td className="px-3 py-2">
                  {enrollment.leftOn === null ? (
                    <Badge tone="success">числится</Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      отчислен {formatDate(enrollment.leftOn)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{enrollment.note ?? '—'}</td>
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
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-border p-4">
            <Field label="Дата отчисления" hint="Закроет зачисление, история останется">
              <TextInput
                type="date"
                value={leftOn}
                onChange={(event) => setLeftOn(event.target.value)}
              />
            </Field>
            <Field label="Примечание" hint="Необязательно: причина отчисления">
              <TextInput value={leftNote} onChange={(event) => setLeftNote(event.target.value)} />
            </Field>
            <Button
              tone="secondary"
              disabled={withdraw.isPending || leftOn === ''}
              onClick={() => {
                void withdraw.mutateAsync({
                  enrollmentId: withdrawFor,
                  leftOn,
                  note: leftNote === '' ? null : leftNote,
                });
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
      className="mt-4 flex flex-col gap-4 rounded-md border border-border p-4"
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

export function GroupsScreen({ canManageStudents = false }: { canManageStudents?: boolean }) {
  /**
   * Поиска по названию больше нет: в шапке блока «Группы» теперь кнопка «Создать группу» (решение
   * владельца). Список групп короткий, и поиск занимал место без пользы.
   */
  const groups = useGroups();
  const [openGroup, setOpenGroup] = useState<{ id: string; name: string } | null>(null);
  const [editingGroup, setEditingGroup] = useState<StudyGroupDto | null>(null);
  // Два независимых уведомления: сообщение об ученике не должно подменяться
  // сообщением о группе и наоборот.
  const [studentNotice, setStudentNotice] = useState<string | null>(null);
  const [groupNotice, setGroupNotice] = useState<string | null>(null);
  /** Форма группы скрыта, пока её не позовут кнопкой. */
  const [creatingGroup, setCreatingGroup] = useState(false);
  const removeGroup = useDeleteGroup();

  return (
    <div className="flex flex-col gap-6">
      {/* Ученики идут первыми: группа собирается из них. Раньше этот блок жил в
          «Пользователях и ролях» и путал — он выглядел частью учётных записей,
          хотя ученик это запись учебного процесса. */}
      {canManageStudents && <StudentsCard onNotice={setStudentNotice} />}

      {/* Уведомление об ученике — сразу под блоком учеников: раньше оно стояло
          ниже, под карточкой группы, и читалось как сообщение о группе. */}
      {canManageStudents && studentNotice !== null && <Alert tone="success">{studentNotice}</Alert>}

      {creatingGroup && <CreateGroupCard onDone={() => setCreatingGroup(false)} />}

      {groupNotice !== null && <Alert tone="success">{groupNotice}</Alert>}
      {removeGroup.isError && <Alert tone="error">{errorMessage(removeGroup.error)}</Alert>}

      <Card
        title="Группы"
        description="«Состав» — зачисление и отчисление, «Править» — название и период."
        actions={
          /**
           * Кнопка **вместо поиска** (решение владельца): группы ищут редко, а заводят каждый раз.
           * Список групп короткий, и поиск по названию только занимал место в шапке.
           */
          /**
           * Скрыта, пока форма открыта: у самой формы есть «создать» и «отмена», а две одинаковые
           * кнопки на экране путают — этим и попался сквозной сценарий.
           */
          creatingGroup ? undefined : (
            <Button onClick={() => setCreatingGroup(true)}>Создать группу</Button>
          )
        }
      >
        {groups.isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
        {groups.isError && <Alert tone="error">{errorMessage(groups.error)}</Alert>}

        {groups.data !== undefined && groups.data.items.length === 0 && (
          <EmptyState>Групп нет — создайте первую выше.</EmptyState>
        )}

        {groups.data !== undefined && groups.data.items.length > 0 && (
          <Table head={['Группа', 'Курс', 'Специальность', 'Даты', 'Учеников', '']}>
            {groups.data.items.map((group) => (
              <tr key={group.id} className="border-b border-border">
                <td className="px-3 py-2 font-medium">{group.name}</td>
                <td className="px-3 py-2">{group.course ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{group.specialty ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">
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
                        setGroupNotice(null);
                        void removeGroup
                          .mutateAsync(group.id)
                          .then(() => setGroupNotice(`Группа «${group.name}» удалена.`))
                          .catch(() => setGroupNotice(null));
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
              if (message !== '') setGroupNotice(message);
            }}
          />
        )}
      </Card>

      {openGroup !== null && (
        <GroupComposition
          groupId={openGroup.id}
          groupName={openGroup.name}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </div>
  );
}
