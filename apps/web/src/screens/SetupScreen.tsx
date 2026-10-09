import { zodResolver } from '@hookform/resolvers/zod';
import { validatePassword } from '@edu-diary/domain';
import { isoDateSchema } from '@edu-diary/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { errorMessage } from '../lib/api-client';
import { useCompleteSetup } from '../lib/queries';
import { Alert, Button, Card, Field, TextInput, formatDate } from '../components/ui';
import type { SetupStatusResponseDto } from '@edu-diary/contracts';

/** Шаги мастера: заведение → учебный год и период → администратор. */
const STEPS = ['Учебное заведение', 'Учебный год и период', 'Администратор'] as const;

const formSchema = z
  .object({
    title: z.string().min(1, 'Укажите название').max(200),
    shortName: z.string().max(40).optional(),
    signature: z.string().max(200).optional(),
    yearTitle: z.string().min(1, 'Укажите название года').max(60),
    yearStartsOn: isoDateSchema,
    yearEndsOn: isoDateSchema,
    periodTitle: z.string().min(1, 'Укажите название периода').max(60),
    periodKind: z.enum(['term', 'semester', 'quarter']),
    periodStartsOn: isoDateSchema,
    periodEndsOn: isoDateSchema,
    adminUsername: z
      .string()
      .min(3, 'Минимум 3 символа')
      .max(64)
      .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Строчные латинские буквы, цифры, точка, дефис'),
    adminFullName: z.string().min(1, 'Укажите ФИО').max(200),
    adminPassword: z.string().min(10, 'Минимум 10 символов').max(200),
    adminPasswordRepeat: z.string().min(10).max(200),
    adminEmail: z.string().max(200).optional(),
  })
  .refine((values) => values.adminPassword === values.adminPasswordRepeat, {
    message: 'Пароли не совпадают',
    path: ['adminPasswordRepeat'],
  })
  .refine((values) => values.yearStartsOn <= values.yearEndsOn, {
    message: 'Дата начала позже даты окончания',
    path: ['yearEndsOn'],
  })
  .refine((values) => values.periodStartsOn <= values.periodEndsOn, {
    message: 'Дата начала позже даты окончания',
    path: ['periodEndsOn'],
  });

type FormValues = z.infer<typeof formSchema>;

function defaultAcademicYear(): { title: string; startsOn: string; endsOn: string } {
  const now = new Date();
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    title: `${startYear}/${startYear + 1}`,
    startsOn: `${startYear}-09-01`,
    endsOn: `${startYear + 1}-06-30`,
  };
}

const STEP_FIELDS: readonly (readonly (keyof FormValues)[])[] = [
  ['title', 'shortName', 'signature'],
  [
    'yearTitle',
    'yearStartsOn',
    'yearEndsOn',
    'periodTitle',
    'periodKind',
    'periodStartsOn',
    'periodEndsOn',
  ],
  ['adminUsername', 'adminFullName', 'adminPassword', 'adminPasswordRepeat', 'adminEmail'],
];

