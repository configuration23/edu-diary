import { useState } from 'react';

import type { SessionResponseDto } from '@edu-diary/contracts';
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
  useAssignments,
  useCloseAssignment,
  useCreateAssignment,
  useGroups,
  useSubjects,
  useTeachers,
} from '../lib/queries';

/**
 * Назначения «преподаватель ↔ предмет ↔ группа».
 *
 * Список приходит уже ограниченным правами: преподаватель видит только свои
 * назначения, администратор — все. Экран не «доверяет» фильтру на клиенте, а
 * показывает то, что вернул сервер, и отдельно предупреждает преподавателя.
 */

function CreateAssignmentCard() {
  const teachers = useTeachers();
  const subjects = useSubjects();
  const groups = useGroups();
  const create = useCreateAssignment();

  const [teacherUserId, setTeacherUserId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [studyGroupId, setStudyGroupId] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [hoursPlanned, setHoursPlanned] = useState('');

  const teacherOptions = (teachers.data?.items ?? []).filter((user) =>
    user.roles.some((role) => role.code === 'teacher'),
  );

  return (
    <Card
      title="Новое назначение"
      description="У преподавателя не бывает двух назначений в один период; предмет в группе ведёт один преподаватель."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await create.mutateAsync({
              teacherUserId,
              subjectId,
              studyGroupId,
              startsOn,
              endsOn: endsOn === '' ? null : endsOn,
              hoursPlanned: hoursPlanned === '' ? null : Number(hoursPlanned),
            });
            setStartsOn('');
            setEndsOn('');
            setHoursPlanned('');
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Преподаватель">
            <select
              required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={teacherUserId}
              onChange={(event) => setTeacherUserId(event.target.value)}
            >
              <option value="">— выберите —</option>
              {teacherOptions.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Предмет">
            <select
              required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              <option value="">— выберите —</option>
              {(subjects.data?.items ?? []).map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Группа">
            <select
              required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={studyGroupId}
              onChange={(event) => setStudyGroupId(event.target.value)}
            >
              <option value="">— выберите —</option>
              {(groups.data?.items ?? []).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Начало">
            <TextInput
              required
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </Field>
          <Field label="Окончание" hint="Пусто — действует до закрытия">
            <TextInput
              type="date"
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          </Field>
          <Field label="Часов по плану" hint="Необязательно">
            <TextInput
              inputMode="numeric"
              value={hoursPlanned}
              onChange={(event) => setHoursPlanned(event.target.value)}
            />
          </Field>
        </div>

        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}

        <div>
          <Button type="submit" disabled={create.isPending}>
            Назначить
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function AssignmentsScreen({ session }: { session: SessionResponseDto }) {
  const canManage = session.permissions.some(
    (grant) => grant.permission === 'assignments:write' && grant.scope === 'all',
  );

  const [groupId, setGroupId] = useState('');
  const groups = useGroups();
  const assignments = useAssignments({ studyGroupId: groupId === '' ? undefined : groupId });
  const close = useCloseAssignment();

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <CreateAssignmentCard />
      ) : (
        <Alert tone="info">
          Здесь видны только ваши назначения. Назначения выдаёт администратор.
        </Alert>
      )}

      <Card
        title="Назначения"
        description={canManage ? 'Все назначения колледжа.' : 'Ваши назначения: предметы и группы.'}
        actions={
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">Все группы</option>
            {(groups.data?.items ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        }
      >
        {assignments.isLoading && <p className="text-sm text-slate-500">Загружаем…</p>}
        {assignments.isError && <Alert tone="error">{errorMessage(assignments.error)}</Alert>}
        {close.isError && <Alert tone="error">{errorMessage(close.error)}</Alert>}

        {assignments.data !== undefined && assignments.data.items.length === 0 && (
          <EmptyState>Назначений нет.</EmptyState>
        )}

        {assignments.data !== undefined && assignments.data.items.length > 0 && (
          <Table head={['Преподаватель', 'Предмет', 'Группа', 'Период', 'Часов', 'Состояние', '']}>
            {assignments.data.items.map((assignment) => (
              <tr key={assignment.id} className="border-b border-slate-100">
                <td className="px-3 py-2">{assignment.teacherName}</td>
                <td className="px-3 py-2">{assignment.subjectName}</td>
                <td className="px-3 py-2">{assignment.groupName}</td>
                <td className="px-3 py-2 text-slate-600">
                  {formatDate(assignment.startsOn)} —{' '}
                  {assignment.endsOn === null ? 'действует' : formatDate(assignment.endsOn)}
                </td>
                <td className="px-3 py-2">{assignment.hoursPlanned ?? '—'}</td>
                <td className="px-3 py-2">
                  {assignment.endsOn === null ? (
                    <Badge tone="success">действует</Badge>
                  ) : (
                    <Badge>закрыто</Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canManage && assignment.endsOn === null && (
                    <Button
                      tone="ghost"
                      disabled={close.isPending}
                      onClick={() => {
                        const today = new Date().toISOString().slice(0, 10);
                        void close.mutateAsync({ id: assignment.id, endsOn: today });
                      }}
                    >
                      Закрыть сегодня
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
