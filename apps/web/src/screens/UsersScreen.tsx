import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { SessionResponseDto, UserSummaryDto } from '@edu-diary/contracts';
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
  EmptyState,
  Field,
  Table,
  TextInput,
  formatDateTime,
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

function RolesCell({ user }: { user: UserSummaryDto }) {
  return (
    <span className="flex flex-wrap gap-1">
      {user.roles.length === 0 ? (
        <Badge tone="warning">нет ролей</Badge>
      ) : (
        user.roles.map((role) => <Badge key={role.code}>{role.title}</Badge>)
      )}
    </span>
  );
}

export function UsersScreen({ session }: { session: SessionResponseDto }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const users = useUsers({ search });
  const roles = useRoles();
  const createUser = useCreateUser();
  const setUserRoles = useSetUserRoles();
  const deactivate = useDeactivateUser();
  const resetPassword = useResetPassword();

  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserFormSchema),
    defaultValues: { username: '', fullName: '', password: '', email: '', roles: ['teacher'] },
  });

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
    setNotice('Пользователь создан. Пароль временный: при первом входе его нужно сменить.');
  });

  const canManage = session.permissions.some(
    (grant) => grant.permission === 'users:write' && grant.scope === 'all',
  );

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <Card
          title="Новый пользователь"
          description="Учётная запись создаётся с временным паролем."
        >
          <form className="flex flex-col gap-4" onSubmit={onCreate} noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Логин" error={form.formState.errors.username?.message}>
                <TextInput autoComplete="off" {...form.register('username')} />
              </Field>
              <Field label="ФИО" error={form.formState.errors.fullName?.message}>
                <TextInput {...form.register('fullName')} />
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
              <legend className="mb-2 text-sm font-medium text-slate-700">Роли</legend>
              <div className="flex flex-wrap gap-3">
                {(roles.data?.items ?? []).map((role) => (
                  <label key={role.code} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" value={role.code} {...form.register('roles')} />
                    {role.title}
                  </label>
                ))}
              </div>
              {form.formState.errors.roles !== undefined && (
                <span className="mt-1 block text-xs text-red-700">
                  {form.formState.errors.roles.message}
                </span>
              )}
            </fieldset>

            {createUser.isError && <Alert tone="error">{errorMessage(createUser.error)}</Alert>}

            <div>
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? 'Создаём…' : 'Создать пользователя'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {notice !== null && <Alert tone="success">{notice}</Alert>}

      <Card
        title="Пользователи"
        description={`Всего: ${users.data?.total ?? 0}`}
        actions={
          <TextInput
            placeholder="Поиск по логину или ФИО"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-56"
          />
        }
      >
        {users.isLoading && <EmptyState>Загружаем…</EmptyState>}
        {users.isError && <Alert tone="error">{errorMessage(users.error)}</Alert>}

        {users.data !== undefined && users.data.items.length === 0 && (
          <EmptyState>Пользователей нет</EmptyState>
        )}

        {users.data !== undefined && users.data.items.length > 0 && (
          <Table head={['Логин', 'ФИО', 'Роли', 'Состояние', 'Создан', '']}>
            {users.data.items.map((user) => (
              <tr key={user.id} className="border-b border-slate-100 align-top">
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
                <td className="px-3 py-2 text-slate-500">{formatDateTime(user.createdAt)}</td>
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

        {editing !== null && (
          <div className="mt-4 rounded-md border border-slate-200 p-4">
            <p className="mb-2 text-sm font-medium">Роли пользователя</p>
            <div className="flex flex-wrap gap-3">
              {(roles.data?.items ?? []).map((role) => (
                <label key={role.code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(role.code)}
                    onChange={(event) =>
                      setSelectedRoles((current) =>
                        event.target.checked
                          ? [...current, role.code]
                          : current.filter((code) => code !== role.code),
                      )
                    }
                  />
                  {role.title}
                </label>
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
          <div className="mt-4 rounded-md border border-slate-200 p-4">
            <Field label="Новый временный пароль" hint="Все сессии пользователя будут отозваны">
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
                  setNotice('Пароль сброшен, сессии пользователя отозваны.');
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
    </div>
  );
}
