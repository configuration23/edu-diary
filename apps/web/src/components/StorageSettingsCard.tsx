import { useEffect, useState } from 'react';

import type { UpdateStorageSettingsRequest } from '@edu-diary/contracts';

import { useStorageSettings, useTestStorage, useUpdateStorageSettings } from '../lib/queries';
import { errorMessage } from '../lib/api-client';
import { Alert, Button, Card, Field, TextInput } from './ui';

/**
 * Настройки хранилища файлов.
 *
 * Это **системные** настройки: адрес хранилища и ключи доступа к нему. Правит их
 * администратор; директору видеть их незачем — разделение «бизнес и системные настройки»
 * записано в `BACKLOG.md`.
 *
 * Смысл кнопки «Проверить подключение» — **не гадать**. Настройки можно сохранить и узнать о
 * проблеме только тогда, когда ученик не сможет приложить файл. Проверка пишет настоящий
 * файл в хранилище, читает его обратно и удаляет, поэтому проверяет права на запись и
 * чтение, а не только доступность сервера.
 *
 * Кнопка **одна**: проверка работает и для локального каталога, и для внешнего хранилища —
 * меняется только то, куда она пишет. Так и должно быть: смена хранилища не должна
 * требовать отдельной кнопки под каждый вариант.
 */

type Mode = 'local' | 's3';

export function StorageSettingsCard() {
  const settings = useStorageSettings();
  const update = useUpdateStorageSettings();
  const test = useTestStorage();

  const [mode, setMode] = useState<Mode>('local');
  const [localPath, setLocalPath] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [maxFileMb, setMaxFileMb] = useState('10');
  const [allowedTypes, setAllowedTypes] = useState('');
  const [saved, setSaved] = useState(false);

  // Поля заполняются один раз, когда настройки загрузились: иначе правки затирались бы при
  // каждом обновлении запроса.
  useEffect(() => {
    if (settings.data === undefined) return;

    setMode(settings.data.provider === 's3' ? 's3' : 'local');
    setLocalPath(settings.data.localPath ?? '');
    setEndpoint(settings.data.endpoint ?? '');
    setBucket(settings.data.bucket ?? '');
    setRegion(settings.data.region ?? 'us-east-1');
    setMaxFileMb(String(settings.data.maxFileMb));
    setAllowedTypes(settings.data.allowedTypes ?? '');
  }, [settings.data]);

  /** Значения формы: и для сохранения, и для проверки — проверять можно до сохранения. */
  const formValues = (): UpdateStorageSettingsRequest => {
    const parsed = Number(maxFileMb);

    return {
      provider: mode,
      localPath,
      ...(mode === 's3' ? { endpoint, bucket, region } : {}),
      // Пустые поля ключей означают «не менять»: иначе сохранение стёрло бы пароль.
      ...(accessKey === '' ? {} : { accessKey }),
      ...(secretKey === '' ? {} : { secretKey }),
      // Приведение к диапазону делает сервер, но не отправляем заведомую чушь.
      ...(Number.isFinite(parsed) ? { maxFileMb: parsed } : {}),
      ...(allowedTypes.trim() === '' ? {} : { allowedTypes }),
    };
  };

  const result = test.data ?? null;

  return (
    <Card
      title="Хранилище файлов"
      description="Куда складывать вложения домашних заданий. Файлы лежат в хранилище, а не внутри приложения, поэтому обновление программы их не затрагивает."
    >
      <div className="flex flex-col gap-4">
        <Field label="Где хранить файлы">
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value === 's3' ? 's3' : 'local');
              setSaved(false);
            }}
          >
            <option value="local">Локальный каталог на сервере</option>
            <option value="s3">Внешнее хранилище (S3)</option>
          </select>
        </Field>

        {mode === 'local' ? (
          <Field label="Каталог">
            <TextInput
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
              placeholder="/data/edu-diary/files"
            />
            <span className="text-xs text-slate-500">
              Каталог должен быть вне папки приложения, иначе файлы исчезнут при обновлении.
            </span>
          </Field>
        ) : (
          <>
            <Field label="Адрес хранилища">
              <TextInput
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                // Без примеров адресов: конкретный хост в подсказке попал бы в сборку как внешний адрес,
                // а правило требует, чтобы клиент не обращался к внешним сервисам
                // (docs/SECURITY.md §3.8).
                placeholder="адрес сервера хранилища"
              />
            </Field>
            <Field label="Bucket">
              <TextInput
                value={bucket}
                onChange={(event) => setBucket(event.target.value)}
                placeholder="edu-diary"
              />
            </Field>
            <Field label="Регион">
              <TextInput value={region} onChange={(event) => setRegion(event.target.value)} />
            </Field>
            <Field label="Ключ доступа">
              <TextInput
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
                placeholder={
                  settings.data?.accessKeySet === true
                    ? 'задан — оставьте пустым, чтобы не менять'
                    : ''
                }
                autoComplete="off"
              />
            </Field>
            <Field label="Секретный ключ">
              <TextInput
                type="password"
                value={secretKey}
                onChange={(event) => setSecretKey(event.target.value)}
                placeholder={
                  settings.data?.secretKeySet === true
                    ? 'задан — оставьте пустым, чтобы не менять'
                    : ''
                }
                autoComplete="new-password"
              />
            </Field>
          </>
        )}

        <Field label="Предельный размер файла, МБ">
          <TextInput
            value={maxFileMb}
            onChange={(event) => setMaxFileMb(event.target.value)}
            inputMode="numeric"
          />
          <span className="text-xs text-slate-500">От 1 до 50. По умолчанию 10.</span>
        </Field>

        <Field label="Разрешённые типы файлов">
          <TextInput
            value={allowedTypes}
            onChange={(event) => setAllowedTypes(event.target.value)}
            placeholder="pdf, docx, jpg, png, zip"
          />
          <span className="text-xs text-slate-500">
            Через запятую. Пусто — набор по умолчанию. Исполняемые файлы, скрипты, HTML и SVG
            запрещены всегда, независимо от этого списка.
          </span>
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={async () => {
              setSaved(false);
              await update.mutateAsync(formValues());
              setSaved(true);
            }}
            disabled={update.isPending}
          >
            Сохранить настройки
          </Button>

          {/* Проверка пишет настоящий файл в хранилище — одна кнопка на оба варианта. */}
          <Button
            type="button"
            tone="secondary"
            onClick={() => {
              test.mutate(formValues());
            }}
            disabled={test.isPending}
          >
            {test.isPending ? 'Проверяем…' : 'Проверить подключение'}
          </Button>

          {saved && <span className="text-sm text-emerald-700">Настройки сохранены.</span>}
          {update.isError && (
            <span className="text-sm text-red-700">{errorMessage(update.error)}</span>
          )}
        </div>

        {result !== null && (
          <Alert tone={result.ok ? 'success' : 'error'}>
            <div className="flex flex-col gap-1">
              <span className="font-medium">
                {result.ok ? 'Хранилище работает' : 'Хранилище не работает'}
              </span>
              <span>{result.message}</span>
              {/* Что делать — самое нужное в отказе: без этого сообщение бесполезно. */}
              <span className="text-sm">{result.hint}</span>
              <span className="text-xs text-slate-500">Проверяли: {result.checked}</span>
              {result.detail !== null && (
                <span className="text-xs text-slate-500">Подробность: {result.detail}</span>
              )}
            </div>
          </Alert>
        )}

        {test.isError && <Alert tone="error">{errorMessage(test.error)}</Alert>}
      </div>
    </Card>
  );
}
