import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema, type LoginRequestDto } from '@edu-diary/contracts';

import { errorMessage } from '../lib/api-client';
import { useLogin } from '../lib/queries';
import type { BrandingDto } from '@edu-diary/contracts';
import { Alert, Button, Card, Field, TextInput } from '../components/ui';

export function LoginScreen({ branding }: { branding: BrandingDto }) {
  const login = useLogin();
  const form = useForm<LoginRequestDto>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
    } catch {
      form.setValue('password', '');
    }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold">{branding.title ?? 'Электронный дневник'}</h1>
        {branding.signature !== null && (
          <p className="mt-1 text-sm text-slate-500">{branding.signature}</p>
        )}
      </header>

      <Card title="Вход">
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field label="Логин" error={form.formState.errors.username?.message}>
            <TextInput autoComplete="username" autoFocus {...form.register('username')} />
          </Field>

          <Field label="Пароль" error={form.formState.errors.password?.message}>
            <TextInput
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
          </Field>

          {login.isError && <Alert tone="error">{errorMessage(login.error)}</Alert>}

          <Button type="submit" disabled={form.formState.isSubmitting || login.isPending}>
            {login.isPending ? 'Проверяем…' : 'Войти'}
          </Button>
        </form>
      </Card>

      <p className="text-center text-xs text-slate-500">
        Учётных записей по умолчанию нет: доступ выдаёт администратор.
      </p>
    </main>
  );
}
