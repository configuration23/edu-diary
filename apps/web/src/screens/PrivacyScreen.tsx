import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { errorMessage } from '../lib/api-client';
import {
  useConsents,
  useCreateConsent,
  useCreateStudent,
  useLinkGuardian,
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
  Table,
  TextInput,
  formatDateTime,
} from '../components/ui';

const policyFormSchema = z.object({
  version: z.string().min(1, 'Укажите версию').max(40),
  text: z.string().min(20, 'Текст политики слишком короткий').max(50_000),
});

const consentFormSchema = z.object({
  studentId: z.string().min(1, 'Выберите ученика'),
  guardianUserId: z.string().min(1, 'Выберите законного представителя'),
  grantedVia: z.enum(['paper', 'electronic']),
  documentRef: z.string().max(200).optional(),
});

const studentFormSchema = z.object({
  fullName: z.string().min(1, 'Укажите ФИО').max(200),
});

export function PrivacyScreen() {
  const [revokeFor, setRevokeFor] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const policy = usePolicy();
  const consents = useConsents({});
  const missing = useMissingConsents();
  const students = useStudents({});
  const users = useUsers({ role: 'parent' });

  const publishPolicy = usePublishPolicy();
  const createConsent = useCreateConsent();
  const revokeConsent = useRevokeConsent();
  const createStudent = useCreateStudent();
  const linkGuardian = useLinkGuardian();

  const policyForm = useForm<z.infer<typeof policyFormSchema>>({
    resolver: zodResolver(policyFormSchema),
    defaultValues: { version: '', text: '' },
  });

  const consentForm = useForm<z.infer<typeof consentFormSchema>>({
    resolver: zodResolver(consentFormSchema),
    defaultValues: { studentId: '', guardianUserId: '', grantedVia: 'paper', documentRef: '' },
  });

  const studentForm = useForm<z.infer<typeof studentFormSchema>>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: { fullName: '' },
  });

  const guardians = users.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Политика обработки персональных данных"
        description="Согласие фиксируется на конкретную редакцию: видно, на какую версию оно получено."
      >
        {policy.data?.current != null ? (
          <div className="mb-4 rounded-md border border-slate-200 p-4 text-sm">
            <p className="font-medium">
              Действующая редакция: {policy.data.current.version} от{' '}
              {formatDateTime(policy.data.current.publishedAt)}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-slate-700">{policy.data.current.text}</p>
          </div>
        ) : (
          <div className="mb-4">
            <Alert tone="warning">
              Политика ещё не опубликована. Согласия нельзя регистрировать без действующей редакции.
            </Alert>
          </div>
        )}

        <form
          className="flex flex-col gap-4"
          onSubmit={policyForm.handleSubmit(async (values) => {
            setNotice(null);
            await publishPolicy.mutateAsync(values);
            policyForm.reset({ version: '', text: '' });
            setNotice('Редакция политики опубликована.');
          })}
          noValidate
        >
          <Field
            label="Версия"
            hint="Например: 1.0"
            error={policyForm.formState.errors.version?.message}
          >
            <TextInput {...policyForm.register('version')} />
          </Field>
          <Field label="Текст политики" error={policyForm.formState.errors.text?.message}>
            <textarea
              rows={6}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...policyForm.register('text')}
            />
          </Field>
          {publishPolicy.isError && <Alert tone="error">{errorMessage(publishPolicy.error)}</Alert>}
          <div>
            <Button type="submit" disabled={publishPolicy.isPending}>
              Опубликовать редакцию
            </Button>
          </div>
        </form>
      </Card>

      {notice !== null && <Alert tone="success">{notice}</Alert>}

      <Card title="Ученики" description="Ученик нужен для привязки представителя и согласия.">
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={studentForm.handleSubmit(async (values) => {
            await createStudent.mutateAsync({ fullName: values.fullName.trim() });
            studentForm.reset({ fullName: '' });
          })}
          noValidate
        >
          <Field label="ФИО ученика" error={studentForm.formState.errors.fullName?.message}>
            <TextInput {...studentForm.register('fullName')} />
          </Field>
          <Button type="submit" disabled={createStudent.isPending}>
            Добавить ученика
          </Button>
        </form>

        {students.data !== undefined && students.data.items.length === 0 && (
          <EmptyState>Учеников пока нет</EmptyState>
        )}
        {students.data !== undefined && students.data.items.length > 0 && (
          <Table head={['ФИО', 'Дата рождения', 'Учётная запись']}>
            {students.data.items.map((student) => (
              <tr key={student.id} className="border-b border-slate-100">
                <td className="px-3 py-2">{student.fullName}</td>
                <td className="px-3 py-2 text-slate-500">{student.birthDate ?? '—'}</td>
                <td className="px-3 py-2">
                  {student.userId === null ? (
                    <span className="text-slate-400">не привязана</span>
                  ) : (
                    <Badge tone="success">привязана</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Привязка представителя" description="Родитель видит только привязанных детей.">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const studentId = String(data.get('studentId') ?? '');
            const guardianUserId = String(data.get('guardianUserId') ?? '');
            if (studentId === '' || guardianUserId === '') {
              setNotice('Выберите ученика и представителя');
              return;
            }
            await linkGuardian.mutateAsync({ studentId, guardianUserId, relation: 'other' });
            setNotice('Представитель привязан к ученику.');
          }}
        >
          <Field label="Ученик">
            <select
              name="studentId"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">— выберите —</option>
              {(students.data?.items ?? []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Законный представитель">
            <select
              name="guardianUserId"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">— выберите —</option>
              {guardians.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ({user.username})
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" disabled={linkGuardian.isPending}>
            Привязать
          </Button>
        </form>
        {guardians.length === 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Нет пользователей с ролью «Родитель» — создайте их в разделе «Пользователи».
          </p>
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
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...consentForm.register('studentId')}
            >
              <option value="">— выберите —</option>
              {(students.data?.items ?? []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Представитель" error={consentForm.formState.errors.guardianUserId?.message}>
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...consentForm.register('guardianUserId')}
            >
              <option value="">— выберите —</option>
              {guardians.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Способ">
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              {...consentForm.register('grantedVia')}
            >
              <option value="paper">Бумажное заявление</option>
              <option value="electronic">Электронно</option>
            </select>
          </Field>
          <Field label="Документ" hint="Номер и дата заявления">
            <TextInput {...consentForm.register('documentRef')} />
          </Field>
          <Button type="submit" disabled={createConsent.isPending}>
            Зарегистрировать
          </Button>
        </form>

        {createConsent.isError && <Alert tone="error">{errorMessage(createConsent.error)}</Alert>}

        {consents.data !== undefined && consents.data.items.length > 0 ? (
          <Table head={['Ученик', 'Представитель', 'Редакция', 'Получено', 'Состояние', '']}>
            {consents.data.items.map((consent) => (
              <tr key={consent.id} className="border-b border-slate-100 align-top">
                <td className="px-3 py-2">{consent.studentName ?? '—'}</td>
                <td className="px-3 py-2">{consent.guardianName ?? '—'}</td>
                <td className="px-3 py-2">{consent.policyVersion}</td>
                <td className="px-3 py-2 text-slate-500">
                  {formatDateTime(consent.grantedAt)}
                  <span className="block text-xs">
                    {consent.grantedVia === 'paper' ? 'бумажное' : 'электронное'}
                    {consent.documentRef !== null ? `, ${consent.documentRef}` : ''}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {consent.revokedAt === null ? (
                    <Badge tone="success">действует</Badge>
                  ) : (
                    <>
                      <Badge tone="danger">отозвано</Badge>
                      {consent.revokedReason !== null && (
                        <span className="block text-xs text-slate-500">
                          {consent.revokedReason}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {consent.revokedAt === null && (
                    <Button
                      tone="ghost"
                      onClick={() => {
                        setRevokeFor(consent.id);
                        setRevokeReason('');
                      }}
                    >
                      Отозвать
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState>Согласий нет</EmptyState>
        )}

        {revokeFor !== null && (
          <div className="mt-4 rounded-md border border-slate-200 p-4">
            <Field label="Причина отзыва" hint="Сохраняется в журнале">
              <TextInput
                value={revokeReason}
                onChange={(event) => setRevokeReason(event.target.value)}
              />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button
                tone="danger"
                disabled={revokeReason.trim().length < 3 || revokeConsent.isPending}
                onClick={async () => {
                  await revokeConsent.mutateAsync({
                    consentId: revokeFor,
                    reason: revokeReason.trim(),
                  });
                  setRevokeFor(null);
                  setNotice('Согласие отозвано.');
                }}
              >
                Отозвать согласие
              </Button>
              <Button tone="secondary" onClick={() => setRevokeFor(null)}>
                Отмена
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Ученики без согласия"
        description="Список для работы с законными представителями."
      >
        {missing.data !== undefined && missing.data.total === 0 ? (
          <EmptyState>У всех учеников есть действующее согласие</EmptyState>
        ) : (
          <Table head={['Ученик', 'Было отозвано']}>
            {(missing.data?.items ?? []).map((item) => (
              <tr key={item.studentId} className="border-b border-slate-100">
                <td className="px-3 py-2">{item.fullName}</td>
                <td className="px-3 py-2">{item.hasRevokedConsent ? 'да' : 'нет'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
