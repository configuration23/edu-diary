import { useState } from 'react';

import { errorMessage } from '../lib/api-client';
import {
  useCreateHomework,
  useHomeworkSubmissions,
  useLessonHomework,
  useUploadHomeworkFile,
} from '../lib/queries';
import { Alert, Badge, Button, Card, EmptyState, Field, TextInput } from './ui';

/**
 * Домашнее задание урока.
 *
 * Задание ставится **здесь, в журнале**: учителю удобнее работать там, где он ведёт занятие,
 * а не переключаться в отдельный раздел. Ученик увидит то же задание в своём списке.
 *
 * Файлы загружаются **до** сохранения задания: иначе форма ждала бы передачи файла, а при
 * большом вложении это заметно. Загруженный файл ещё ни к чему не привязан — его «забирает»
 * сохранение задания.
 */

interface UploadedFile {
  id: string;
  originalName: string;
  sizeBytes: number;
}

export function HomeworkCard({
  lessonId,
  canManage,
  today,
}: {
  lessonId: string;
  /** Право ставить задание: у ученика его нет, он увидит карточку только для чтения. */
  canManage: boolean;
  /** Дата урока: срок раньше неё сервер отклонит. */
  today: string;
}) {
  const homework = useLessonHomework(lessonId);
  const create = useCreateHomework();
  const upload = useUploadHomeworkFile();

  const assignment = homework.data?.item ?? null;
  const submissions = useHomeworkSubmissions(assignment?.id ?? null);

  const [text, setText] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [visibleUntil, setVisibleUntil] = useState('');
  const [link, setLink] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const formatSize = (bytes: number): string =>
    bytes < 1024 * 1024
      ? `${String(Math.max(1, Math.round(bytes / 1024)))} КБ`
      : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

  return (
    <Card
      title="Домашнее задание"
      description="Задание увидят ученики группы. Оценку за работу вы ставите сами — сдача оценку не проставляет."
    >
      {assignment === null ? (
        canManage ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);

              try {
                await create.mutateAsync({
                  lessonId,
                  text,
                  dueOn: dueOn === '' ? null : dueOn,
                  visibleUntil: visibleUntil === '' ? null : visibleUntil,
                  links: link.trim() === '' ? [] : [{ url: link.trim() }],
                  fileIds: files.map((file) => file.id),
                });
                setText('');
                setDueOn('');
                setVisibleUntil('');
                setLink('');
                setFiles([]);
              } catch (caught) {
                setError(errorMessage(caught));
              }
            }}
          >
            <Field label="Что задано">
              <textarea
                className="min-h-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Прочитать главу 3 и ответить на вопросы"
              />
            </Field>

            <div className="flex flex-wrap gap-4">
              <Field label="Сдать до">
                <TextInput
                  type="date"
                  value={dueOn}
                  min={today}
                  onChange={(event) => setDueOn(event.target.value)}
                />
                <span className="text-xs text-slate-500">
                  Можно оставить пустым: тогда срок не задан.
                </span>
              </Field>

              <Field label="Видно в уроках до">
                <TextInput
                  type="date"
                  value={visibleUntil}
                  min={today}
                  onChange={(event) => setVisibleUntil(event.target.value)}
                />
                <span className="text-xs text-slate-500">
                  Продолжительное задание: одно и то же видно в уроках предмета до этой даты, а
                  сдаётся один раз. Пусто — видно только в этом уроке.
                </span>
              </Field>
            </div>

            <Field label="Ссылка">
              <TextInput
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://…"
              />
            </Field>

            <Field label="Файлы">
              <input
                type="file"
                className="text-sm"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file === undefined) return;
                  setError(null);

                  try {
                    const uploaded = await upload.mutateAsync({ file, kind: 'assignment' });
                    setFiles((current) => [...current, uploaded]);
                  } catch (caught) {
                    setError(errorMessage(caught));
                  }
                  event.target.value = '';
                }}
              />
              <span className="text-xs text-slate-500">
                Размер и тип проверяет сервер. Исполняемые файлы, скрипты, HTML и SVG запрещены
                всегда.
              </span>
            </Field>

            {files.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {files.map((file) => (
                  <li key={file.id} className="flex items-center gap-2">
                    <span>{file.originalName}</span>
                    <span className="text-slate-500">{formatSize(file.sizeBytes)}</span>
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
              <Button type="submit" disabled={create.isPending || upload.isPending}>
                {create.isPending ? 'Сохраняем…' : 'Задать задание'}
              </Button>
            </div>

            {error !== null && <Alert tone="error">{error}</Alert>}
          </form>
        ) : (
          <EmptyState>К этому уроку задание не задано.</EmptyState>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-wrap text-sm">{assignment.text}</p>

          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            {assignment.dueOn !== null && <span>Сдать до {assignment.dueOn}</span>}
            {assignment.visibleUntil !== null && (
              <span>Видно в уроках до {assignment.visibleUntil}</span>
            )}
            <Badge tone={assignment.submittedCount === 0 ? 'neutral' : 'success'}>
              сдали {assignment.submittedCount} из {assignment.studentCount}
            </Badge>
          </div>

          {assignment.links.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {assignment.links.map((item) => (
                <li key={item.id}>
                  <a
                    className="text-blue-700 underline"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {item.title ?? item.url}
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
                  </a>{' '}
                  <span className="text-slate-500">{formatSize(file.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <div>
              <p className="text-sm font-medium text-slate-700">Сдавшие</p>
              {submissions.data === undefined || submissions.data.items.length === 0 ? (
                <EmptyState>Пока никто не сдал.</EmptyState>
              ) : (
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {submissions.data.items.map((submission) => (
                    <li key={submission.id} className="flex flex-wrap items-center gap-2">
                      <span>{submission.studentName}</span>
                      {submission.isLate ? (
                        <Badge tone="danger">сдано позже срока</Badge>
                      ) : (
                        <Badge tone="success">в срок</Badge>
                      )}
                      {submission.files.map((file) => (
                        <a
                          key={file.id}
                          className="text-blue-700 underline"
                          href={`/api/homework/files/${file.id}`}
                          download
                        >
                          {file.originalName}
                        </a>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
