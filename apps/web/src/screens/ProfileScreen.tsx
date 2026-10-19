import { useState } from 'react';

import { useHealth, useUpdateTheme, useUpdateViewMode } from '../lib/queries';
import { CLIENT_VERSION } from '../lib/version';
import { isSystemAdmin } from '../lib/access';
import { Alert, Badge, Segmented, formatDateTime } from '../components/ui';
import { ChangePasswordCard } from '../components/ChangePasswordCard';
import { SystemStatus, type HealthState } from '../components/SystemStatus';
import { Page, PageHeader, Section } from '../components/layout';
import { Spoiler } from '../components/Spoiler';
import { errorMessage } from '../lib/api-client';
import type { SessionResponseDto, ThemePreference, ViewMode } from '@edu-diary/contracts';

/**
 * Профиль пользователя.
 *
 * Заведён по решению владельца (Этап 6): раньше данные учётной записи, смена пароля, права и
 * версия системы лежали **на странице общего обзора** — вперемешку с обзором. Теперь у человека
 * есть своё место: «Обзор» — про заведение, профиль — про меня.
 *
 * Порядок блоков — по частоте обращения:
 * 1. **Данные профиля** — кто я и как со мной связаться;
 * 2. **Смена пароля** — самое частое действие на этой странице;
 * 3. **Ваш доступ** — роли и права: сюда смотрят, когда что-то недоступно, и надо понять почему;
 * 4. **О версии** — сюда смотрят при обращении в поддержку, и тогда важны обе версии и схема БД.
 *
 * Почта и телефон показываются, но **не правятся здесь**: их меняет администратор в разделе
 * пользователей. Если разрешить правку, надо решать вопрос подтверждения адреса — это отдельная
 * работа, и в объём этапа она не входит.
 */

