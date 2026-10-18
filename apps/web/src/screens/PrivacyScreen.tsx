import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { errorMessage } from '../lib/api-client';
import {
  useConsents,
  useCreateConsent,
  useMissingConsents,
  usePolicy,
  usePublishPolicy,
  useRevokeConsent,
  useStudents,
  useUsers,
} from '../lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  formatDateTime,
  Select,
  Table,
  Textarea,
  TextInput,
} from '../components/ui';

/**
 * Согласия на обработку персональных данных и редакции политики (ADR-021).
 *
 * Раздел отвечает только за приватность: редакции политики, согласия законных
 * представителей и список учеников без согласия. Ученики и привязка
 * представителей ведутся в разделе «Учётные записи и роли» — там же, где остальной
 * учёт людей: карточка ученика и учётная запись создаются одним действием.
 */

const policyFormSchema = z.object({
  version: z.string().min(1, 'Укажите версию').max(40),
  text: z.string().min(20, 'Текст политики слишком короткий').max(100_000),
});

const consentFormSchema = z.object({
  studentId: z.string().min(1, 'Выберите ученика'),
  guardianUserId: z.string().min(1, 'Выберите законного представителя'),
  grantedVia: z.enum(['paper', 'electronic']),
  documentRef: z.string().max(200).optional(),
});

