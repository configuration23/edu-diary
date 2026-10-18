import { useEffect, useState } from 'react';

import type { NewsItemDto } from '@edu-diary/contracts';

import { Alert, Badge, Button, Field, Select, Textarea, TextInput } from './ui';
import { Section } from './layout';
import { errorMessage } from '../lib/api-client';
import {
  useBranding,
  useCreateNews,
  useNews,
  useRemoveNews,
  useUpdateBranding,
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
  /** Где показать картинку: сверху текста или снизу. */
  imagePosition: 'top' | 'bottom';
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
    /** По умолчанию сверху: обычный случай не должен требовать выбора. */
    imagePosition: 'top',
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
    imagePosition: item.imagePosition,
  };
}

/**
 * Блок «Об учебном заведении» для страницы «Обзор».
 *
 * Перенесён сюда из настроек заведения (решение владельца): и это, и новости — про **содержимое**
 * первой страницы, поэтому живут рядом.
 *
 * Видимость — **явный чек-бокс**, а не «заполнено значит показать»: администратор мог заполнить
 * текст, но не хотеть блок на первой странице. И наоборот: не заполнил ничего — и не понял, почему
 * блока нет.
 */
function AboutSettings() {
  const branding = useBranding();
  const update = useUpdateBranding();

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Поля заполняются один раз, когда загрузились: иначе правки затирались бы обновлением. */
  useEffect(() => {
    if (branding.data === undefined) return;
    setTitle(branding.data.aboutTitle ?? '');
    setText(branding.data.aboutText ?? '');
    setVisible(branding.data.aboutVisible);
  }, [branding.data]);

  return (
    <form
      className="flex flex-col gap-4 rounded-md border border-border bg-muted p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaved(false);
        setError(null);

        try {
          await update.mutateAsync({
            aboutTitle: title.trim() === '' ? null : title,
            aboutText: text.trim() === '' ? null : text,
            aboutVisible: visible,
          });
          setSaved(true);
        } catch (caught) {
          setError(errorMessage(caught));
        }
      }}
    >
      {/*
        Заголовок того же вида, что у саб-блока «Новости»: два блока должны читаться как равные
        части одной страницы, а не как «заголовок и приписка под ним».
      */}
      <h3 className="text-base font-semibold text-foreground">Об учебном заведении</h3>

      <Field label="Заголовок">
        <TextInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Об учебном заведении"
        />
      </Field>

      <Field label="Текст">
        <Textarea
          className="min-h-28 w-full rounded-md border border-border px-3 py-2 text-sm"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="История, направления, контакты"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => setVisible(event.target.checked)}
        />
        Показывать блок на странице «Обзор»
      </label>

      {error !== null && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="success">Сохранено: блок покажется на «Обзоре».</Alert>}

      <div>
        <Button type="submit" disabled={update.isPending}>
          Сохранить описание
        </Button>
      </div>
    </form>
  );
}

export function NewsSettingsCard({
  heading = true,
}: {
  /**
   * Показывать свой заголовок и описание.
   *
   * В «Настройках» блок стоит под **спойлером**: название и описание уже в его сводке, и второй
   * заголовок внутри был бы дублем. По умолчанию — показывать.
   */
  heading?: boolean;
} = {}) {
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
      imagePosition: draft.imagePosition,
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
      title={heading ? 'Настройки страницы Обзор' : undefined}
      description={
        heading ? 'Что видит человек на странице «Обзор»: описание заведения и новости.' : undefined
      }
    >
      {/*
        Два саб-блока: сначала описание заведения, под ним новости. Так видно, что обе настройки
        относятся к одной странице, и «Об учебном заведении» не теряется под подписью новостей.
      */}
      <AboutSettings />

      {/* Оформление то же, что у саб-блока «Об учебном заведении»: два блока — равные части. */}
      <div className="flex flex-col gap-4 rounded-md border border-border bg-muted p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">Новости</h3>
          {draft === null && (
            <Button onClick={() => setDraft(emptyDraft())}>Написать новость</Button>
          )}
        </header>

        {draft !== null && (
          <form
            className="flex flex-col gap-4 rounded-md border border-border bg-muted p-4"
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
              <Textarea
                className="min-h-32 w-full rounded-md border border-border px-3 py-2 text-sm"
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
                <span className="text-xs text-muted-foreground">
                  Дату можно поставить вперёд: новость появится в назначенный день.
                </span>
              </Field>

              <Field label="Показывать до">
                <TextInput
                  type="date"
                  value={draft.visibleUntil}
                  onChange={(event) => setDraft({ ...draft, visibleUntil: event.target.value })}
                />
                <span className="text-xs text-muted-foreground">
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
              <span className="text-xs text-muted-foreground">
                {draft.imageName === null
                  ? 'Размер и тип проверяет сервер. Файл хранится там же, где вложения заданий.'
                  : `Прикреплено: ${draft.imageName}`}
              </span>
            </Field>

            <Field label="Где показать картинку">
              <Select
                className="w-full max-w-xs rounded-md border border-border px-3 py-2 text-sm"
                value={draft.imagePosition}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    imagePosition: event.target.value === 'bottom' ? 'bottom' : 'top',
                  })
                }
              >
                <option value="top">Сверху текста</option>
                <option value="bottom">Снизу текста</option>
              </Select>
              <span className="text-xs text-muted-foreground">
                Выбор сохраняется вместе с новостью и действует и на «Обзоре», и в свёрнутом виде.
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
          <p className="text-sm text-muted-foreground">Новостей пока нет.</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 border-b border-border py-2 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.publishedOn}</span>

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
      </div>
    </Section>
  );
}
