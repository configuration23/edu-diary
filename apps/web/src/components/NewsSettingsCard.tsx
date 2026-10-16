import { useState } from 'react';

import type { NewsItemDto } from '@edu-diary/contracts';

import { Alert, Badge, Button, Field, TextInput } from './ui';
import { Section } from './layout';
import { errorMessage } from '../lib/api-client';
import {
  useCreateNews,
  useNews,
  useRemoveNews,
  useUpdateNews,
  useUploadNewsImage,
} from '../lib/queries';

/**
 * Блок «Новости» на странице настроек.
 *
 * Решение владельца: новости публикуются **здесь**, с этой же страницы их правят и убирают.
 *
 * Список берётся с `forEditing=true`: он показывает и **подготовленные** (дата в будущем), и
 * **просроченные** новости. Без этого новость, поставленную на будущее, нельзя было бы найти и
 * поправить — а именно для этого её и готовят заранее.
 */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Draft {
  id: string | null;
  title: string;
  body: string;
  publishedOn: string;
  visibleUntil: string;
  imageFileId: string | null;
  imageName: string | null;
}

function emptyDraft(): Draft {
  return {
    id: null,
    title: '',
    body: '',
    publishedOn: todayIso(),
    visibleUntil: '',
    imageFileId: null,
    imageName: null,
  };
}

function draftOf(item: NewsItemDto): Draft {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    publishedOn: item.publishedOn,
    visibleUntil: item.visibleUntil ?? '',
    imageFileId: null,
    /** Уже прикреплённую картинку не перезагружаем: показываем имя, меняем только по желанию. */
    imageName: item.imageName,
  };
}

export function NewsSettingsCard() {
  const news = useNews({ forEditing: true });
  const create = useCreateNews();
  const update = useUpdateNews();
  const remove = useRemoveNews();
  const upload = useUploadNewsImage();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = news.data?.items ?? [];
  const saving = create.isPending || update.isPending;

  const save = async (): Promise<void> => {
    if (draft === null) return;
    setError(null);

    const payload = {
      title: draft.title,
      body: draft.body,
      publishedOn: draft.publishedOn,
      /** Пустое поле — **снять срок**, то есть показывать бессрочно. */
      visibleUntil: draft.visibleUntil === '' ? null : draft.visibleUntil,
      ...(draft.imageFileId === null ? {} : { imageFileId: draft.imageFileId }),
    };

    try {
      if (draft.id === null) {
        await create.mutateAsync(payload);
      } else {
        await update.mutateAsync({ id: draft.id, ...payload });
      }
      setDraft(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Section
      title="Новости"
      description="Последняя новость показывается на «Обзоре» полностью, предыдущие — свёрнутыми до одной строки."
      actions={
        draft === null ? (
          <Button onClick={() => setDraft(emptyDraft())}>Написать новость</Button>
        ) : undefined
      }
    >
      {draft !== null && (
        <form
          className="flex flex-col gap-4 rounded-md border border-slate-300 bg-slate-50 p-4"
          onSubmit={async (event) => {
            event.preventDefault();
            await save();
          }}
        >
          <Field label="Заголовок">
            <TextInput
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </Field>

          <Field label="Текст новости">
            <textarea
              className="min-h-32 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </Field>

          <div className="flex flex-wrap gap-4">
            <Field label="Показывать с">
              <TextInput
                type="date"
                value={draft.publishedOn}
                onChange={(event) => setDraft({ ...draft, publishedOn: event.target.value })}
              />
              <span className="text-xs text-slate-500">
                Дату можно поставить вперёд: новость появится в назначенный день.
              </span>
            </Field>

            <Field label="Показывать до">
              <TextInput
                type="date"
                value={draft.visibleUntil}
                onChange={(event) => setDraft({ ...draft, visibleUntil: event.target.value })}
              />
              <span className="text-xs text-slate-500">
                Пусто — бессрочно. Так обычно и бывает.
              </span>
            </Field>
          </div>

          <Field label="Картинка (необязательно)">
            <input
              type="file"
              accept="image/*"
              className="text-sm"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file === undefined) return;
                setError(null);

                try {
                  const uploaded = await upload.mutateAsync(file);
                  setDraft({
                    ...draft,
                    imageFileId: uploaded.id,
                    imageName: uploaded.originalName,
                  });
                } catch (caught) {
                  setError(errorMessage(caught));
                }
                event.target.value = '';
              }}
            />
            <span className="text-xs text-slate-500">
              {draft.imageName === null
                ? 'Размер и тип проверяет сервер. Файл хранится там же, где вложения заданий.'
                : `Прикреплено: ${draft.imageName}`}
            </span>
          </Field>

          {error !== null && <Alert tone="error">{error}</Alert>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Сохраняем…' : draft.id === null ? 'Опубликовать' : 'Сохранить'}
            </Button>
            <Button tone="secondary" onClick={() => setDraft(null)}>
              Отмена
            </Button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Новостей пока нет.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-2 last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
              <span className="text-xs text-slate-500">{item.publishedOn}</span>

              {/*
                Состояние словами, а не по датам в голове: администратор должен видеть, показывается
                новость сейчас или ждёт своего дня.
              */}
              {item.publishedOn > todayIso() ? (
                <Badge tone="warning">ещё не показывается</Badge>
              ) : item.visibleUntil !== null && item.visibleUntil < todayIso() ? (
                <Badge tone="neutral">срок истёк</Badge>
              ) : (
                <Badge tone="success">показывается</Badge>
              )}

              <Button tone="secondary" onClick={() => setDraft(draftOf(item))}>
                Править
              </Button>

              <Button
                tone="danger"
                disabled={remove.isPending}
                onClick={async () => {
                  setError(null);
                  try {
                    await remove.mutateAsync(item.id);
                  } catch (caught) {
                    setError(errorMessage(caught));
                  }
                }}
              >
                Убрать
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
