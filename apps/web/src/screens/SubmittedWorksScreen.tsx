import { useEffect, useState } from 'react';

import { useAssignments, useGroups, useSubmittedWorks } from '../lib/queries';
import { Badge, Card, EmptyState, Field, TextInput } from '../components/ui';
import type { SessionResponseDto } from '@edu-diary/contracts';

/**
 * «Сданные работы»: таблица класса по заданиям.
 *
 * Учителю нужен не список сдавших, а **таблица**: напротив каждого ученика его ответ или
 * пометка «не сдал». Так видно, кого ещё ждать, — а список сдавших этого не показывает.
 *
 * Группа выбирается явно, как в «Оценках и посещении»: у преподавателя группы дают его
 * назначения, у администратора — справочник. Без выбора группу взять неоткуда: у преподавателя
 * нет «своих» групп в смысле ученика, и запрос без группы возвращал пусто.
 *
 * Состав группы сервер берёт **на дату урока-срока**: работу проверяют у тех, кто был в группе
 * тогда, а не у тех, кто в ней сейчас.
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SubmittedWorksScreen({ session }: { session: SessionResponseDto }) {
  /** Администратор выбирает группу из справочника, преподаватель — из своих назначений. */
  const canChooseAnyGroup = session.permissions.some(
    (grant) => grant.permission === 'homework:review' && grant.scope === 'all',
  );
  const isTeacher = !canChooseAnyGroup;

  const groups = useGroups({}, { enabled: canChooseAnyGroup });
  /** Преподавателю свои назначения дают группы — как в «Оценках и посещении». */
  const assignments = useAssignments({}, { enabled: isTeacher });

  const teacherGroups = [
    ...new Map((assignments.data?.items ?? []).map((item) => [item.studyGroupId, item.groupName])),
  ];

  const [groupId, setGroupId] = useState('');
  const [date, setDate] = useState(todayIso());

  /** Первый доступный вариант подставляем сразу: чаще всего работают с одной группой. */
  useEffect(() => {
    if (groupId !== '') return;

    if (canChooseAnyGroup) {
      const first = groups.data?.items[0]?.id;
      if (first !== undefined) setGroupId(first);
      return;
    }

    const first = teacherGroups[0]?.[0];
    if (first !== undefined) setGroupId(first);
  }, [canChooseAnyGroup, groups.data, groupId, teacherGroups]);

  const works = useSubmittedWorks({
    ...(groupId === '' ? {} : { studyGroupId: groupId }),
    from: date,
    to: date,
  });

  const items = works.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Сданные работы"
        description="Ответы учеников по заданиям, срок которых — выбранная дата. Кто не сдал, видно сразу."
      >
        <div className="flex flex-wrap gap-4">
          <Field label="Группа">
            {canChooseAnyGroup ? (
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                {(groups.data?.items ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                {teacherGroups.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Дата урока-срока">
            <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <span className="text-xs text-slate-500">
              Показываем задания, сдать которые нужно к урокам этой даты. Состав группы — на эту же
              дату.
            </span>
          </Field>
        </div>
      </Card>

      {works.isLoading && <Card>Загружаем…</Card>}

      {works.data !== undefined && items.length === 0 && (
        <Card>
          <EmptyState>
            На эту дату заданий нет. Проверьте группу и дату: показываются задания, срок которых
            приходится на выбранный день.
          </EmptyState>
        </Card>
      )}

      {items.map((assignment) => (
        <Card
          key={assignment.assignmentId}
          title={assignment.subjectName}
          description={`${assignment.groupName} · сдать к ${assignment.dueLessonDate} · задано ${assignment.lessonDate}`}
          actions={
            <Badge tone={assignment.submittedCount === 0 ? 'neutral' : 'success'}>
              сдали {assignment.submittedCount} из {assignment.studentCount}
            </Badge>
          }
        >
          <p className="whitespace-pre-wrap text-sm text-slate-700">{assignment.text}</p>

          {/*
            Вертикальный список учеников, как в журнале: напротив каждого — его ответ или
            пометка «не сдал». Так таблица читается построчно и видно, кого ещё ждать.
          */}
          <ul className="mt-3 flex flex-col divide-y divide-slate-100">
            {assignment.rows.map((row) => (
              <li key={row.studentId} className="flex flex-col gap-1 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-40 font-medium">{row.studentName}</span>

                  {row.submission === null ? (
                    <Badge tone="neutral">не сдал</Badge>
                  ) : row.submission.isLate ? (
                    <Badge tone="danger">сдано позже срока</Badge>
                  ) : (
                    <Badge tone="success">сдано</Badge>
                  )}

                  {row.submission !== null && (
                    <span className="text-xs text-slate-500">
                      {new Date(row.submission.submittedAt).toLocaleDateString('ru-RU')}
                    </span>
                  )}
                </div>

                {row.submission !== null && (
                  <div className="flex flex-col gap-1 pl-4">
                    {row.submission.text !== '' && (
                      <p className="whitespace-pre-wrap text-slate-700">{row.submission.text}</p>
                    )}

                    {row.submission.files.length > 0 && (
                      <ul className="flex flex-wrap gap-2">
                        {row.submission.files.map((file) => (
                          <li key={file.id}>
                            <a
                              className="text-blue-700 underline"
                              href={`/api/homework/files/${file.id}`}
                              download
                            >
                              {file.originalName}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}

                    {row.submission.text === '' && row.submission.files.length === 0 && (
                      <span className="text-slate-500">Ответ без текста и файлов</span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
