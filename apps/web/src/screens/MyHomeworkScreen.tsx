import { useState } from 'react';

import type { HomeworkAssignmentSummaryDto } from '@edu-diary/contracts';

import { errorMessage } from '../lib/api-client';
import {
  useMyHomework,
  useSubmissionState,
  useSubmitHomework,
  useUploadHomeworkFile,
} from '../lib/queries';
import { Alert, Badge, Button, Card, EmptyState, Field, TextInput } from '../components/ui';

/**
 * «Мои задания»: что задано и что сдано.
 *
 * Ученику нужен **свой список**, а не журнал: в журнале он видит одно занятие, а задания
 * приходят из разных уроков и предметов. Список собирает их на дату.
 *
 * Черновика нет (решение владельца): дневник — инструмент отчётности, а не редактор.
 * Отправка одна; после срока сдавать можно, но сдача помечается.
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MyHomeworkScreen() {
  const [date, setDate] = useState(todayIso());
  const homework = useMyHomework({ onDate: date });

  const items = homework.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Мои задания"
        description="Задания по вашим группам. Отправка одна: черновика нет, поэтому проверяйте решение перед отправкой."
      >
        <Field label="Показать задания на дату">
          <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <span className="text-xs text-slate-500">
            Продолжительное задание видно в уроках предмета до своей даты, но сдаётся один раз — в
            списке оно встречается один раз.
          </span>
        </Field>
      </Card>

      {homework.isLoading && <Card>Загружаем…</Card>}

      {homework.data !== undefined && items.length === 0 && (
        <Card>
          <EmptyState>На эту дату заданий нет.</EmptyState>
        </Card>
      )}

      {items.map((assignment) => (
        <HomeworkItem key={assignment.id} assignment={assignment} />
      ))}
    </div>
  );
}

function HomeworkItem({ assignment }: { assignment: HomeworkAssignmentSummaryDto }) {
  const state = useSubmissionState(assignment.id);
  const submit = useSubmitHomework();
  const upload = useUploadHomeworkFile();

  const [text, setText] = useState('');
  const [files, setFiles] = useState<{ id: string; originalName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const own = state.data?.own ?? null;
  const canSubmit = state.data?.canSubmit === true;

  return (
    <Card
      title={assignment.subjectName}
      description={`${assignment.lessonDate} · ${assignment.groupName}`}
      actions={
        own === null ? (
          <Badge tone="neutral">не сдано</Badge>
        ) : own.isLate ? (
          <Badge tone="danger">сдано позже срока</Badge>
        ) : (
          <Badge tone="success">сдано</Badge>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <p className="whitespace-pre-wrap text-sm">{assignment.text}</p>

        {assignment.dueOn !== null && (
          <p className="text-sm text-slate-600">
            Сдать до {assignment.dueOn}
            {/* Сдавать после срока можно: не наказываем за задержку, но показываем факт. */}
            {own === null && assignment.dueOn < todayIso() && ' — срок прошёл, сдать можно'}
          </p>
        )}

        {assignment.links.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {assignment.links.map((link) => (
              <li key={link.id}>
                <a
                  className="text-blue-700 underline"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {link.title ?? link.url}
                </a>
              </li>
            ))}
          </ul>
        )}

        {assignment.files.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {assignment.files.map((file) => (
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

        {own !== null && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="font-medium text-emerald-900">Ваше решение отправлено</p>
            {own.text !== '' && <p className="mt-1 whitespace-pre-wrap">{own.text}</p>}
            {own.files.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1">
                {own.files.map((file) => (
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
            <p className="mt-2 text-xs text-emerald-800">
              Оценку за работу ставит преподаватель — факт сдачи оценку не проставляет.
            </p>
          </div>
        )}

        {canSubmit && (
          <form
            className="flex flex-col gap-3 border-t border-slate-200 pt-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);

              try {
                await submit.mutateAsync({
                  assignmentId: assignment.id,
                  text,
                  fileIds: files.map((file) => file.id),
                });
                setText('');
                setFiles([]);
              } catch (caught) {
                setError(errorMessage(caught));
              }
            }}
          >
            <Field label="Решение">
              <textarea
                className="min-h-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Ответ или пояснение к работе"
              />
            </Field>

            <Field label="Файл">
              <input
                type="file"
                className="text-sm"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file === undefined) return;
                  setError(null);

                  try {
                    const uploaded = await upload.mutateAsync({ file, kind: 'submission' });
                    setFiles((current) => [...current, uploaded]);
                  } catch (caught) {
                    setError(errorMessage(caught));
                  }
                  event.target.value = '';
                }}
              />
              <span className="text-xs text-slate-500">
                Можно приложить несколько файлов по очереди. Размер и тип проверяет сервер.
              </span>
            </Field>

            {files.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {files.map((file) => (
                  <li key={file.id} className="flex items-center gap-2">
                    <span>{file.originalName}</span>
                    <button
                      type="button"
                      className="text-xs text-red-700 underline"
                      onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
                    >
                      убрать
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <Button type="submit" disabled={submit.isPending || upload.isPending}>
                {submit.isPending ? 'Отправляем…' : 'Отправить решение'}
              </Button>
            </div>

            <span className="text-xs text-slate-500">
              Отправка одна: изменить решение после отправки нельзя.
            </span>

            {error !== null && <Alert tone="error">{error}</Alert>}
          </form>
        )}
      </div>
    </Card>
  );
}
