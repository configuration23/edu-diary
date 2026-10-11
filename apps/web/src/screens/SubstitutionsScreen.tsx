import type { SubstitutionDto } from '@edu-diary/contracts';
import { useState } from 'react';

import {
  Alert,
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
  useCreateSubstitution,
  useDeleteSubstitution,
  useLessons,
  useSubstituteCandidates,
  useSubstitutions,
} from '../lib/queries';

/**
 * Быстрая замена: администратор выбирает урок и заменяющего.
 *
 * Работаем «от урока» (решение владельца): занятие уже есть в расписании, поэтому
 * не нужно угадывать, кого и когда заменять. Кандидаты приходят со статусом
 * занятости, поэтому занятого видно до сохранения, а сервер такую замену отклонит.
 *
 * Замены публикуются сразу — черновика нет (решение владельца).
 */

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm';

const REASONS = ['Больничный', 'Командировка', 'Мероприятие', 'Другое'];

function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Замена на один урок: выбор урока, кандидата и причины. */
function QuickSubstitution({ groupId }: { groupId: string | null }) {
  const lessons = useLessons({
    ...(groupId === null ? {} : { studyGroupId: groupId }),
    from: shiftDays(-7),
    to: shiftDays(30),
    status: 'planned',
  });
  const [lessonId, setLessonId] = useState('');
  const [substituteUserId, setSubstituteUserId] = useState('');
  const [reason, setReason] = useState(REASONS[0] ?? '');
  const [customReason, setCustomReason] = useState('');

  const candidates = useSubstituteCandidates(lessonId === '' ? null : lessonId);
  const create = useCreateSubstitution();

  const planned = lessons.data?.items ?? [];
  const selectedLesson = planned.find((lesson) => lesson.id === lessonId);
  const finalReason = reason === 'Другое' ? customReason : reason;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await create.mutateAsync({
            lessonId,
            substituteUserId,
            reason: finalReason,
          });
          setLessonId('');
          setSubstituteUserId('');
          setCustomReason('');
        } catch {
          // Ошибка показывается ниже.
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Урок" hint="Что заменяем: дата, пара и группа">
          <select
            required
            name="lessonId"
            className={selectClass}
            value={lessonId}
            onChange={(event) => {
              setLessonId(event.target.value);
              setSubstituteUserId('');
            }}
          >
            <option value="">— выберите урок —</option>
            {planned.map((lesson) => (
              <option key={lesson.id} value={lesson.id}>
                {formatDate(lesson.lessonDate)}, {lesson.pairNumber}-я пара · {lesson.subjectName} ·{' '}
                {lesson.groupName} · {lesson.teacherName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Заменяющий" hint="Сначала свободные на эту пару">
          <select
            required
            name="substituteUserId"
            className={selectClass}
            value={substituteUserId}
            onChange={(event) => setSubstituteUserId(event.target.value)}
            disabled={lessonId === '' || candidates.data === undefined}
          >
            <option value="">
              {lessonId === '' ? 'Сначала выберите урок' : '— выберите преподавателя —'}
            </option>
            {(candidates.data?.items ?? [])
              .filter((candidate) => candidate.status !== 'assigned')
              .map((candidate) => (
                <option key={candidate.userId} value={candidate.userId}>
                  {candidate.status === 'free'
                    ? `${candidate.fullName} — свободен`
                    : `${candidate.fullName} — занят: ${candidate.busyGroupName ?? ''}, ${candidate.busySubjectName ?? ''}`}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Причина">
          <select
            required
            name="reason"
            className={selectClass}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {REASONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>

        {reason === 'Другое' && (
          <Field label="Причина своими словами">
            <TextInput
              required
              value={customReason}
              onChange={(event) => setCustomReason(event.target.value)}
            />
          </Field>
        )}
      </div>

      {selectedLesson !== undefined && (
        <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          {formatDate(selectedLesson.lessonDate)}, {selectedLesson.pairNumber}-я пара,{' '}
          {selectedLesson.timeStart}–{selectedLesson.timeEnd} · {selectedLesson.groupName} · вместо:{' '}
          {selectedLesson.teacherName}
        </div>
      )}

      <div>
        <Button
          type="submit"
          disabled={
            create.isPending || lessonId === '' || substituteUserId === '' || finalReason === ''
          }
        >
          Оформить замену
        </Button>
      </div>

      {create.isSuccess && <Alert tone="success">Замена оформлена и опубликована.</Alert>}
      {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
    </form>
  );
}

/** Журнал замен: что заменено и кем. */
function SubstitutionJournal() {
  const substitutions = useSubstitutions();
  const remove = useDeleteSubstitution();

  const items = substitutions.data?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && !substitutions.isLoading && (
        <EmptyState>Замен нет: в расписании все ведут свои пары.</EmptyState>
      )}

      {items.length > 0 && (
        <Table head={['Дата', 'Кто заменён', 'Кто ведёт', 'Причина', 'Оформил', '']}>
          {items.map((substitution: SubstitutionDto) => (
            <tr key={substitution.id} className="border-b border-slate-100">
              <td className="px-3 py-2 whitespace-nowrap">
                {formatDate(substitution.startsOn)}
                {substitution.endsOn !== null && substitution.endsOn !== substitution.startsOn
                  ? ` — ${formatDate(substitution.endsOn)}`
                  : ''}
              </td>
              <td className="px-3 py-2">{substitution.replacedName || '—'}</td>
              <td className="px-3 py-2">{substitution.substituteName || '—'}</td>
              <td className="px-3 py-2">{substitution.reason}</td>
              <td className="px-3 py-2 text-slate-500">{substitution.createdByName ?? '—'}</td>
              <td className="px-3 py-2">
                <Button
                  tone="ghost"
                  disabled={remove.isPending}
                  onClick={() => void remove.mutateAsync(substitution.id).catch(() => undefined)}
                >
                  Снять
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {remove.isError && <Alert tone="error">{errorMessage(remove.error)}</Alert>}
    </div>
  );
}

export function SubstitutionsScreen({
  groupId,
  canManage,
}: {
  groupId: string | null;
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <Card
          title="Быстрая замена"
          description="Замена на один урок: занятие, заменяющий и причина. Публикуется сразу, причина остаётся в журнале."
        >
          <QuickSubstitution groupId={groupId} />
        </Card>
      )}

      <Card
        title="Журнал замен"
        description="Действующие замены: кто кого заменяет и на какой срок."
      >
        <SubstitutionJournal />
      </Card>
    </div>
  );
}
