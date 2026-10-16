import { useState } from 'react';

import { useSubmittedWorks } from '../lib/queries';
import { Badge, Card, EmptyState, Field, TextInput } from '../components/ui';

/**
 * «Сданные работы»: таблица класса по заданиям.
 *
 * Учителю нужен не список сдавших, а **таблица**: напротив каждого ученика его ответ или
 * пометка «не сдал». Так видно, кого ещё ждать, — а список сдавших этого не показывает.
 *
 * Состав группы сервер берёт **на дату урока-срока**: работу проверяют у тех, кто был в группе
 * тогда, а не у тех, кто в ней сейчас.
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SubmittedWorksScreen() {
  const [date, setDate] = useState(todayIso());
  const works = useSubmittedWorks({ from: date, to: date });

  const items = works.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Сданные работы"
        description="Ответы учеников по заданиям, срок которых — выбранная дата. Кто не сдал, видно сразу."
      >
        <Field label="Дата урока-срока">
          <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <span className="text-xs text-slate-500">
            Показываем задания, сдать которые нужно к урокам этой даты. Состав группы — на эту же
            дату.
          </span>
        </Field>
      </Card>

      {works.isLoading && <Card>Загружаем…</Card>}

      {works.data !== undefined && items.length === 0 && (
        <Card>
          <EmptyState>На эту дату заданий нет.</EmptyState>
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
                  <div className="flex flex-col gap-1 pl-0 sm:pl-42">
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
