import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { errorMessage } from '../lib/api-client';
import { useChangePassword } from '../lib/queries';
import { Alert, Button, Field, TextInput } from './ui';
import { Section } from './layout';

/**
 * Смена пароля.
 *
 * Раньше жила на странице «Обзор» вместе со сводкой о системе. Переехала в **профиль**
 * (Этап 6, решение владельца): смена пароля — действие человека над своей учётной записью, и
 * место ей рядом с данными профиля, а не на странице общего обзора.
 *
 * Отдельный файл, а не часть экрана: компонент самостоятельный и может понадобиться там же, где
 * потребуется сменить пароль другому (например, принудительная смена администратором).
 */

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

export function ChangePasswordCard({
  /**
   * Что делать после успешной смены.
   *
   * В обычном профиле показываем сообщение «Пароль изменён». На экране временного пароля
   * переходим на «Обзор»: там смена — служебный шаг, и оставаться на нём незачем.
   */
  onChanged,
}: {
  onChanged?: () => void;
} = {}) {
  const [done, setDone] = useState(false);
  const change = useChangePassword();

  const form = useForm<z.infer<typeof passwordFormSchema>>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', newPasswordRepeat: '' },
  });

  return (
    <Section
      title="Смена пароля"
      description="После смены пароля остальные сессии отзываются: вход остаётся только здесь."
    >
      <form
        className="flex flex-col gap-3"
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

            if (onChanged !== undefined) {
              onChanged();
            }
          } catch {
            // Текущий пароль стираем: если он неверный, повторять его вслепую незачем.
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
    </Section>
  );
}
