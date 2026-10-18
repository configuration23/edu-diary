import { useState } from 'react';

import { errorMessage } from '../lib/api-client';
import {
  useCreateHomework,
  useHomeworkSubmissions,
  useLessonHomework,
  useRemoveHomework,
  useUpdateHomework,
  useUploadHomeworkFile,
} from '../lib/queries';
import { Alert, Badge, Button, Card, EmptyState, Field, TextInput } from './ui';
import type { HomeworkAssignmentSummaryDto } from '@edu-diary/contracts';

/**
 * Домашнее задание урока.
 *
 * Дат в форме **нет**: датами оперировать неудобно, и учитель указывает совсем другие числа.
 * Вместо них — **список ближайших уроков** того же предмета и группы: учитель выбирает
 * занятие, до которого задаёт. По умолчанию подставляется следующий урок.
 *
 * Блок показывает **две группы**:
 * - «Задано на этом уроке» — то, что учитель задал здесь и может править;
 * - «Сдать к этому уроку» — то, что нужно проверить сегодня, включая заданное раньше. Так
 *   учитель видит, что домашка из прошлого урока ждёт проверки, и может задать новую, не
 *   затирая прошлую.
 */

interface UploadedFile {
  id: string;
  originalName: string;
  sizeBytes: number;
}