export function SetupScreen({ status }: { status: SetupStatusResponseDto }) {
  const [step, setStep] = useState(0);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [passwordIssues, setPasswordIssues] = useState<string[]>([]);
  const complete = useCompleteSetup();
  const year = defaultAcademicYear();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      shortName: '',
      signature: '',
      yearTitle: year.title,
      yearStartsOn: year.startsOn,
      yearEndsOn: year.endsOn,
      periodTitle: '1 семестр',
      periodKind: 'semester',
      periodStartsOn: year.startsOn,
      periodEndsOn: `${year.startsOn.slice(0, 4)}-12-31`,
      adminUsername: '',
      adminFullName: '',
      adminPassword: '',
      adminPasswordRepeat: '',
      adminEmail: '',
    },
    mode: 'onSubmit',
  });

  const next = async (): Promise<void> => {
    const fields = STEP_FIELDS[step] ?? [];
    const valid = await form.trigger(fields, { shouldFocus: true });

    if (valid && step === 2) {
      const password = form.getValues('adminPassword');
      const issues = validatePassword(password, {
        username: form.getValues('adminUsername'),
        fullName: form.getValues('adminFullName'),
      });
      setPasswordIssues(issues);
      if (issues.length > 0) return;
    }

    if (valid) setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const onLogoSelected = (file: File | undefined): void => {
    setLogoError(null);
    if (file === undefined) {
      setLogoDataUrl(null);
      return;
    }
    if (file.size > 256 * 1024) {
      setLogoError('Логотип больше 256 КБ');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => setLogoError('Не удалось прочитать файл');
    reader.readAsDataURL(file);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const shortName = values.shortName?.trim();
    const signature = values.signature?.trim();
    const email = values.adminEmail?.trim();

    try {
      await complete.mutateAsync({
        institution: {
          title: values.title.trim(),
          ...(shortName === undefined || shortName === '' ? {} : { shortName }),
          ...(signature === undefined || signature === '' ? {} : { signature }),
          ...(logoDataUrl === null ? {} : { logoDataUrl }),
        },
        academicYear: {
          title: values.yearTitle.trim(),
          startsOn: values.yearStartsOn,
          endsOn: values.yearEndsOn,
        },
        period: {
          title: values.periodTitle.trim(),
          kind: values.periodKind,
          startsOn: values.periodStartsOn,
          endsOn: values.periodEndsOn,
        },
        admin: {
          username: values.adminUsername.trim().toLowerCase(),
          fullName: values.adminFullName.trim(),
          password: values.adminPassword,
          ...(email === undefined || email === '' ? {} : { email }),
        },
        storage: { provider: 'local' },
      });
    } catch {
      // Ошибка показывается ниже из состояния мутации.
    }
  });

  const checks = status.checks;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Первичная настройка дневника</h1>
        <p className="mt-1 text-sm text-slate-500">
          Шаг {step + 1} из {STEPS.length}: {STEPS[step]}
        </p>
      </header>

      <Card
        title="Проверка окружения"
        description="Мастер убеждается, что база доступна и миграции применены."
      >
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex justify-between gap-4">
            <span className="text-slate-500">Подключение к базе данных</span>
            <span className={checks.database.status === 'ok' ? 'text-green-700' : 'text-red-700'}>
              {checks.database.status === 'ok'
                ? `есть, ${checks.database.latencyMs ?? 0} мс`
                : (checks.database.message ?? 'нет подключения')}
            </span>
          </li>
          <li className="flex justify-between gap-4">
            <span className="text-slate-500">Миграции</span>
            <span
              className={checks.migrations.status === 'ok' ? 'text-green-700' : 'text-amber-700'}
            >
              применено {checks.migrations.applied}, ожидает {checks.migrations.pending}
            </span>
          </li>
        </ul>

        {checks.database.status !== 'ok' && (
          <div className="mt-4">
            <Alert tone="warning">
              База данных недоступна. Проверьте <code>DATABASE_URL</code> и перезапустите стек.
            </Alert>
          </div>
        )}
        {checks.migrations.pending > 0 && (
          <div className="mt-4">
            <Alert tone="warning">
              Не все миграции применены: выполните <code>npm run migrate</code>.
            </Alert>
          </div>
        )}
      </Card>

      <Card>
        <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
          {step === 0 && (
            <>
              <Field
                label="Название учебного заведения"
                error={form.formState.errors.title?.message}
              >
                <TextInput
                  placeholder="Например: Колледж села Ивановка"
                  {...form.register('title')}
                />
              </Field>
              <Field
                label="Короткое название"
                hint="Показывается в шапке"
                error={form.formState.errors.shortName?.message}
              >
                <TextInput {...form.register('shortName')} />
              </Field>
              <Field
                label="Подпись"
                hint="Например: электронный дневник колледжа"
                error={form.formState.errors.signature?.message}
              >
                <TextInput {...form.register('signature')} />
              </Field>
              <Field
                label="Логотип"
                hint="PNG, JPEG или SVG до 256 КБ (необязательно)"
                error={logoError ?? undefined}
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="text-sm"
                  onChange={(event) => onLogoSelected(event.target.files?.[0])}
                />
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <Field label="Учебный год" error={form.formState.errors.yearTitle?.message}>
                <TextInput {...form.register('yearTitle')} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Начало года" error={form.formState.errors.yearStartsOn?.message}>
                  <TextInput type="date" {...form.register('yearStartsOn')} />
                </Field>
                <Field label="Окончание года" error={form.formState.errors.yearEndsOn?.message}>
                  <TextInput type="date" {...form.register('yearEndsOn')} />
                </Field>
              </div>

              <Field label="Первый период" error={form.formState.errors.periodTitle?.message}>
                <TextInput {...form.register('periodTitle')} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Тип периода">
                  <select
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    {...form.register('periodKind')}
                  >
                    <option value="semester">Семестр</option>
                    <option value="term">Четверть</option>
                    <option value="quarter">Триместр</option>
                  </select>
                </Field>
                <Field label="Начало периода" error={form.formState.errors.periodStartsOn?.message}>
                  <TextInput type="date" {...form.register('periodStartsOn')} />
                </Field>
                <Field
                  label="Окончание периода"
                  error={form.formState.errors.periodEndsOn?.message}
                >
                  <TextInput type="date" {...form.register('periodEndsOn')} />
                </Field>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Field
                label="Логин администратора"
                error={form.formState.errors.adminUsername?.message}
              >
                <TextInput autoComplete="username" {...form.register('adminUsername')} />
              </Field>
              <Field
                label="ФИО администратора"
                error={form.formState.errors.adminFullName?.message}
              >
                <TextInput {...form.register('adminFullName')} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Пароль"
                  hint="Минимум 10 символов, не должен совпадать с логином"
                  error={form.formState.errors.adminPassword?.message}
                >
                  <TextInput
                    type="password"
                    autoComplete="new-password"
                    {...form.register('adminPassword')}
                  />
                </Field>
                <Field
                  label="Повтор пароля"
                  error={form.formState.errors.adminPasswordRepeat?.message}
                >
                  <TextInput
                    type="password"
                    autoComplete="new-password"
                    {...form.register('adminPasswordRepeat')}
                  />
                </Field>
              </div>
              <Field
                label="Почта"
                hint="Необязательно"
                error={form.formState.errors.adminEmail?.message}
              >
                <TextInput type="email" {...form.register('adminEmail')} />
              </Field>

              {passwordIssues.length > 0 && (
                <Alert tone="error">
                  Пароль не соответствует требованиям:
                  <ul className="mt-1 list-inside list-disc">
                    {passwordIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              <Alert tone="info">
                Учебный год: {form.getValues('yearTitle')} (
                {formatDate(form.getValues('yearStartsOn'))} —{' '}
                {formatDate(form.getValues('yearEndsOn'))}). Учётных записей, кроме создаваемой, в
                системе нет.
              </Alert>
            </>
          )}

          {complete.isError && <Alert tone="error">{errorMessage(complete.error)}</Alert>}

          <div className="flex items-center justify-between gap-3">
            <Button
              tone="secondary"
              onClick={() => setStep((current) => Math.max(current - 1, 0))}
              disabled={step === 0}
            >
              Назад
            </Button>

            {step < STEPS.length - 1 ? (
              <Button onClick={() => void next()}>Далее</Button>
            ) : (
              <Button type="submit" disabled={complete.isPending}>
                {complete.isPending ? 'Настраиваем…' : 'Завершить настройку'}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </main>
  );
}
