import { zodResolver } from '@hookform/resolvers/zod';
import { Fragment, useState } from 'react';
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
  useUpdateUser,
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
  FormActions,
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

/**
 * Правка учётной записи — строкой под ней, как у учеников.
 *
 * Владелец: по клику на логин показывать правку, а в неё вынести почту, роли и сброс пароля —
 * раньше это были три отдельные кнопки в конце строки, и связь «это всё про одного человека»
 * терялась.
 */
function UserEditForm({
  user,
  roles,
  onDone,
}: {
  user: UserSummaryDto;
  roles: Array<{ code: string; title: string }>;
  onDone: () => void;
}) {
  const update = useUpdateUser();
  const setRoles = useSetUserRoles();
  const resetPassword = useResetPassword();

  const [email, setEmail] = useState(user.email ?? '');
  const [selectedRoles, setSelectedRoles] = useState<string[]>(user.roles.map((role) => role.code));
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const rolesChanged =
    selectedRoles.length !== user.roles.length ||
    selectedRoles.some((code) => !user.roles.some((role) => role.code === code));
  const emailChanged = email.trim() !== (user.email ?? '');

  return (
    <form
      className="rounded-md border border-border bg-card p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          if (emailChanged) {
            await update.mutateAsync({
              userId: user.id,
              email: email.trim() === '' ? null : email.trim(),
            });
          }
          if (rolesChanged) {
            await setRoles.mutateAsync({ userId: user.id, roles: selectedRoles });
          }
          onDone();
        } catch {
          // Ошибка показывается ниже из состояния запроса.
        }
      }}
    >
      {/*
        Первый ряд: почта слева, пароль — справа. Пароль отделён намеренно: сброс отзывает сессии,
        это действие, а не ещё одно поле карточки.
      */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Почта" hint="Логин не меняется: это ключ входа" className="w-full sm:w-72">
          <TextInput
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field
          label="Новый временный пароль"
          hint="Все сессии учётной записи будут отозваны"
          className="ml-auto w-full sm:w-auto"
          actions={
            <Button
              tone="secondary"
              disabled={resetPassword.isPending || newPassword.length < 10}
              onClick={async () => {
                await resetPassword.mutateAsync({ userId: user.id, password: newPassword });
                setNewPassword('');
                setNotice('Пароль сброшен, сессии учётной записи отозваны.');
              }}
            >
              Сбросить пароль
            </Button>
          }
        >
          <TextInput
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
      </div>

      {/*
        Второй ряд: роли слева, действия справа. Роли и «Сохранить» относятся к одному и тому же
        сохранению, поэтому стоят в одной строке, а не в разных концах формы.
      */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-2 text-sm font-medium">Роли учётной записи</p>
          <div className="flex flex-wrap gap-3">
            {roles.map((role) => (
              <Checkbox
                key={role.code}
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
        </div>

        <FormActions
          submitLabel="Сохранить"
          pending={update.isPending || setRoles.isPending}
          onCancel={onDone}
          align="end"
        />
      </div>
      {notice !== null && <Alert tone="success">{notice}</Alert>}
      {update.isError && <Alert tone="error">{errorMessage(update.error)}</Alert>}
      {setRoles.isError && <Alert tone="error">{errorMessage(setRoles.error)}</Alert>}
      {resetPassword.isError && <Alert tone="error">{errorMessage(resetPassword.error)}</Alert>}
    </form>
  );
}

export function UsersScreen({ session }: { session: SessionResponseDto }) {
  /** Какая форма открыта: учётная запись или законный представитель. */
  const [tab, setTab] = useState<'user' | 'guardian'>('user');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(10);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const users = useUsers({ search, limit: pageSize, offset: (page - 1) * pageSize });
  const roles = useRoles();
  const createUser = useCreateUser();
  const deactivate = useDeactivateUser();

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
              <Fragment key={user.id}>
                <tr className="border-b border-border align-top">
                  <td className="px-3 py-2 font-medium">
                    {/*
                  Правка открывается кликом по логину (как у учеников по ФИО): карточка и есть
                  объект правки, отдельная кнопка «Роли» в конце строки больше не нужна.
                */}
                    <Button
                      tone="ghost"
                      className="px-0"
                      onClick={() => setEditing(editing === user.id ? null : user.id)}
                    >
                      {user.username}
                    </Button>
                  </td>
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
                          onClick={() =>
                            void deactivate.mutateAsync({
                              userId: user.id,
                              isActive: !user.isActive,
                            })
                          }
                        >
                          {user.isActive ? 'Отключить' : 'Включить'}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>

                {editing === user.id && (
                  <tr data-static className="border-b border-border">
                    <td colSpan={6} className="px-3 py-3">
                      <UserEditForm
                        user={user}
                        roles={roles.data?.items ?? []}
                        onDone={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
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
