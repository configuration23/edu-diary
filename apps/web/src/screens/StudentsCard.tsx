import { Fragment, useState } from 'react';

import type { UserSummaryDto } from '@edu-diary/contracts';
import { errorMessage } from '../lib/api-client';
import {
  useCreateStudent,
  useCreateStudentAccount,
  useDeleteStudent,
  useUpdateStudent,
  useGuardianLinks,
  useLinkGuardian,
  useStudents,
  useUnlinkGuardian,
  useUsers,
} from '../lib/queries';
import { Pagination, usePageSize } from '../components/Pagination';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  FormActions,
  formatDate,
  Select,
  Table,
  TextInput,
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

function CreateStudentForm({
  onCreated,
  onDone,
}: {
  onCreated: (message: string) => void;
  /** Закрыть форму после создания: человеку нужен список, а не пустая форма. */
  onDone: () => void;
}) {
  const createStudent = useCreateStudent();

  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [note, setNote] = useState('');
  const [withAccount, setWithAccount] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  return (
    <Card
      title="Новый ученик"
      description="Учётную запись можно создать сразу или позже — по необходимости."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();

          try {
            const trimmedNote = note.trim();
            const trimmedUsername = username.trim().toLowerCase();
            const trimmedEmail = email.trim();
            const trimmedPhone = phone.trim();

            await createStudent.mutateAsync({
              fullName: fullName.trim(),
              // Пустые поля не отправляем совсем: раньше они уходили как `null`,
              // и сервер отвечал 400 на создание ученика без даты или примечания.
              ...(birthDate === '' ? {} : { birthDate }),
              ...(trimmedNote === '' ? {} : { note: trimmedNote }),
              ...(withAccount
                ? {
                    account: {
                      username: trimmedUsername,
                      password,
                      ...(trimmedEmail === '' ? {} : { email: trimmedEmail }),
                      ...(trimmedPhone === '' ? {} : { phone: trimmedPhone }),
                    },
                  }
                : {}),
            });

            const created = fullName.trim();
            setFullName('');
            setBirthDate('');
            setNote('');
            setUsername('');
            setPassword('');
            setEmail('');
            setPhone('');
            setWithAccount(false);
            onCreated(
              withAccount
                ? `Ученик «${created}» заведён вместе с учётной записью.`
                : `Ученик «${created}» заведён. Учётную запись можно создать позже.`,
            );
            /** Форму закрываем: дальше человек работает со списком. */
            onDone();
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
          <Field label="Примечание" hint="Необязательно: только факты по учёбе">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>

        <Checkbox
          className="flex items-center gap-2 text-sm text-foreground"
          checked={withAccount}
          onChange={(event) => setWithAccount(event.target.checked)}
          label="Сразу создать учётную запись (роль «Ученик»)"
        />

        {withAccount && (
          <div className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2">
            <Field label="Логин" hint="Строчные латинские буквы и цифры">
              <TextInput
                required={withAccount}
                autoComplete="off"
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
          </div>
        )}

        {createStudent.isError && <Alert tone="error">{errorMessage(createStudent.error)}</Alert>}

        {/*
          «Отмена» обязательна: форма открывается кнопкой, и без неё единственный способ её
          закрыть — завести ученика или перезагрузить страницу.
        */}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={createStudent.isPending}>
            Завести ученика
          </Button>
          <Button tone="secondary" onClick={onDone}>
            Отмена
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function LinkGuardianForm({ onLinked }: { onLinked: (message: string) => void }) {
  const students = useStudents({ limit: 200 });
  const users = useUsers({ role: 'parent' });
  const link = useLinkGuardian();

  const [studentId, setStudentId] = useState('');
  const [guardianUserId, setGuardianUserId] = useState('');
  const [relation, setRelation] = useState<string>('representative');

  // Связи выбранного ученика: чтобы не предлагать того, кто уже привязан, в том
  // числе под другим отношением (иначе человека можно записать и матерью, и отцом).
  const linked = useGuardianLinks(studentId === '' ? undefined : studentId);
  const linkedGuardianIds = new Set(
    (linked.data?.items ?? [])
      .filter((link) => link.studentId === studentId)
      .map((link) => link.guardianUserId),
  );

  const guardians = (users.data?.items ?? []).filter(
    (user: UserSummaryDto) => !linkedGuardianIds.has(user.id),
  );
  const linkedGuardians = (users.data?.items ?? []).filter((user: UserSummaryDto) =>
    linkedGuardianIds.has(user.id),
  );

  return (
    <Card
      title="Привязка законного представителя"
      description="Один представитель привязывается к ученику один раз; к ученику можно привязать несколько представителей."
    >
      <form
        className="flex flex-col gap-3"
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
            <Select
              required
              className="rounded-md border border-border px-3 py-2 text-sm"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
            >
              <option value="">— выберите —</option>
              {(students.data?.items ?? []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Законный представитель">
            <Select
              required
              className="rounded-md border border-border px-3 py-2 text-sm"
              value={guardianUserId}
              onChange={(event) => setGuardianUserId(event.target.value)}
            >
              <option value="">— выберите —</option>
              {guardians.map((user: UserSummaryDto) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </Select>
          </Field>{' '}
          <Field label="Кем является">
            <Select
              className="rounded-md border border-border px-3 py-2 text-sm"
              value={relation}
              onChange={(event) => setRelation(event.target.value)}
            >
              {RELATIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {guardians.length === 0 && (
          <Alert tone="warning">
            {linkedGuardians.length > 0
              ? 'Все законные представители этого ученика уже привязаны. Другого можно создать блоком «Новый законный представитель» в разделе «Учётные записи и роли».'
              : 'Учётных записей с ролью «Родитель» пока нет — создайте их блоком «Новый законный представитель» в разделе «Учётные записи и роли».'}
          </Alert>
        )}

        {linkedGuardians.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Уже привязаны: {linkedGuardians.map((user: UserSummaryDto) => user.fullName).join(', ')}
            . Одного и того же человека нельзя привязать дважды.
          </p>
        )}

        {link.isError && <Alert tone="error">{errorMessage(link.error)}</Alert>}

        {/* Действие справа: форма заканчивается кнопкой, а не обрывается на левом краю. */}
        <div className="flex justify-end">
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
  onCancel,
}: {
  studentId: string;
  studentName: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const createAccount = useCreateStudentAccount();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  return (
    <div className="mt-3 rounded-md border border-border p-4">
      <p className="mb-3 text-sm text-foreground">
        Учётная запись для «{studentName}»: роль «Ученик» подставляется автоматически.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Логин" hint="Строчные латинские буквы и цифры">
          <TextInput
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field label="Временный пароль" hint="Минимум 10 символов">
          <TextInput
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
      </div>
      {/*
        Действия справа, отмена — слева от создания. Без неё из формы нельзя было выйти, не создав
        учётную запись (замечание владельца).
      */}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button tone="secondary" onClick={onCancel}>
          Отмена
        </Button>
        <Button
          disabled={createAccount.isPending || username === '' || password.length < 10}
          onClick={async () => {
            await createAccount.mutateAsync({
              studentId,
              username,
              password,
              ...(email.trim() === '' ? {} : { email: email.trim() }),
              ...(phone.trim() === '' ? {} : { phone: phone.trim() }),
            });
            onDone(`Учётная запись «${username}» создана.`);
          }}
        >
          Создать
        </Button>
      </div>
      {createAccount.isError && <Alert tone="error">{errorMessage(createAccount.error)}</Alert>}
    </div>
  );
}

/**
 * Ученики: заведение (с учётной записью по необходимости) и список.
 *
 * Живёт в разделе «Группы и ученики»: группа собирается из учеников, поэтому
 * список людей идёт первым, а группа — следом.
 */
/**
 * Правка ученика — строкой под ним самим.
 *
 * Владелец: открывать по клику на ФИО, а не отдельной кнопкой; поля — только дата рождения и
 * примечание (ФИО меняется редко и через отдельный путь). Кнопки справа: «Сохранить» и «Отменить».
 */
function StudentEditForm({
  student,
  onDone,
}: {
  student: { id: string; birthDate: string | null; note: string | null };
  onDone: () => void;
}) {
  const update = useUpdateStudent();

  const [birthDate, setBirthDate] = useState(student.birthDate ?? '');
  const [note, setNote] = useState(student.note ?? '');

  return (
    <form
      className="rounded-md border border-border bg-card p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await update.mutateAsync({
            studentId: student.id,
            birthDate: birthDate === '' ? null : birthDate,
            note: note === '' ? null : note,
          });
          onDone();
        } catch {
          // Ошибка показывается ниже из состояния запроса.
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Дата рождения">
          <TextInput
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
          />
        </Field>
        <Field label="Примечание">
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>

      <FormActions
        submitLabel="Сохранить"
        pending={update.isPending}
        onCancel={onDone}
        cancelLabel="Отменить"
        align="end"
        className="mt-3"
      />
      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
    </form>
  );
}

export function StudentsCard({ onNotice }: { onNotice: (message: string) => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(10);
  const students = useStudents({ search, limit: pageSize, offset: (page - 1) * pageSize });
  const [accountFor, setAccountFor] = useState<{ id: string; name: string } | null>(null);
  /** Причина отказа при удалении: сервер объясняет, что мешает. */
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteStudent = useDeleteStudent();
  /** Ученик, чью карточку правим: форма открывается кликом по ФИО. */
  const [editing, setEditing] = useState<{
    id: string;
    birthDate: string | null;
    note: string | null;
  } | null>(null);
  /** Форма ученика скрыта, пока её не позовут кнопкой: список важнее формы. */
  const [creating, setCreating] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {/**
       * Форма — **над списком** и только по кнопке (просьба владельца). Так первый экран занят
       * учениками, а не полями создания.
       */}
      {creating && <CreateStudentForm onCreated={onNotice} onDone={() => setCreating(false)} />}

      <Card
        title="Ученики"
        description="Карточка ученика — основа зачисления, согласий и журнала."
        actions={
          /**
           * Скрыта, пока форма открыта: у самой формы есть «создать» и «отмена», а две одинаковые
           * кнопки на экране путают — этим и попался сквозной сценарий.
           */
          creating ? undefined : <Button onClick={() => setCreating(true)}>Завести ученика</Button>
        }
      >
        <div className="mb-3">
          <Field label="Поиск">
            <TextInput
              placeholder="ФИО ученика"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                // Поиск меняет выборку: возвращаемся на первую страницу.
                setPage(1);
              }}
              className="sm:max-w-xs"
            />
          </Field>
        </div>

        {students.isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
        {students.isError && <Alert tone="error">{errorMessage(students.error)}</Alert>}

        {students.data !== undefined && students.data.items.length === 0 && (
          <EmptyState>
            {search === ''
              ? 'Учеников пока нет — заведите первого выше.'
              : 'По запросу никого не найдено.'}
          </EmptyState>
        )}

        {students.data !== undefined && students.data.items.length > 0 && (
          <Table head={['ФИО', 'Дата рождения', 'Учётная запись', 'Примечание', '']}>
            {students.data.items.map((student) => (
              <Fragment key={student.id}>
                <tr className="border-b border-border">
                  <td className="px-3 py-2 font-medium">
                    {/*
                    Правка открывается кликом по ФИО, а не отдельной кнопкой (просьба владельца):
                    карточка и есть объект правки, искать кнопку в конце строки не нужно.
                  */}
                    <Button
                      tone="ghost"
                      className="px-0"
                      onClick={() =>
                        setEditing(
                          editing?.id === student.id
                            ? null
                            : {
                                id: student.id,
                                birthDate: student.birthDate,
                                note: student.note,
                              },
                        )
                      }
                    >
                      {student.fullName}
                    </Button>
                  </td>
                  <td className="px-3 py-2">{formatDate(student.birthDate)}</td>
                  <td className="px-3 py-2">
                    {student.username === null ? (
                      <Badge tone="warning">учётной записи нет</Badge>
                    ) : (
                      <Badge tone="success">{student.username}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{student.note ?? '—'}</td>
                  <td className="px-3 py-2">
                    {student.username === null && (
                      <span className="flex flex-wrap gap-2">
                        <Button
                          tone="ghost"
                          onClick={() => setAccountFor({ id: student.id, name: student.fullName })}
                        >
                          Создать УЗ
                        </Button>
                        {/*
                        Удаление показываем только у ученика без учётной записи. Согласие и
                        зачисления проверяет сервер и объясняет причину отказа: экран не должен
                        повторять правила сервера, иначе они разойдутся.
                      */}
                        <Button
                          tone="ghost"
                          disabled={deleteStudent.isPending}
                          onClick={() => {
                            setDeleteError(null);
                            void deleteStudent.mutateAsync(student.id).catch((caught) => {
                              setDeleteError(errorMessage(caught));
                            });
                          }}
                        >
                          Удалить
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>

                {editing?.id === student.id && (
                  <tr data-static className="border-b border-border">
                    <td colSpan={5} className="px-3 py-3">
                      <StudentEditForm student={editing} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}

        {students.data !== undefined && students.data.total > 0 && (
          <Pagination
            total={students.data.total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}

        {accountFor !== null && (
          <AccountForm
            studentId={accountFor.id}
            studentName={accountFor.name}
            onDone={(message) => {
              setAccountFor(null);
              setAccountNotice(message);
            }}
            onCancel={() => setAccountFor(null)}
          />
        )}

        {/* Результат создания учётной записи показывается здесь же, под списком,
            а не общей плашкой внизу страницы. */}
        {accountNotice !== null && <Alert tone="success">{accountNotice}</Alert>}
        {deleteError !== null && <Alert tone="error">{deleteError}</Alert>}
      </Card>
    </div>
  );
}

/**
 * Кто к кому привязан.
 *
 * Без этого списка привязка выглядела как «нажал и ничего не произошло»: запись
 * в базе появлялась, но её нигде не было видно.
 */
export function GuardianLinksCard({ onNotice }: { onNotice: (message: string) => void }) {
  const links = useGuardianLinks();
  const unlink = useUnlinkGuardian();

  return (
    <Card
      title="Связи учеников и представителей"
      description="Отвязка убирает доступ представителя к данным ученика."
    >
      {links.isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
      {links.isError && <Alert tone="error">{errorMessage(links.error)}</Alert>}

      {links.data !== undefined && links.data.items.length === 0 && (
        <EmptyState>Связей пока нет — привяжите представителя блоком выше.</EmptyState>
      )}

      {links.data !== undefined && links.data.items.length > 0 && (
        <Table head={['Ученик', 'Представитель', 'Логин', 'Кем является', '']}>
          {links.data.items.map((link) => (
            <tr key={link.id} className="border-b border-border">
              <td className="px-3 py-2 font-medium">{link.studentName}</td>
              <td className="px-3 py-2">{link.guardianName}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {link.guardianUsername}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{relationLabel(link.relation)}</td>
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
