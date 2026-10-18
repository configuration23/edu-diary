import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { SessionResponseDto, UserSummaryDto } from '@edu-diary/contracts';
import { Pagination, usePageSize } from '../components/Pagination';
import { GuardianLinksCard, LinkGuardianForm } from './StudentsCard';
import { NewGuardianForm } from './NewGuardianCard';
import { errorMessage } from '../lib/api-client';
import {
  useCreateUser,
  useDeactivateUser,
  useResetPassword,
  useRoles,
  useSetUserRoles,
  useUsers,
} from '../lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  formatDateTime,
  Table,
  TextInput,
} from '../components/ui';

const createUserFormSchema = z.object({
  username: z
    .string()
    .min(3, 'Минимум 3 символа')
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Строчные латинские буквы, цифры, точка, дефис'),
  fullName: z.string().min(1, 'Укажите ФИО').max(200),
  password: z.string().min(10, 'Минимум 10 символов').max(200),
  email: z.string().max(200).optional(),
  roles: z.array(z.string()).min(1, 'Выберите хотя бы одну роль'),
});

type CreateUserForm = z.infer<typeof createUserFormSchema>;

/**
 * Подпись роли для человека.
 *
 * Код и заголовок роли приходят из каталога, но «parent» в интерфейсе точнее
 * называть законным представителем: юридически это одно и то же, а в документах
 * и в жизни используется второе. Схему и API не меняем — правим только показ.
 */
function roleTitle(code: string, fallback: string): string {
  return code === 'parent' ? 'Законный представитель' : fallback;
}

function RolesCell({ user }: { user: UserSummaryDto }) {
  return (
    <span className="flex flex-wrap gap-1">
      {user.roles.length === 0 ? (
        <Badge tone="warning">нет ролей</Badge>
      ) : (
        user.roles.map((role) => <Badge key={role.code}>{roleTitle(role.code, role.title)}</Badge>)
      )}
    </span>
  );
}