export function PrivacyScreen() {
  const [revokeFor, setRevokeFor] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const policy = usePolicy();
  const consents = useConsents({});
  const missing = useMissingConsents();
  const students = useStudents({ limit: 200 });
  const users = useUsers({ role: 'parent' });

  const publishPolicy = usePublishPolicy();
  const createConsent = useCreateConsent();
  const revokeConsent = useRevokeConsent();

  const policyForm = useForm<z.infer<typeof policyFormSchema>>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: { version: '', text: '' },
  });

  const consentForm = useForm<z.infer<typeof consentFormSchema>>({
    resolver: zodResolver(consentFormSchema),
    defaultValues: { studentId: '', guardianUserId: '', grantedVia: 'paper', documentRef: '' },
  });

  const guardians = users.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Политика обработки персональных данных"
        description="Каждая публикация — новая редакция с версией: согласие ссылается на неё."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={policyForm.handleSubmit(async (values) => {
            setNotice(null);
            await publishPolicy.mutateAsync({ version: values.version.trim(), text: values.text });
            policyForm.reset({ version: '', text: '' });
            setNotice('Редакция политики опубликована.');
          })}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Версия" error={policyForm.formState.errors.version?.message}>
              <TextInput placeholder="1.0" {...policyForm.register('version')} />
            </Field>
          </div>
          <Field label="Текст политики" error={policyForm.formState.errors.text?.message}>
            <Textarea
              rows={6}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              {...policyForm.register('text')}
            />
          </Field>
          {publishPolicy.isError && <Alert tone="error">{errorMessage(publishPolicy.error)}</Alert>}

          {/* Версия и действие — в одной строке: кнопка справа, сведения о редакции слева. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {policy.data?.current != null ? (
              <p className="text-sm text-muted-foreground">
                Действующая редакция: <Badge tone="success">{policy.data.current.version}</Badge>
              </p>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={publishPolicy.isPending}>
              Опубликовать редакцию
            </Button>
          </div>
        </form>
      </Card>

      {/* Редакции политики: текст и история. Раньше на экране была только
          строка с версией, и посмотреть саму политику было негде. */}
      <Card
        title="Редакции политики"
        description="Версия редакции уникальна: задним числом текст не переписать, изменения выходят новой редакцией."
      >
        {policy.isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
        {policy.isError && <Alert tone="error">{errorMessage(policy.error)}</Alert>}

        {policy.data !== undefined && policy.data.editions.length === 0 && (
          <EmptyState>
            Политика ещё не опубликована. Опубликуйте редакцию — на неё будут ссылаться согласия.
          </EmptyState>
        )}

        {policy.data !== undefined && policy.data.editions.length > 0 && (
          <ul className="flex flex-col gap-3">
            {policy.data.editions.map((edition) => (
              <li key={edition.version} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={edition.version === policy.data?.current?.version ? 'success' : 'neutral'}
                  >
                    редакция {edition.version}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(edition.publishedAt)}
                    {edition.publishedByName === null ? '' : ` · ${edition.publishedByName}`}
                  </span>
                  {edition.version === policy.data?.current?.version && (
                    <span className="text-xs text-muted-foreground">действующая</span>
                  )}
                </div>

                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-foreground">
                    Показать текст
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm text-foreground">
                    {edition.text}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {notice !== null && <Alert tone="success">{notice}</Alert>}

      <Card
        title="Ученики без согласия"
        description="Список для работы с законными представителями: у этих учеников согласия ещё нет."
      >
        {missing.data !== undefined && missing.data.items.length === 0 && (
          <EmptyState>У всех учеников есть действующее согласие.</EmptyState>
        )}
        {missing.data !== undefined && missing.data.items.length > 0 && (
          <Table head={['Ученик', 'Состояние']}>
            {missing.data.items.map((student) => (
              <tr key={student.studentId} className="border-b border-border">
                <td className="px-3 py-2">{student.fullName}</td>
                <td className="px-3 py-2">
                  {student.hasRevokedConsent ? (
                    <Badge tone="warning">согласие отозвано</Badge>
                  ) : (
                    <Badge>согласия нет</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card
        title="Согласия"
        description="Отзыв не удаляет запись: сохраняется история «согласие → редакция → дата»."
      >
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={consentForm.handleSubmit(async (values) => {
            setNotice(null);
            const documentRef = values.documentRef?.trim();
            await createConsent.mutateAsync({
              studentId: values.studentId,
              guardianUserId: values.guardianUserId,
              grantedVia: values.grantedVia,
              ...(documentRef === undefined || documentRef === '' ? {} : { documentRef }),
            });
            consentForm.reset({
              studentId: '',
              guardianUserId: '',
              grantedVia: 'paper',
              documentRef: '',
            });
            setNotice('Согласие зарегистрировано.');
          })}
          noValidate
        >
          <Field label="Ученик" error={consentForm.formState.errors.studentId?.message}>
            <Select
              className="rounded-md border border-border px-3 py-2 text-sm"
              {...consentForm.register('studentId')}
            >
              <option value="">— выберите —</option>
              {(students.data?.items ?? []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Представитель" error={consentForm.formState.errors.guardianUserId?.message}>
            <Select
              className="rounded-md border border-border px-3 py-2 text-sm"
              {...consentForm.register('guardianUserId')}
            >
              <option value="">— выберите —</option>
              {guardians.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Способ">
            <Select
              className="rounded-md border border-border px-3 py-2 text-sm"
              {...consentForm.register('grantedVia')}
            >
              <option value="paper">Бумажное заявление</option>
              <option value="electronic">Электронно</option>
            </Select>
          </Field>
          {/* Кнопка — в ряду поля «Документ» и справа: так она на одном уровне с полями. */}
          <Field
            label="Документ"
            hint="Номер и дата заявления"
            className="ml-auto"
            actions={
              <Button type="submit" disabled={createConsent.isPending}>
                Зарегистрировать
              </Button>
            }
          >
            <TextInput {...consentForm.register('documentRef')} />
          </Field>
        </form>

        {createConsent.isError && <Alert tone="error">{errorMessage(createConsent.error)}</Alert>}
        {consents.isError && <Alert tone="error">{errorMessage(consents.error)}</Alert>}

        {consents.data !== undefined && consents.data.items.length === 0 && (
          <EmptyState>Согласий пока нет.</EmptyState>
        )}

        {consents.data !== undefined && consents.data.items.length > 0 && (
          <Table head={['Ученик', 'Представитель', 'Редакция', 'Получено', 'Отозвано', '']}>
            {consents.data.items.map((consent) => (
              <tr key={consent.id} className="border-b border-border">
                <td className="px-3 py-2">{consent.studentName}</td>
                <td className="px-3 py-2">{consent.guardianName ?? '—'}</td>
                <td className="px-3 py-2">{consent.policyVersion}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {formatDateTime(consent.grantedAt)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {consent.revokedAt === null ? (
                    <Badge tone="success">действует</Badge>
                  ) : (
                    formatDateTime(consent.revokedAt)
                  )}
                </td>
                <td className="px-3 py-2">
                  {consent.revokedAt === null && (
                    <Button tone="ghost" onClick={() => setRevokeFor(consent.id)}>
                      Отозвать
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}

        {revokeFor !== null && (
          <div className="mt-4 rounded-md border border-border p-4">
            <Field label="Причина отзыва" hint="Сохраняется в журнале">
              <TextInput
                value={revokeReason}
                onChange={(event) => setRevokeReason(event.target.value)}
              />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button
                onClick={async () => {
                  await revokeConsent.mutateAsync({ consentId: revokeFor, reason: revokeReason });
                  setRevokeFor(null);
                  setRevokeReason('');
                  setNotice('Согласие отозвано.');
                }}
                disabled={revokeConsent.isPending || revokeReason.trim() === ''}
              >
                Отозвать согласие
              </Button>
              <Button tone="secondary" onClick={() => setRevokeFor(null)}>
                Отмена
              </Button>
            </div>
            {revokeConsent.isError && (
              <Alert tone="error">{errorMessage(revokeConsent.error)}</Alert>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
