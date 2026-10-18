import { useState } from 'react';

import type { HomeworkAssignmentSummaryDto } from '@edu-diary/contracts';

import { errorMessage } from '../lib/api-client';
import {
  useMyHomework,
  useSubmissionState,
  useSubmitHomework,
  useUploadHomeworkFile,
} from '../lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FilePicker,
  Textarea,
  TextInput,
} from '../components/ui';

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
  /**
   * Ищем по **урокам-срокам**: задание привязано к занятию, и «что сдать в этот день» —
   * это «какие уроки сегодня и что к ним задано».
   */
  const homework = useMyHomework({ from: date, to: date });

  const items = homework.data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="Мои задания"
        description="Задания по вашим группам. Отправка одна: черновика нет, поэтому проверяйте решение перед отправкой."
      >
        <Field label="Показать задания на дату">
          <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <span className="text-xs text-muted-foreground">
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

        {/*
          Обе даты нужны ученику: к какому уроку сдать и когда задали. Вторая помогает
          понять, «свежее» это задание или висит давно.
        */}
        <p className="text-sm text-muted-foreground">
          Сдать к уроку {assignment.dueLessonDate}
          {/* Сдавать после срока можно: не наказываем за задержку, но показываем факт. */}
          {own === null && assignment.dueLessonDate < todayIso() && ' — срок прошёл, сдать можно'}
          {' · задано '}
          {assignment.lessonDate}
        </p>

        {assignment.links.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {assignment.links.map((link) => (
              <li key={link.id}>
                <a
                  className="text-primary underline"
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
                  className="text-primary underline"
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
          <div className="rounded-md border border-success-border bg-success-soft p-3 text-sm">
            <p className="font-medium text-success-foreground">Ваше решение отправлено</p>
            {own.text !== '' && <p className="mt-1 whitespace-pre-wrap">{own.text}</p>}
            {own.files.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1">
                {own.files.map((file) => (
                  <li key={file.id}>
                    <a
                      className="text-primary underline"
                      href={`/api/homework/files/${file.id}`}
                      download
                    >
                      {file.originalName}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-success-foreground">
              Оценку за работу ставит преподаватель — факт сдачи оценку не проставляет.
            </p>
          </div>
        )}

        {canSubmit && (
          <form
            className="flex flex-col gap-3 border-t border-border pt-3"
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
              {/*
                `w-full` обязателен: без него `<Textarea>` берёт ширину по умолчанию (около 20
                символов) и выглядит узкой колонкой внутри широкого блока — владелец это заметил.
                Поле ввода решения — главное на экране, ему нужна вся ширина.
              */}
              <Textarea
                className="min-h-20 w-full rounded-md border border-border px-2 py-1.5 text-sm"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Ответ или пояснение к работе"
              />
            </Field>

            {/*
              Выбор файла и отправка — в одном ряду, кнопка справа (просьба владельца): это одно
              действие «приложил и отправил», а не два шага в разных концах формы.
            */}
            <Field
              label="Файл"
              hint="Можно приложить несколько файлов по очереди. Размер и тип проверяет сервер."
              actions={
                <Button type="submit" disabled={submit.isPending || upload.isPending}>
                  {submit.isPending ? 'Отправляем…' : 'Отправить решение'}
                </Button>
              }
            >
              <FilePicker
                onSelect={async (file) => {
                  if (file === undefined) return;
                  setError(null);

                  try {
                    const uploaded = await upload.mutateAsync({ file, kind: 'submission' });
                    setFiles((current) => [...current, uploaded]);
                  } catch (caught) {
                    setError(errorMessage(caught));
                  }
                }}
              />
            </Field>

            {files.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {files.map((file) => (
                  <li key={file.id} className="flex items-center gap-2">
                    <span>{file.originalName}</span>
                    <button
                      type="button"
                      className="text-xs text-danger-foreground underline"
                      onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
                    >
                      убрать
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <span className="text-xs text-muted-foreground">
              Отправка одна: изменить решение после отправки нельзя.
            </span>

            {error !== null && <Alert tone="error">{error}</Alert>}
          </form>
        )}
      </div>
    </Card>
  );
}