export function HomeworkCard({
  lessonId,
  canManage,
}: {
  lessonId: string;
  /** Право ставить задание: у ученика его нет, он увидит карточку только для чтения. */
  canManage: boolean;
}) {
  const homework = useLessonHomework(lessonId);
  const create = useCreateHomework();
  const update = useUpdateHomework();
  const remove = useRemoveHomework();
  const upload = useUploadHomeworkFile();

  const assignedHere = homework.data?.assignedHere ?? [];
  const dueHere = homework.data?.dueHere ?? [];
  const dueOptions = homework.data?.dueOptions ?? [];

  const submissions = useHomeworkSubmissions(assignedHere[0]?.id ?? null);

  const [text, setText] = useState('');
  const [dueLessonId, setDueLessonId] = useState('');
  const [link, setLink] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Какое задание правим: правка идёт на месте, отдельного экрана не нужно. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const formatSize = (bytes: number): string =>
    bytes < 1024 * 1024
      ? `${String(Math.max(1, Math.round(bytes / 1024)))} КБ`
      : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

  /** Задания, заданные **на других** уроках, но ожидаемые к этому: их пора проверять. */
  const fromEarlierLessons = dueHere.filter(
    (assignment) => !assignedHere.some((own) => own.id === assignment.id),
  );

  return (
    <Card
      title="Домашнее задание"
      description="Задание увидят ученики группы. Оценку за работу вы ставите сами — сдача оценку не проставляет."
    >
      <div className="flex flex-col gap-4">
        {/*
          Домашка из прошлого урока: плашка, а не полная форма. Учитель должен понимать, что
          на этом занятии её пора проверять, и не путать со своим заданием.
        */}
        {fromEarlierLessons.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border border-warning-border bg-warning-soft p-3">
            <p className="text-sm font-medium text-warning-foreground">
              К этому уроку задано раньше — проверьте:
            </p>
            {fromEarlierLessons.map((assignment) => (
              <div key={assignment.id} className="text-sm">
                <span className="text-muted-foreground">от {assignment.lessonDate}: </span>
                <span>{assignment.text}</span>
                {assignment.files.length > 0 && (
                  <span className="text-muted-foreground">
                    {' '}
                    · файлов: {assignment.files.length}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {assignedHere.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">Задано на этом уроке</p>
            {assignedHere.map((assignment) => (
              <AssignmentBlock
                key={assignment.id}
                assignment={assignment}
                canManage={canManage}
                formatSize={formatSize}
                dueOptions={dueOptions}
                isEditing={editingId === assignment.id}
                onEdit={() => setEditingId(assignment.id)}
                onCancel={() => setEditingId(null)}
                saving={update.isPending}
                onSave={async (input) => {
                  setError(null);
                  try {
                    await update.mutateAsync({ assignmentId: assignment.id, ...input });
                    setEditingId(null);
                  } catch (caught) {
                    setError(errorMessage(caught));
                  }
                }}
                onUpload={async (file) => upload.mutateAsync({ file, kind: 'assignment' })}
                removing={remove.isPending}
                onRemove={async () => {
                  setError(null);
                  try {
                    await remove.mutateAsync(assignment.id);
                  } catch (caught) {
                    setError(errorMessage(caught));
                  }
                }}
                submissions={
                  assignment.id === assignedHere[0]?.id ? submissions.data?.items : undefined
                }
              />
            ))}
          </div>
        )}

        {canManage && (
          <form
            className="flex flex-col gap-3 border-t border-border pt-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);

              try {
                await create.mutateAsync({
                  lessonId,
                  dueLessonId: dueLessonId === '' ? null : dueLessonId,
                  text,
                  links: link.trim() === '' ? [] : [{ url: link.trim() }],
                  fileIds: files.map((file) => file.id),
                });
                setText('');
                setDueLessonId('');
                setLink('');
                setFiles([]);
              } catch (caught) {
                setError(errorMessage(caught));
              }
            }}
          >
            <Field label="Что задано">
              {/*
                `w-full` обязателен: без него `<textarea>` берёт ширину по умолчанию и выглядит
                узкой колонкой внутри широкого блока — владелец это заметил. Задание пишут
                несколько строк, поэтому поле должно занимать всю ширину.
              */}
              <textarea
                className="min-h-20 w-full rounded-md border border-border px-2 py-1.5 text-sm"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Прочитать главу 3 и ответить на вопросы"
              />
            </Field>

            <Field label="К какому уроку">
              <select
                className="w-full max-w-md rounded-md border border-border px-2 py-1.5 text-sm"
                value={dueLessonId}
                onChange={(event) => setDueLessonId(event.target.value)}
              >
                {/* Пустое значение — «следующий урок»: правило по умолчанию. */}
                <option value="">Следующий урок (по расписанию)</option>
                {dueOptions.map((option) => (
                  <option key={option.lessonId} value={option.lessonId}>
                    {option.lessonDate} · {option.pairNumber}-я пара
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                Ученик увидит задание в этом уроке и во всех промежуточных: можно принести раньше.
                Если следующего урока нет — задание останется на текущем.
              </span>
            </Field>

            <Field label="Ссылка">
              <TextInput
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="адрес ссылки"
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
              <span className="text-xs text-muted-foreground">
                Размер и тип проверяет сервер. Исполняемые файлы, скрипты, HTML и SVG запрещены
                всегда.
              </span>
            </Field>

            {files.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {files.map((file) => (
                  <li key={file.id} className="flex items-center gap-2">
                    <span>{file.originalName}</span>
                    <span className="text-muted-foreground">{formatSize(file.sizeBytes)}</span>
                    <button
                      type="button"
                      className="text-xs text-danger-foreground underline"
                      onClick={() =>
                        setFiles((current) => current.filter((item) => item.id !== file.id))
                      }
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

            <span className="text-xs text-muted-foreground">
              К одному уроку можно задать несколько работ: новая не затирает прошлую.
            </span>

            {error !== null && <Alert tone="error">{error}</Alert>}
          </form>
        )}

        {!canManage && assignedHere.length === 0 && fromEarlierLessons.length === 0 && (
          <EmptyState>К этому уроку задание не задано.</EmptyState>
        )}
      </div>
    </Card>
  );
}

function AssignmentBlock({
  assignment,
  canManage,
  formatSize,
  dueOptions,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onUpload,
  saving,
  onRemove,
  removing,
  submissions,
}: {
  assignment: HomeworkAssignmentSummaryDto;
  canManage: boolean;
  formatSize: (bytes: number) => string;
  dueOptions: { lessonId: string; lessonDate: string; pairNumber: number }[];
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (input: {
    text: string;
    dueLessonId: string;
    links: { url: string }[];
    fileIds: string[];
    /** Какие из уже приложенных файлов оставить. */
    keepFileIds: string[];
  }) => Promise<void>;
  /** Загрузка файла при правке: файл прикладывается к уже существующему заданию. */
  onUpload: (file: File) => Promise<UploadedFile>;
  saving: boolean;
  onRemove: () => Promise<void>;
  removing: boolean;
  submissions:
    | { studentName: string; isLate: boolean; files: { id: string; originalName: string }[] }[]
    | undefined;
}) {
  const [text, setText] = useState(assignment.text);
  const [dueLessonId, setDueLessonId] = useState(assignment.dueLessonId);
  /**
   * Ссылку правим **одним полем**: в интерфейсе задания ссылка одна, и возиться со списком
   * ради неё незачем. Существующую ссылку подставляем в поле при открытии правки.
   */
  const [link, setLink] = useState(assignment.links[0]?.url ?? '');
  /** Новые файлы, которые добавляем к заданию. */
  const [newFiles, setNewFiles] = useState<UploadedFile[]>([]);
  /**
   * Файлы, которые учитель **убрал** из задания.
   *
   * Файл не стирается: он помечается удалённым, как отметки в журнале. Поэтому в форме
   * написано «убрать» — так честнее по отношению к тому, что произойдёт.
   */
  const [removedFiles, setRemovedFiles] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  /**
   * Правка идёт **на месте**: отдельный экран для двух полей был бы лишним шагом. Форма
   * появляется вместо текста задания, а кнопки меняются на «Сохранить» и «Отмена».
   */
  if (isEditing) {
    return (
      <form
        className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3"
        onSubmit={async (event) => {
          event.preventDefault();
          await onSave({
            text,
            dueLessonId,
            /** Пустое поле — ссылок не будет: список заменяем целиком. */
            links: link.trim() === '' ? [] : [{ url: link.trim() }],
            fileIds: newFiles.map((file) => file.id),
            /** Оставляем те, у которых галочка не снята. */
            keepFileIds: assignment.files
              .filter((file) => !removedFiles.includes(file.id))
              .map((file) => file.id),
          });
        }}
      >
        <Field label="Что задано">
          {/* Та же правка, что в форме создания: поле задания — на всю ширину блока. */}
          <textarea
            className="min-h-20 w-full rounded-md border border-border px-2 py-1.5 text-sm"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>

        <Field label="К какому уроку">
          <select
            className="w-full max-w-md rounded-md border border-border px-2 py-1.5 text-sm"
            value={dueLessonId}
            onChange={(event) => setDueLessonId(event.target.value)}
          >
            <option value={assignment.dueLessonId}>
              {assignment.dueLessonDate} · текущий срок
            </option>
            {dueOptions.map((option) => (
              <option key={option.lessonId} value={option.lessonId}>
                {option.lessonDate} · {option.pairNumber}-я пара
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            Ученик увидит задание в новом уроке-сроке и во всех промежуточных.
          </span>
        </Field>

        <Field label="Ссылка">
          <TextInput
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="адрес ссылки"
          />
          <span className="text-xs text-muted-foreground">
            Ссылки заменяются целиком: то, что осталось в поле, и будет в задании. Очистите поле,
            чтобы убрать ссылку.
          </span>
        </Field>

        {assignment.links.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Сейчас в задании: {assignment.links.map((item) => item.title ?? item.url).join(', ')}
          </div>
        )}

        <Field label="Добавить файл">
          <input
            type="file"
            className="text-sm"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file === undefined) return;
              const uploaded = await onUpload(file);
              setNewFiles((current) => [...current, uploaded]);
              event.target.value = '';
            }}
          />
          <span className="text-xs text-muted-foreground">
            Размер и тип проверяет сервер. Исполняемые файлы, скрипты, HTML и SVG запрещены всегда.
          </span>
        </Field>

        {/*
          Список файлов задания с кнопкой «убрать».

          Файл не стирается: ставится **пометка**, как с отметками в журнале. Поэтому в форме
          написано «убрать», а не «удалить» — так честнее по отношению к тому, что произойдёт.
        */}
        {assignment.files.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Файлы задания:</span>
            {assignment.files.map((file) => (
              <label key={file.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!removedFiles.includes(file.id)}
                  onChange={(event) =>
                    setRemovedFiles((current) =>
                      event.target.checked
                        ? current.filter((id) => id !== file.id)
                        : [...current, file.id],
                    )
                  }
                />
                <span
                  className={
                    removedFiles.includes(file.id) ? 'text-subtle-foreground line-through' : ''
                  }
                >
                  {file.originalName}
                </span>
                <span className="text-muted-foreground">{formatSize(file.sizeBytes)}</span>
              </label>
            ))}
            <span className="text-xs text-muted-foreground">
              Снятая галочка помечает файл убранным: он исчезнет из задания, но останется в истории
              — файлы мы не стираем.
            </span>
          </div>
        )}

        {newFiles.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {newFiles.map((file) => (
              <li key={file.id} className="flex items-center gap-2">
                <span>{file.originalName}</span>
                <button
                  type="button"
                  className="text-xs text-danger-foreground underline"
                  onClick={() =>
                    setNewFiles((current) => current.filter((item) => item.id !== file.id))
                  }
                >
                  убрать
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
          <Button type="button" tone="secondary" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="whitespace-pre-wrap text-sm">{assignment.text}</p>

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        {/*
          Две даты: когда задали и к какому уроку. Учителю важно видеть обе — задание могло
          быть задано раньше, а проверять его нужно сейчас.
        */}
        <span>задано {assignment.lessonDate}</span>
        <span>сдать к {assignment.dueLessonDate}</span>
        <Badge tone={assignment.submittedCount === 0 ? 'neutral' : 'success'}>
          сдали {assignment.submittedCount} из {assignment.studentCount}
        </Badge>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" tone="secondary" onClick={onEdit}>
            Править
          </Button>

          {confirming ? (
            <>
              <span className="text-sm text-danger-foreground">
                Убрать задание у группы? Сдачи останутся в журнале.
              </span>
              <Button
                type="button"
                tone="danger"
                onClick={async () => {
                  await onRemove();
                  setConfirming(false);
                }}
                disabled={removing}
              >
                {removing ? 'Убираем…' : 'Да, убрать'}
              </Button>
              <Button type="button" tone="secondary" onClick={() => setConfirming(false)}>
                Отмена
              </Button>
            </>
          ) : (
            <Button type="button" tone="danger" onClick={() => setConfirming(true)}>
              Удалить
            </Button>
          )}
        </div>
      )}

      {assignment.links.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {assignment.links.map((item) => (
            <li key={item.id}>
              <a
                className="text-primary underline"
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
                className="text-primary underline"
                href={`/api/homework/files/${file.id}`}
                download
              >
                {file.originalName}
              </a>{' '}
              <span className="text-muted-foreground">{formatSize(file.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div>
          <p className="text-sm font-medium text-foreground">Сдавшие</p>
          {submissions === undefined || submissions.length === 0 ? (
            <EmptyState>Пока никто не сдал.</EmptyState>
          ) : (
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {submissions.map((submission) => (
                <li key={submission.studentName} className="flex flex-wrap items-center gap-2">
                  <span>{submission.studentName}</span>
                  {submission.isLate ? (
                    <Badge tone="danger">сдано позже срока</Badge>
                  ) : (
                    <Badge tone="success">в срок</Badge>
                  )}
                  {submission.files.map((file) => (
                    <a
                      key={file.id}
                      className="text-primary underline"
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
  );
}
