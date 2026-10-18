import { useEffect, useState } from 'react';

import { useAssignments, useGroups, useSubmittedWorks } from '../lib/queries';
import { Badge, Field, Select } from '../components/ui';
import {
  Page,
  PageHeader,
  PersonList,
  PersonRow,
  QueryState,
  Section,
  Toolbar,
} from '../components/layout';
import type { SessionResponseDto } from '@edu-diary/contracts';

/**
 * «Сданные работы»: таблица класса по заданиям.
 *
 * Учителю нужен не список сдавших, а **таблица**: напротив каждого ученика его ответ или
 * пометка «не сдал». Так видно, кого ещё ждать, — а список сдавших этого не показывает.
 *
 * **Первый экран, собранный по новому каркасу** (Этап 6, шаг 0). Здесь видно, что даёт каркас:
 * страница, шапка с действиями, панель фильтров и строка «кто × значение» берутся готовыми, и в
 * экране не остаётся ни одного случайного отступа.
 *
 * Группа выбирается явно: у преподавателя группы дают его назначения, у администратора —
 * справочник. Без выбора группу взять неоткуда — у преподавателя нет «своих» групп в смысле
 * ученика, и запрос без группы возвращал пусто.
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
  const groupOptions = canChooseAnyGroup
    ? (groups.data?.items ?? []).map((group) => [group.id, group.name] as const)
    : teacherGroups;

  return (
    <Page>
      <PageHeader
        title="Сданные работы"
        description="Ответы учеников по заданиям, срок которых — выбранная дата. Кто не сдал, видно сразу."
      />

      <Toolbar>
        <Field label="Группа">
          <Select
            className="w-full min-w-56 rounded-md border border-border px-3 py-2 text-sm"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            {groupOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Дата урока-срока">
          <input
            type="date"
            className="rounded-md border border-border px-3 py-2 text-sm"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
      </Toolbar>

      <QueryState
        isLoading={works.isLoading}
        error={works.error}
        isEmpty={items.length === 0}
        emptyText="На эту дату заданий нет. Проверьте группу и дату: показываются задания, срок которых приходится на выбранный день."
        onRetry={() => void works.refetch()}
      >
        {items.map((assignment) => (
          <Section
            key={assignment.assignmentId}
            title={assignment.subjectName}
            description={`${assignment.groupName} · сдать к ${assignment.dueLessonDate} · задано ${assignment.lessonDate}`}
            actions={
              <Badge tone={assignment.submittedCount === 0 ? 'neutral' : 'success'}>
                сдали {assignment.submittedCount} из {assignment.studentCount}
              </Badge>
            }
          >
            <p className="whitespace-pre-wrap text-sm text-foreground">{assignment.text}</p>

            {/*
              Вертикальный список учеников: напротив каждого — его ответ или пометка «не сдал».
              Строка берётся готовая: тот же вид, что в журнале и «Оценках».
            */}
            <PersonList>
              {assignment.rows.map((row) => (
                <PersonRow key={row.studentId} name={row.studentName}>
                  {row.submission === null ? (
                    <Badge tone="neutral">не сдал</Badge>
                  ) : (
                    <>
                      {row.submission.isLate ? (
                        <Badge tone="danger">сдано позже срока</Badge>
                      ) : (
                        <Badge tone="success">сдано</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(row.submission.submittedAt).toLocaleDateString('ru-RU')}
                      </span>
                      {row.submission.files.map((file) => (
                        <a
                          key={file.id}
                          className="text-primary underline"
                          href={`/api/homework/files/${file.id}`}
                          download
                        >
                          {file.originalName}
                        </a>
                      ))}
                    </>
                  )}
                </PersonRow>
              ))}
            </PersonList>

            {/*
              Текст ответа показываем **под** строками: иначе длинный ответ растягивает строку и
              таблица перестаёт читаться построчно.
            */}
            {assignment.rows.some((row) => (row.submission?.text ?? '') !== '') && (
              <div className="flex flex-col gap-1 rounded-md bg-muted p-3">
                {assignment.rows.map((row) =>
                  row.submission === null || row.submission.text === '' ? null : (
                    <p key={row.studentId} className="text-sm">
                      <span className="font-medium text-foreground">{row.studentName}: </span>
                      <span className="whitespace-pre-wrap text-foreground">
                        {row.submission.text}
                      </span>
                    </p>
                  ),
                )}
              </div>
            )}
          </Section>
        ))}
      </QueryState>
    </Page>
  );
}
