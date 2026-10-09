import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { SessionResponseDto } from '@edu-diary/contracts';
import { SystemStatus, type HealthState } from '../components/SystemStatus';
import { Alert, Badge, Button, Card, Field, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api-client';
import { useChangePassword, useHealth } from '../lib/queries';

function healthState(query: ReturnType<typeof useHealth>): HealthState {
  if (query.isLoading) return { kind: 'loading' };
  if (query.isError || query.data === undefined) {
    return { kind: 'unreachable', message: 'сервер не ответил' };
  }
  return { kind: 'ready', health: query.data };
}

const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Введите текущий пароль').max(200),
    newPassword: z.string().min(10, 'Минимум 10 символов').max(200),
    newPasswordRepeat: z.string().min(10, 'Минимум 10 символов').max(200),
  })
  .refine((values) => values.newPassword === values.newPasswordRepeat, {
    message: 'Пароли не совпадают',
    path: ['newPasswordRepeat'],
  });

export function ChangePasswordCard() {
  const [done, setDone] = useState(false);
  const change = useChangePassword();

  const form = useForm<z.infer<typeof passwordFormSchema>>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', newPasswordRepeat: '' },
  });

  return (
    <Card
      title="Смена пароля"
      description="После смены пароля остальные сессии отзываются: вход остаётся только здесь."
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          setDone(false);
          try {
            await change.mutateAsync({
              currentPassword: values.currentPassword,
              newPassword: values.newPassword,
            });
            form.reset({ currentPassword: '', newPassword: '', newPasswordRepeat: '' });
            setDone(true);
          } catch {
            form.setValue('currentPassword', '');
          }
        })}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Текущий пароль" error={form.formState.errors.currentPassword?.message}>
            <TextInput
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
          </Field>
          <Field label="Новый пароль" error={form.formState.errors.newPassword?.message}>
            <TextInput
              type="password"
              autoComplete="new-password"
              {...form.register('newPassword')}
            />
          </Field>
          <Field
            label="Повтор нового пароля"
            error={form.formState.errors.newPasswordRepeat?.message}
          >
            <TextInput
              type="password"
              autoComplete="new-password"
              {...form.register('newPasswordRepeat')}
            />
          </Field>
        </div>

        {change.isError && <Alert tone="error">{errorMessage(change.error)}</Alert>}
        {done && <Alert tone="success">Пароль изменён.</Alert>}

        <div>
          <Button type="submit" disabled={change.isPending}>
            Сменить пароль
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function DashboardScreen({ session }: { session: SessionResponseDto }) {
  const health = useHealth();

  return (
    <div className="flex flex-col gap-6">
      <SystemStatus state={healthState(health)} />

      <Card title="Ваш доступ" description="Права выданы ролями; изменяет их администратор.">
        <p className="mb-3 flex flex-wrap gap-2">
          {session.user.roles.map((role) => (
            <Badge key={role.code} tone="success">
              {role.title}
            </Badge>
          ))}
        </p>

        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {[...session.permissions]
            .sort((left, right) => left.permission.localeCompare(right.permission))
            .map((grant) => (
              <li
                key={grant.permission}
                className="flex justify-between gap-3 border-b border-slate-100 py-1"
              >
                <span className="text-slate-700">{grant.permission}</span>
                <span className="text-slate-400">{grant.scope}</span>
              </li>
            ))}
        </ul>

        <p className="mt-3 text-xs text-slate-500">
          Область действия: <code>own</code> — своё, <code>group</code> — своя группа,{' '}
          <code>assigned</code> — свои назначения, <code>all</code> — всё.
        </p>
      </Card>

      <ChangePasswordCard />

      <Card title="Что дальше" description="Этап 1 закрывает вход, права и аудит.">
        <ul className="list-inside list-disc text-sm text-slate-700">
          <li>Учебные годы, группы и учеников добавляет Этап 2.</li>
          <li>Расписание и уроки — Этап 3.</li>
          <li>Оценки и посещаемость — Этап 4.</li>
          <li>Домашние задания и файлы — Этап 5.</li>
        </ul>
      </Card>
    </div>
  );
}
