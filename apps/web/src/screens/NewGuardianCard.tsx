import { useState } from 'react';

import { errorMessage } from '../lib/api-client';
import { useCreateUser, useLinkGuardian, useStudents } from '../lib/queries';
import { Alert, Button, EmptyState, Field, TextInput } from '../components/ui';

/**
 * Новый законный представитель.
 *
 * Учётная запись родителя создаётся только вместе с привязкой к ученику: без
 * ребёнка такая учётная запись бессмысленна, и её появление в системе — ошибка
 * учёта. Роль «Родитель» подставляется автоматически и не выбирается.
 *
 * Роли ученика и родителя убраны из общей формы пользователей, поэтому путаницы
 * «создал ученика, а он не виден в списках» больше не возникает: у ученика своя
 * форма в разделе групп, у представителя — эта.
 */

const RELATIONS = [
  { value: 'mother', label: 'Мать' },
  { value: 'father', label: 'Отец' },
  { value: 'representative', label: 'Законный представитель' },
  { value: 'custodian', label: 'Опекун' },
  { value: 'other', label: 'Другое' },
] as const;

/**
 * Форма представителя без своей карточки: она живёт внутри блока с вкладками
 * («Новая учётная запись» / «Новый законный представитель»), поэтому заголовок и
 * рамку рисует родитель.
 */
export function NewGuardianForm({ onCreated }: { onCreated: (message: string) => void }) {
  const createUser = useCreateUser();
  const linkGuardian = useLinkGuardian();
  const students = useStudents({ limit: 200 });

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [studentId, setStudentId] = useState('');
  const [relation, setRelation] = useState<string>('representative');
  const [error, setError] = useState<string | null>(null);

  const studentOptions = students.data?.items ?? [];

  return (
    <div>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);

          try {
            const trimmedEmail = email.trim();
            const trimmedPhone = phone.trim();

            const user = await createUser.mutateAsync({
              username: username.trim().toLowerCase(),
              fullName: fullName.trim(),
              password,
              roles: ['parent'],
              ...(trimmedEmail === '' ? {} : { email: trimmedEmail }),
              ...(trimmedPhone === '' ? {} : { phone: trimmedPhone }),
            });

            await linkGuardian.mutateAsync({
              studentId,
              guardianUserId: user.id,
              relation,
            });

            const studentName =
              studentOptions.find((student) => student.id === studentId)?.fullName ?? 'ученику';
            const created = fullName.trim();
            setFullName('');
            setUsername('');
            setPassword('');
            setEmail('');
            setPhone('');
            setStudentId('');
            setRelation('representative');
            onCreated(`Представитель «${created}» создан и привязан к «${studentName}».`);
          } catch (caught) {
            setError(errorMessage(caught));
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ФИО">
            <TextInput
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </Field>
          <Field label="Логин" hint="Строчные латинские буквы, цифры, точка, дефис">
            <TextInput
              required
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="Временный пароль" hint="Минимум 10 символов">
            <TextInput
              required
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label="Почта" hint="Необязательно">
            <TextInput
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Телефон" hint="Необязательно">
            <TextInput value={phone} onChange={(event) => setPhone(event.target.value)} />
          </Field>
          <Field label="Кем является">
            <select
              className="rounded-md border border-border px-3 py-2 text-sm"
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

        <Field label="Ученик" hint="К кому привязать представителя">
          <select
            required
            className="rounded-md border border-border px-3 py-2 text-sm"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
          >
            <option value="">— выберите —</option>
            {studentOptions.map((student) => (
              <option key={student.id} value={student.id}>
                {student.fullName}
              </option>
            ))}
          </select>
        </Field>

        {students.data !== undefined && studentOptions.length === 0 && (
          <EmptyState>
            Учеников ещё нет. Представителя можно завести только к ученику — сначала заведите
            ученика в разделе «Группы и ученики».
          </EmptyState>
        )}

        <p className="text-xs text-muted-foreground">
          Создаются два действия подряд: учётная запись с ролью «Родитель» и привязка к ученику.
          Если привязка не прошла, учётная запись остаётся — её видно в списке ниже, и привязку
          можно повторить блоком «Привязка законного представителя».
        </p>

        {error !== null && <Alert tone="error">{error}</Alert>}

        <div>
          <Button
            type="submit"
            disabled={
              createUser.isPending ||
              linkGuardian.isPending ||
              studentOptions.length === 0 ||
              password.length < 10
            }
          >
            Создать и привязать
          </Button>
        </div>
      </form>
    </div>
  );
}
