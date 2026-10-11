import { useState } from 'react';

import type { UserSummaryDto } from '@edu-diary/contracts';
import { errorMessage } from '../lib/api-client';
import {
  useCreateStudent,
  useCreateStudentAccount,
  useGuardianLinks,
  useLinkGuardian,
  useStudents,
  useSuggestUsername,
  useUnlinkGuardian,
  useUsers,
} from '../lib/queries';
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

/**
 * Ученики и законные представители.
 *
 * Ученик — это запись учебного процесса, а учётная запись — её атрибут: вход в
 * систему нужен не всем и не сразу. Поэтому карточка ученика создаётся здесь
 * (вместе с остальными пользователями), а учётная запись — по необходимости:
 * либо сразу, либо потом кнопкой «Создать учётную запись».
 *
 * Раньше карточки учеников заводились в разделе «Согласия и политика», из-за
 * чего учеников не было видно среди пользователей, а учётные записи учеников —
 * в списках зачисления. Теперь источник один.
 */

const RELATIONS = [
  { value: 'mother', label: 'Мать' },
  { value: 'father', label: 'Отец' },
  { value: 'representative', label: 'Законный представитель' },
  { value: 'custodian', label: 'Опекун' },
  { value: 'other', label: 'Другое' },
] as const;

/** Подпись отношения: в базе хранится код, человеку показываем слово. */
function relationLabel(value: string | null): string {
  return RELATIONS.find((item) => item.value === value)?.label ?? 'Не указано';
}