/** Значение поля профиля: прочерк, если не заполнено. Не пустое место, а видимый ответ. */
function Value({ children }: { children: string | null }) {
  if (children === null || children === '') {
    return <span className="text-subtle-foreground">не указано</span>;
  }

  return <span className="text-foreground">{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

/** Состояние связи с сервером: загрузка, ответ сервера или недоступность. */
function healthState(query: ReturnType<typeof useHealth>): HealthState {
  if (query.isLoading) return { kind: 'loading' };
  if (query.isError || query.data === undefined) {
    return { kind: 'unreachable', message: 'сервер не ответил' };
  }

  return { kind: 'ready', health: query.data };
}

/**
 * Выбор темы: светлая, тёмная, как в системе.
 *
 * Три состояния, а не два: «как в системе» — отдельное намерение, а не «светлая». Выбор уходит на
 * сервер (личная настройка учётной записи) и сразу применяется к документу — без перезагрузки.
 */
function ThemeChoice({ current }: { current: ThemePreference }) {
  const update = useUpdateTheme();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Тема оформления"
        value={current}
        onChange={(next) => {
          setError(null);
          void update
            .mutateAsync({ theme: next })
            .catch((caught) => setError(errorMessage(caught)));
        }}
        options={[
          { value: 'system', label: 'Как в системе' },
          { value: 'light', label: 'Светлая' },
          { value: 'dark', label: 'Тёмная' },
        ]}
      />

      <p className="text-sm text-muted-foreground">
        «Как в системе» следует настройке вашей операционной системы и переключается вместе с ней.
      </p>

      {error !== null && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/**
 * Вид страниц: компактно (блоки в спойлерах) или развёрнуто (блоки подряд).
 *
 * Один переключатель на всё приложение: «Справочники», «Настройки», «Настройки обучения». Решение
 * владельца: кому-то нужен короткий обзор разделов, кому-то — всё сразу.
 */
/** Ученик или представитель: этим ролям настройка вида страниц не нужна. */
function isLearner(session: SessionResponseDto): boolean {
  return session.user.roles.some((role) => role.code === 'student' || role.code === 'parent');
}

function ViewModeChoice({ current }: { current: ViewMode }) {
  const update = useUpdateViewMode();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Segmented
        label="Вид страниц"
        value={current}
        onChange={(next) => {
          setError(null);
          void update
            .mutateAsync({ viewMode: next })
            .catch((caught) => setError(errorMessage(caught)));
        }}
        options={[
          { value: 'compact', label: 'Компактно' },
          { value: 'expanded', label: 'Развёрнуто' },
        ]}
      />

      <p className="text-sm text-muted-foreground">
        «Компактно» сворачивает блоки в спойлеры: видно название и краткое описание, содержимое
        раскрывается по нажатию. «Развёрнуто» показывает блоки подряд.
      </p>

      {error !== null && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

export function ProfileScreen({
  session,
  onPasswordChanged,
}: {
  session: SessionResponseDto;
  /** Что делать после смены пароля: экран временного пароля уводит на «Обзор». */
  onPasswordChanged?: () => void;
}) {
  const health = useHealth();
  const api = health.data;
  const client = CLIENT_VERSION;

  /**
   * Технические сведения — **только системному администратору** (решение владельца): состояние
   * сервера, версии и схема базы нужны при разборе сбоя, а не в личной странице преподавателя.
   * Будущему директору они тоже не нужны и могут только путать.
   */
  const showSystemInfo = isSystemAdmin(session);

  return (
    <Page width="form">
      <PageHeader
        title="Профиль"
        description="Ваши данные, пароль и права. Почту и телефон изменяет администратор."
      />

      <Section title="Данные профиля">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Фамилия, имя, отчество">
            <Value>{session.user.fullName}</Value>
          </Field>
          <Field label="Имя пользователя (логин)">
            <Value>{session.user.username}</Value>
          </Field>
          <Field label="Почта">
            <Value>{session.user.email}</Value>
          </Field>
          <Field label="Телефон">
            <Value>{session.user.phone}</Value>
          </Field>
        </div>

        {session.user.mustChangePassword && (
          <p className="text-sm text-warning-foreground">
            Требуется сменить пароль: он выдан администратором. Смените его ниже.
          </p>
        )}
      </Section>

      {/*
        Вид страниц — настройка сотрудников. Ученику и представителю менять нечего: спойлеры на их
        экранах не используются, и переключатель только задавал бы вопрос без ответа.
      */}
      {session.user.mustChangePassword && (
        <Alert tone="warning">
          Вы вошли с временным паролем. Смените его ниже — до этого остальные разделы недоступны.
        </Alert>
      )}

      <Section title="Оформление">
        <ThemeChoice current={session.user.theme} />
        {!isLearner(session) && <ViewModeChoice current={session.user.viewMode} />}
      </Section>

      <ChangePasswordCard
        {...(onPasswordChanged === undefined ? {} : { onChanged: onPasswordChanged })}
      />

      {/*
        «Ваш доступ» — спойлером (просьба владельца): список прав длинный и отодвигает остальное.
        Текст спойлера — прежняя подпись раздела, она же объясняет, кто меняет права.
      */}
      <Spoiler title="Ваш доступ" summary="Права выданы ролями; изменяет их администратор.">
        <p className="flex flex-wrap gap-2">
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
                className="flex justify-between gap-3 border-b border-border py-1"
              >
                <span className="text-foreground">{grant.permission}</span>
                <span className="text-subtle-foreground">{grant.scope}</span>
              </li>
            ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          Область действия: <code>own</code> — своё, <code>group</code> — своя группа,{' '}
          <code>assigned</code> — свои назначения, <code>all</code> — всё.
        </p>
      </Spoiler>

      {/*
        Технические блоки — **только системному администратору**.

        Состояние системы пришло сюда с «Обзора»: владелец справедливо заметил, что «Сервер и база
        данных доступны» — не обзор заведения. Но и в личной странице преподавателя ему не место:
        поэтому блок показывается только тому, кто разбирает сбои.
      */}
      {showSystemInfo && (
        <>
          <Section title="Система">
            <SystemStatus state={healthState(health)} />
          </Section>

          <Section
            title="О версии"
            description="Версия приложения меняется вместе с закрытым этапом роадмапа."
          >
            <ul className="grid gap-1 text-sm text-foreground sm:grid-cols-2">
              <li className="flex justify-between gap-3 border-b border-border py-1">
                <span>Версия API</span>
                <span className="font-mono">{api?.version ?? 'недоступна'}</span>
              </li>
              <li className="flex justify-between gap-3 border-b border-border py-1">
                <span>Версия интерфейса</span>
                <span className="font-mono">{client}</span>
              </li>
              <li className="flex justify-between gap-3 border-b border-border py-1">
                <span>Схема БД (миграций)</span>
                <span className="font-mono">{api?.checks.migrations.applied ?? '—'}</span>
              </li>
              <li className="flex justify-between gap-3 border-b border-border py-1">
                <span>Запущен</span>
                <span>{api === undefined ? '—' : formatDateTime(api.startedAt)}</span>
              </li>
            </ul>

            {/*
              Расхождение версий — частая причина «странного» поведения: браузер держит старую
              сборку. Поэтому подсказка конкретная, вплоть до сочетания клавиш.
            */}
            {api !== undefined && api.version !== client && (
              <p className="text-sm text-warning-foreground">
                Версии API и интерфейса различаются: скорее всего, браузер держит старую сборку —
                обновите страницу с очисткой кеша (Ctrl+Shift+R).
              </p>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