export function UsersScreen({ session }: { session: SessionResponseDto }) {
  /** Какая форма открыта: учётная запись или законный представитель. */
  const [tab, setTab] = useState<'user' | 'guardian'>('user');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(10);
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const users = useUsers({ search, limit: pageSize, offset: (page - 1) * pageSize });
  const roles = useRoles();
  const createUser = useCreateUser();
  const setUserRoles = useSetUserRoles();
  const deactivate = useDeactivateUser();
  const resetPassword = useResetPassword();

  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserFormSchema),
    defaultValues: { username: '', fullName: '', password: '', email: '', roles: ['teacher'] },
  });

  // В общей форме — только роли сотрудников: ученик заводится в разделе групп,
  // представитель — отдельным блоком, где учётная запись связана с учеником.
  const staffRoles = (roles.data?.items ?? []).filter(
    (role) => role.code !== 'student' && role.code !== 'parent',
  );

  // Сколько ролей отмечено сейчас: две и больше — повод для предупреждения.
  const selectedCount = form.watch('roles').length;

  const onCreate = form.handleSubmit(async (values) => {
    setNotice(null);
    const email = values.email?.trim();

    await createUser.mutateAsync({
      username: values.username.trim().toLowerCase(),
      fullName: values.fullName.trim(),
      password: values.password,
      roles: values.roles,
      ...(email === undefined || email === '' ? {} : { email }),
    });

    form.reset({ username: '', fullName: '', password: '', email: '', roles: ['teacher'] });
    setNotice('Учётная запись создана. Пароль временный: при первом входе его нужно сменить.');
  });

  const canManage = session.permissions.some(
    (grant) => grant.permission === 'users:write' && grant.scope === 'all',
  );

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        /*
          Один блок с вкладками: учётная запись и законный представитель — разные
          сущности (представитель всегда связан с учеником), но заводить их удобнее
          в одном месте, а не двумя блоками друг под другом.
        */
        <Card
          title="Новый пользователь"
          description="Учётная запись создаётся с временным паролем."
          actions={
            <span className="flex gap-2">
              <Button
                tone={tab === 'user' ? 'primary' : 'secondary'}
                type="button"
                id="tab-user"
                onClick={() => setTab('user')}
              >
                Учётная запись
              </Button>
              <Button
                tone={tab === 'guardian' ? 'primary' : 'secondary'}
                type="button"
                id="tab-guardian"
                onClick={() => setTab('guardian')}
              >
                Законный представитель
              </Button>
            </span>
          }
        >
          {tab === 'user' ? (
            <form className="flex flex-col gap-3" onSubmit={onCreate} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ФИО" error={form.formState.errors.fullName?.message}>
                  <TextInput {...form.register('fullName')} />
                </Field>
                <Field
                  label="Логин"
                  hint="Строчные латинские буквы, цифры, точка, дефис"
                  error={form.formState.errors.username?.message}
                >
                  {/* Автоподстановка логина по ФИО отложена: поле заполняется вручную. */}
                  <TextInput autoComplete="off" {...form.register('username')} />
                </Field>
                <Field
                  label="Временный пароль"
                  hint="Минимум 10 символов"
                  error={form.formState.errors.password?.message}
                >
                  <TextInput
                    type="password"
                    autoComplete="new-password"
                    {...form.register('password')}
                  />
                </Field>
                <Field
                  label="Почта"
                  hint="Необязательно"
                  error={form.formState.errors.email?.message}
                >
                  <TextInput type="email" {...form.register('email')} />
                </Field>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-foreground">
                  Роли сотрудника
                </legend>
                <div className="flex flex-wrap gap-3">
                  {staffRoles.map((role) => (
                    <Checkbox
                      value={role.code}
                      {...form.register('roles')}
                      onChange={(event) => {
                        // Роли дают права все вместе: показываем предупреждение,
                        // чтобы случайно не выдать лишнее.
                        void form.register('roles').onChange(event);
                        setNotice(null);
                      }}
                      label={roleTitle(role.code, role.title)}
                    />
                  ))}
                </div>
                {form.formState.errors.roles !== undefined && (
                  <span className="mt-1 block text-xs text-danger-foreground">
                    {form.formState.errors.roles.message}
                  </span>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Учеников заводят в разделе «Группы и ученики» (блок «Новый ученик»), законных
                  представителей — блоком ниже: у них учётная запись всегда связана с человеком.
                </p>
              </fieldset>

              {selectedCount > 1 && (
                <Alert tone="warning">
                  Внимание! Вы выбрали больше одной роли! Учётная запись получит расширенные права!
                </Alert>
              )}

              {createUser.isError && <Alert tone="error">{errorMessage(createUser.error)}</Alert>}

              <div>
                <Button type="submit" disabled={createUser.isPending}>
                  {createUser.isPending ? 'Создаём…' : 'Создать учётную запись'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Учётная запись законного представителя создаётся вместе с привязкой к ученику:
                отдельно, без ученика, она смысла не имеет.
              </p>
              <NewGuardianForm onCreated={setNotice} />
            </div>
          )}
        </Card>
      )}

      {notice !== null && <Alert tone="success">{notice}</Alert>}

      <Card
        title="Учётные записи"
        description="Список со страницами: количество строк на странице выбирается и запоминается."
        actions={
          <TextInput
            placeholder="Поиск по логину или ФИО"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              // Поиск меняет выборку: возвращаемся на первую страницу.
              setPage(1);
            }}
            className="w-56"
          />
        }
      >
        {users.isLoading && <EmptyState>Загружаем…</EmptyState>}
        {users.isError && <Alert tone="error">{errorMessage(users.error)}</Alert>}

        {users.data !== undefined && users.data.items.length === 0 && (
          <EmptyState>Учётных записей нет</EmptyState>
        )}

        {users.data !== undefined && users.data.items.length > 0 && (
          <Table head={['Логин', 'ФИО', 'Роли', 'Состояние', 'Создан', '']}>
            {users.data.items.map((user) => (
              <tr key={user.id} className="border-b border-border align-top">
                <td className="px-3 py-2 font-medium">{user.username}</td>
                <td className="px-3 py-2">{user.fullName}</td>
                <td className="px-3 py-2">
                  <RolesCell user={user} />
                </td>
                <td className="px-3 py-2">
                  {user.isActive ? (
                    <Badge tone="success">активен</Badge>
                  ) : (
                    <Badge tone="danger">отключён</Badge>
                  )}
                  {user.mustChangePassword && (
                    <span className="ml-1">
                      <Badge tone="warning">сменить пароль</Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {formatDateTime(user.createdAt)}
                </td>
                <td className="px-3 py-2">
                  {canManage && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        tone="ghost"
                        onClick={() => {
                          setEditing(editing === user.id ? null : user.id);
                          setSelectedRoles(user.roles.map((role) => role.code));
                          setPasswordFor(null);
                        }}
                      >
                        Роли
                      </Button>
                      <Button
                        tone="ghost"
                        onClick={() => {
                          setPasswordFor(user.id);
                          setEditing(null);
                        }}
                      >
                        Сбросить пароль
                      </Button>
                      <Button
                        tone="ghost"
                        onClick={() =>
                          void deactivate.mutateAsync({ userId: user.id, isActive: !user.isActive })
                        }
                      >
                        {user.isActive ? 'Отключить' : 'Включить'}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}

        {users.data !== undefined && users.data.total > 0 && (
          <Pagination
            total={users.data.total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}

        {editing !== null && (
          <div className="mt-4 rounded-md border border-border p-4">
            <p className="mb-2 text-sm font-medium">Роли учётной записи</p>
            <div className="flex flex-wrap gap-3">
              {(roles.data?.items ?? []).map((role) => (
                <Checkbox
                  checked={selectedRoles.includes(role.code)}
                  onChange={(event) =>
                    setSelectedRoles((current) =>
                      event.target.checked
                        ? [...current, role.code]
                        : current.filter((code) => code !== role.code),
                    )
                  }
                  label={role.title}
                />
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                onClick={async () => {
                  await setUserRoles.mutateAsync({ userId: editing, roles: selectedRoles });
                  setEditing(null);
                }}
                disabled={setUserRoles.isPending}
              >
                Сохранить роли
              </Button>
              <Button tone="secondary" onClick={() => setEditing(null)}>
                Отмена
              </Button>
            </div>
            {setUserRoles.isError && <Alert tone="error">{errorMessage(setUserRoles.error)}</Alert>}
          </div>
        )}

        {passwordFor !== null && (
          <div className="mt-4 rounded-md border border-border p-4">
            <Field label="Новый временный пароль" hint="Все сессии учётной записи будут отозваны">
              <TextInput
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button
                onClick={async () => {
                  await resetPassword.mutateAsync({ userId: passwordFor, password: newPassword });
                  setPasswordFor(null);
                  setNewPassword('');
                  setNotice('Пароль сброшен, сессии учётной записи отозваны.');
                }}
                disabled={resetPassword.isPending || newPassword.length < 10}
              >
                Сбросить пароль
              </Button>
              <Button tone="secondary" onClick={() => setPasswordFor(null)}>
                Отмена
              </Button>
            </div>
            {resetPassword.isError && (
              <Alert tone="error">{errorMessage(resetPassword.error)}</Alert>
            )}
          </div>
        )}
      </Card>

      {/* Учеников ведут в «Группах и учениках»: там список людей и группы,
          которые из них собираются. Здесь — только привязки уже заведённых
          представителей к ученикам. */}
      {canManage && (
        <>
          <LinkGuardianForm onLinked={setNotice} />
          <GuardianLinksCard onNotice={setNotice} />
        </>
      )}
    </div>
  );
}
