import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { requiredISODateSchema } from '@edu-diary/contracts';
import type { SessionResponseDto } from '@edu-diary/contracts';
import { useAcademicContext } from '../components/AcademicContext';
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

/** Значение селекта «Группа», означающее все группы активного года. */
const ALL_GROUPS = '__all__';

function CreateAssignmentCard({ onDone }: { onDone: () => void }) {
  const teachers = useTeachers();
  const subjects = useSubjects();
  const groups = useGroups();
  const create = useCreateAssignment();
  // Уже существующие назначения: по ним показываем мягкое предупреждение о
  // возможном наложении — сервер такое больше не запрещает.
  const existing = useAssignments();
  const { activeYearStartsOn, allGroups } = useAcademicContext();

  const [teacherUserId, setTeacherUserId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [studyGroupId, setStudyGroupId] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [hoursPlanned, setHoursPlanned] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ created: number; failed: string[] } | null>(null);

  /**
   * Начало назначения по умолчанию — начало активного учебного года. Поле
   * остаётся редактируемым, поэтому подставляем только пока пользователь его не
   * трогал: иначе выбор года затирал бы уже введённую дату.
   */
  const startsOnTouched = useRef(false);
  useEffect(() => {
    if (startsOnTouched.current || activeYearStartsOn === null) return;
    setStartsOn(activeYearStartsOn);
  }, [activeYearStartsOn]);

  const teacherOptions = (teachers.data?.items ?? []).filter((user) =>
    user.roles.some((role) => role.code === 'teacher'),
  );

  /**
   * Назначения выбранного преподавателя, которые пересекаются с вводимым
   * периодом. Не запрет: вести два предмета параллельно можно, но стоит
   * проверить, не окажутся ли пары в одно время (это ловит расписание).
   */
  const overlapping = (existing.data?.items ?? []).filter(
    (item) =>
      teacherUserId !== '' &&
      item.teacherUserId === teacherUserId &&
      item.endsOn !== null &&
      (endsOn === '' || item.startsOn <= endsOn) &&
      (startsOn === '' || item.endsOn >= startsOn),
  );

  return (
    <Card
      title="Новое назначение"
      description="Преподаватель может вести предмет в нескольких группах и несколько предметов в группе; ограничение одно — предмет в группе ведёт один преподаватель."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setDateError(null);

          // Проверка календарных дат: браузер пропускает ручной ввод вроде
          // «31.02.2026», поэтому проверяем до отправки (та же проверка, что в
          // остальных формах — `requiredISODateSchema`).
          for (const value of [startsOn, endsOn]) {
            if (value === '') continue;
            const parsed = requiredISODateSchema.safeParse(value);
            if (!parsed.success) {
              setDateError(parsed.error.issues[0]?.message ?? 'Некорректная дата');
              return;
            }
          }

          if (endsOn !== '' && startsOn !== '' && startsOn > endsOn) {
            setDateError('Дата начала позже даты окончания');
            return;
          }

          const targetGroups =
            studyGroupId === ALL_GROUPS ? allGroups.map((group) => group.id) : [studyGroupId];

          if (targetGroups.length === 0) {
            setDateError('В активном году нет групп — назначение некуда поставить');
            return;
          }

          // Режим «все группы» — это несколько назначений. Проверки сервера
          // (один предмет в группе ведёт один преподаватель) могут отклонить
          // часть из них, поэтому показываем, что получилось, а что нет.
          const failed: string[] = [];
          let created = 0;

          for (const targetGroupId of targetGroups) {
            try {
              await create.mutateAsync({
                teacherUserId,
                subjectId,
                studyGroupId: targetGroupId,
                startsOn,
                endsOn: endsOn === '' ? null : endsOn,
                hoursPlanned: hoursPlanned === '' ? null : Number(hoursPlanned),
              });
              created += 1;
            } catch (error) {
              const name = allGroups.find((group) => group.id === targetGroupId)?.name ?? 'группа';
              failed.push(`${name}: ${errorMessage(error)}`);
            }
          }

          if (allGroups.length > 1 || targetGroups.length > 1) {
            setBulkResult({ created, failed });
          }

          if (created > 0) {
            setEndsOn('');
            setHoursPlanned('');

            /**
             * Закрываем форму после создания — но **не** когда есть массовый результат: его надо
             * прочитать (сколько создано и что не удалось), а не потерять вместе с формой.
             */
            if (allGroups.length <= 1 && targetGroups.length <= 1) onDone();
          }
        }}
      >
        {teachers.data !== undefined && teacherOptions.length === 0 && (
          <Alert tone="warning">
            Преподавателей ещё нет — создайте пользователя с ролью «Преподаватель» в разделе{' '}
            <Link to="/users" className="underline">
              Учётные записи и роли
            </Link>
            .
          </Alert>
        )}

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
              {allGroups.length > 1 && (
                <option value={ALL_GROUPS}>Все группы ({allGroups.length})</option>
              )}
              {(groups.data?.items ?? []).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Начало" hint="По умолчанию — начало учебного года">
            <TextInput
              required
              type="date"
              value={startsOn}
              onChange={(event) => {
                startsOnTouched.current = true;
                setStartsOn(event.target.value);
              }}
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

        {dateError !== null && <Alert tone="error">{dateError}</Alert>}

        {overlapping.length > 0 && (
          <Alert tone="warning">
            У этого преподавателя уже есть назначения в этот период:{' '}
            {overlapping.map((item) => `${item.subjectName} — ${item.groupName}`).join('; ')}. Это
            допустимо, но проверьте, что пары не окажутся в одно время.
          </Alert>
        )}

        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}

        {bulkResult !== null && (
          <div className="flex flex-col gap-2">
            {bulkResult.created > 0 && (
              <Alert tone="success">
                Создано назначений: {bulkResult.created}.
                {bulkResult.failed.length > 0 ? ' Часть групп не удалось — причины ниже.' : ''}
              </Alert>
            )}
            {bulkResult.failed.length > 0 && (
              <Alert tone="warning">Не создано: {bulkResult.failed.join('; ')}</Alert>
            )}
          </div>
        )}

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
  /** Форма назначения скрыта, пока её не позовут кнопкой: список важнее формы. */
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {creating && <CreateAssignmentCard onDone={() => setCreating(false)} />}

      {!canManage && (
        <Alert tone="info">
          Здесь видны только ваши назначения. Назначения выдаёт администратор.
        </Alert>
      )}

      <Card
        title="Назначения"
        description={canManage ? 'Все назначения колледжа.' : 'Ваши назначения: предметы и группы.'}
        actions={
          canManage ? (
            /**
             * Скрыта, пока форма открыта: у самой формы есть «создать» и «отмена», а две кнопки,
             * делающие одно и то же, только путают.
             */
            creating ? undefined : (
              <Button onClick={() => setCreating(true)}>Создать назначение</Button>
            )
          ) : undefined
        }
      >
        {/**
         * Выбор группы остаётся отдельной строкой: это фильтр списка, а не действие.
         * Кнопка создания — в шапке, там же, где на других страницах.
         */}
        <div className="mb-3">
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
        </div>

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