function CreateStudentForm({ onCreated }: { onCreated: (message: string) => void }) {
  const createStudent = useCreateStudent();
  const suggest = useSuggestUsername();

  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [note, setNote] = useState('');
  const [withAccount, setWithAccount] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  /** Подсказка логина по ФИО: занятость проверяет сервер. */
  const suggestLogin = async (): Promise<void> => {
    setHint(null);
    if (fullName.trim() === '') {
      setHint('Сначала заполните ФИО.');
      return;
    }

    const result = await suggest.mutateAsync(fullName.trim());
    if (result.username === null) {
      setHint('Не удалось построить логин из ФИО — введите его вручную.');
      return;
    }

    setUsername(result.username);
    setHint(
      result.taken.length === 0
        ? `Логин свободен: ${result.username}`
        : `Базовый логин занят, предложен ${result.username}`,
    );
  };

  return (
    <Card
      title="Новый ученик"
      description="Учётную запись можно создать сразу или позже — по необходимости."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setHint(null);

          try {
            await createStudent.mutateAsync({
              fullName: fullName.trim(),
              birthDate: birthDate === '' ? null : birthDate,
              note: note === '' ? null : note,
              ...(withAccount
                ? { account: { username: username.trim().toLowerCase(), password } }
                : {}),
            });

            const created = fullName.trim();
            setFullName('');
            setBirthDate('');
            setNote('');
            setUsername('');
            setPassword('');
            setWithAccount(false);
            onCreated(
              withAccount
                ? `Ученик «${created}» заведён вместе с учётной записью.`
                : `Ученик «${created}» заведён. Учётную запись можно создать позже.`,
            );
          } catch {
            // Ошибка показывается ниже из состояния запроса.
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="ФИО">
            <TextInput
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </Field>
          <Field label="Дата рождения" hint="Необязательно">
            <TextInput
              type="date"
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
            />
          </Field>
          <Field label="Примечание" hint="Только факты по учёбе">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={withAccount}
            onChange={(event) => setWithAccount(event.target.checked)}
          />
          Сразу создать учётную запись (роль «Ученик»)
        </label>

        {withAccount && (
          <div className="grid gap-4 rounded-md border border-slate-200 p-4 sm:grid-cols-3">
            <Field label="Логин" hint="Строчные латинские буквы и цифры">
              <TextInput
                required={withAccount}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field label="Временный пароль" hint="Минимум 10 символов">
              <TextInput
                required={withAccount}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <div className="flex items-end pb-2">
              <Button
                tone="secondary"
                onClick={() => void suggestLogin()}
                disabled={suggest.isPending}
              >
                Предложить логин по ФИО
              </Button>
            </div>
          </div>
        )}

        {hint !== null && <Alert tone="info">{hint}</Alert>}
        {suggest.isError && <Alert tone="error">{errorMessage(suggest.error)}</Alert>}
        {createStudent.isError && <Alert tone="error">{errorMessage(createStudent.error)}</Alert>}

        <div>
          <Button type="submit" disabled={createStudent.isPending}>
            Завести ученика
          </Button>
        </div>
      </form>
    </Card>
  );
}

function LinkGuardianForm({ onLinked }: { onLinked: (message: string) => void }) {
  const students = useStudents({ limit: 200 });
  const users = useUsers({ role: 'parent' });
  const link = useLinkGuardian();

  const [studentId, setStudentId] = useState('');
  const [guardianUserId, setGuardianUserId] = useState('');
  const [relation, setRelation] = useState<string>('representative');

  const guardians = users.data?.items ?? [];

  return (
    <Card
      title="Привязка законного представителя"
      description="Представитель видит только привязанных детей."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();

          try {
            await link.mutateAsync({ studentId, guardianUserId, relation });
            const name =
              (students.data?.items ?? []).find((student) => student.id === studentId)?.fullName ??
              'Ученик';
            setStudentId('');
            setGuardianUserId('');
            setRelation('representative');
            onLinked(`Представитель привязан к ученику «${name}».`);
          } catch {
            // Ошибка показывается ниже.
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ученик">
            <select
              required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
            >
              <option value="">— выберите —</option>
              {(students.data?.items ?? []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Законный представитель">
            <select
              required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={guardianUserId}
              onChange={(event) => setGuardianUserId(event.target.value)}
            >
              <option value="">— выберите —</option>
              {guardians.map((user: UserSummaryDto) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Кем является">
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={relation}
              onChange={(event) => setRelation(event.target.value)}
            >
              {RELATIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {guardians.length === 0 && (
          <Alert tone="warning">
            Пользователей с ролью «Родитель» пока нет — создайте их блоком выше.
          </Alert>
        )}
        {link.isError && <Alert tone="error">{errorMessage(link.error)}</Alert>}

        <div>
          <Button type="submit" disabled={link.isPending}>
            Привязать
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AccountForm({
  studentId,
  studentName,
  onDone,
}: {
  studentId: string;
  studentName: string;
  onDone: (message: string) => void;
}) {
  const createAccount = useCreateStudentAccount();
  const suggest = useSuggestUsername();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="mt-3 rounded-md border border-slate-200 p-4">
      <p className="mb-3 text-sm text-slate-700">
        Учётная запись для «{studentName}»: роль «Ученик» подставляется автоматически.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Логин">
          <TextInput value={username} onChange={(event) => setUsername(event.target.value)} />
        </Field>
        <Field label="Временный пароль" hint="Минимум 10 символов">
          <TextInput
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <div className="flex items-end gap-2 pb-2">
          <Button
            tone="secondary"
            disabled={suggest.isPending}
            onClick={async () => {
              const result = await suggest.mutateAsync(studentName);
              if (result.username !== null) setUsername(result.username);
            }}
          >
            Предложить логин
          </Button>
          <Button
            disabled={createAccount.isPending || username === '' || password.length < 10}
            onClick={async () => {
              await createAccount.mutateAsync({ studentId, username, password });
              onDone(`Учётная запись «${username}» создана.`);
            }}
          >
            Создать
          </Button>
        </div>
      </div>
      {createAccount.isError && <Alert tone="error">{errorMessage(createAccount.error)}</Alert>}
      {suggest.isError && <Alert tone="error">{errorMessage(suggest.error)}</Alert>}
    </div>
  );
}

export function StudentsCard({ onNotice }: { onNotice: (message: string) => void }) {
  const students = useStudents({ limit: 200 });
  const [accountFor, setAccountFor] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <CreateStudentForm onCreated={onNotice} />

      <Card title="Ученики" description="Карточка ученика — основа зачисления, согласий и журнала.">
        {students.isLoading && <p className="text-sm text-slate-500">Загружаем…</p>}
        {students.isError && <Alert tone="error">{errorMessage(students.error)}</Alert>}

        {students.data !== undefined && students.data.items.length === 0 && (
          <EmptyState>Учеников пока нет — заведите первого выше.</EmptyState>
        )}

        {students.data !== undefined && students.data.items.length > 0 && (
          <Table head={['ФИО', 'Дата рождения', 'Учётная запись', 'Примечание', '']}>
            {students.data.items.map((student) => (
              <tr key={student.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{student.fullName}</td>
                <td className="px-3 py-2">{formatDate(student.birthDate)}</td>
                <td className="px-3 py-2">
                  {student.username === null ? (
                    <Badge tone="warning">учётной записи нет</Badge>
                  ) : (
                    <Badge tone="success">{student.username}</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{student.note ?? '—'}</td>
                <td className="px-3 py-2">
                  {student.username === null && (
                    <Button
                      tone="ghost"
                      onClick={() => setAccountFor({ id: student.id, name: student.fullName })}
                    >
                      Создать учётную запись
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}

        {accountFor !== null && (
          <AccountForm
            studentId={accountFor.id}
            studentName={accountFor.name}
            onDone={(message) => {
              setAccountFor(null);
              onNotice(message);
            }}
          />
        )}
      </Card>

      <LinkGuardianForm onLinked={onNotice} />

      <GuardianLinksCard onNotice={onNotice} />
    </div>
  );
}

/**
 * Кто к кому привязан.
 *
 * Без этого списка привязка выглядела как «нажал и ничего не произошло»: запись
 * в базе появлялась, но её нигде не было видно.
 */
function GuardianLinksCard({ onNotice }: { onNotice: (message: string) => void }) {
  const links = useGuardianLinks();
  const unlink = useUnlinkGuardian();

  return (
    <Card
      title="Связи учеников и представителей"
      description="Отвязка убирает доступ представителя к данным ученика."
    >
      {links.isLoading && <p className="text-sm text-slate-500">Загружаем…</p>}
      {links.isError && <Alert tone="error">{errorMessage(links.error)}</Alert>}

      {links.data !== undefined && links.data.items.length === 0 && (
        <EmptyState>Связей пока нет — привяжите представителя блоком выше.</EmptyState>
      )}

      {links.data !== undefined && links.data.items.length > 0 && (
        <Table head={['Ученик', 'Представитель', 'Логин', 'Кем является', '']}>
          {links.data.items.map((link) => (
            <tr key={link.id} className="border-b border-slate-100">
              <td className="px-3 py-2 font-medium">{link.studentName}</td>
              <td className="px-3 py-2">{link.guardianName}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-600">
                {link.guardianUsername}
              </td>
              <td className="px-3 py-2 text-slate-600">{relationLabel(link.relation)}</td>
              <td className="px-3 py-2">
                <Button
                  tone="ghost"
                  disabled={unlink.isPending}
                  onClick={() =>
                    void unlink
                      .mutateAsync({ studentId: link.studentId, linkId: link.id })
                      .then(() =>
                        onNotice(`Представитель «${link.guardianName}» отвязан от ученика.`),
                      )
                      .catch(() => undefined)
                  }
                >
                  Отвязать
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {unlink.isError && <Alert tone="error">{errorMessage(unlink.error)}</Alert>}
    </Card>
  );
}
