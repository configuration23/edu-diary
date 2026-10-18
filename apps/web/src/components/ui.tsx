import type { ReactNode } from 'react';
import { useRef, useState } from 'react';

/** Небольшой набор примитивов интерфейса (ARCHITECTURE.md §2): без тяжёлого UI-кита. */

/**
 * Выбор файла с видимой кнопкой.
 *
 * Системный `<input type="file">` выглядит как подпись и не подсвечивается при
 * наведении, поэтому было неочевидно, что на него можно нажать. Здесь кнопка своя,
 * а поле ввода скрыто; выбранный файл показываем рядом.
 */
export function FilePicker({
  /**
   * Допустимые типы. Необязательно: часть экранов намеренно не ограничивает выбор, а проверяет тип
   * на сервере (там же решается, что запрещено). Требовать ccept значило бы заставлять экран
   * описывать правило, которого у него нет.
   */
  accept,
  name,
  buttonLabel = 'Выбрать файл',
  onSelect,
}: {
  accept?: string;
  name?: string;
  buttonLabel?: string;
  onSelect: (file: File | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <span className="flex flex-wrap items-center gap-3">
      <input
        ref={input}
        type="file"
        name={name}
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          setFileName(file?.name ?? null);
          onSelect(file);

          /**
           * Сбрасываем поле: иначе повторный выбор **того же** файла не вызовет `change`.
           * Человек исправил файл, выбрал его снова — и ничего не произошло, без сообщения.
           */
          event.target.value = '';
        }}
      />
      <Button tone="secondary" type="button" onClick={() => input.current?.click()}>
        {buttonLabel}
      </Button>
      <span className="text-sm text-muted-foreground">{fileName ?? 'файл не выбран'}</span>
    </span>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      {(title !== undefined || actions !== undefined) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title !== undefined && (
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            )}
            {description !== undefined && (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost';

/**
 * Тона кнопок — только токенами: экран не знает, что акцент синий.
 *
 * Два размера (решение владельца): обычный и мелкий. Больше не заводить — иначе через полгода
 * снова появятся три высоты у кнопок одного назначения.
 */
const BUTTON_TONES: Record<ButtonTone, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-50',
  secondary: 'bg-card text-foreground border border-input hover:bg-muted disabled:opacity-50',
  danger: 'bg-danger text-white hover:opacity-90 disabled:opacity-50',
  ghost: 'text-primary hover:underline disabled:opacity-50',
};

export function Button({
  tone = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  /** `sm` — для строк таблиц; в остальных местах `md`. */
  size?: 'md' | 'sm';
}) {
  const sizes = {
    md: 'h-[var(--control-height)] px-3 text-sm',
    sm: 'h-[var(--control-height-sm)] px-2 text-xs',
  } as const;

  return (
    <button
      type={type}
      {...props}
      className={`inline-flex items-center justify-center rounded-md font-medium transition disabled:cursor-not-allowed ${sizes[size]} ${BUTTON_TONES[tone]} ${props.className ?? ''}`}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** Дополнительные классы обёртки: например `ml-auto`, чтобы увести поле вправо. */
  className?: string;
  children: ReactNode;
}) {
  // Подсказка и ошибка вынесены за пределы <label>: иначе они попадают в
  // доступное имя поля, и обращение к нему по названию становится неточным.
  return (
    <div className={className === undefined ? 'block' : `block ${className}`}>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
        {children}
      </label>
      {hint !== undefined && error === undefined && (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      )}
      {error !== undefined && (
        <span className="mt-1 block text-xs text-danger-foreground">{error}</span>
      )}
    </div>
  );
}

/**
 * Рамка и высота контрола — одно место на все поля.
 *
 * Раньше этот класс был скопирован по разметке 51 раз: любая правка вида требовала 51 правки, а
 * новое поле легко получало другой оттенок рамки.
 */
export const inputClassName =
  'w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-subtle-foreground focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60';

const CONTROL_HEIGHT = 'h-[var(--control-height)]';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} className={`${inputClassName} ${CONTROL_HEIGHT} ${props.className ?? ''}`} />
  );
}

/** Выпадающий список. До этого рисовался по месту: 49 копий рамки с разной высотой. */
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputClassName} ${CONTROL_HEIGHT} ${props.className ?? ''}`} />
  );
}

/** Многострочное поле: та же рамка, но высота задаётся содержимым. */
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={`${inputClassName} min-h-20 py-2 ${props.className ?? ''}`} />
  );
}

/**
 * Флажок с подписью.
 *
 * Подпись — часть примитива: иначе рядом с флажком появлялась то `gap-1`, то `gap-3`, а иногда
 * текст был снаружи и не нажимался вместе с флажком.
 */
export function Checkbox({
  label,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
  /** Классы обёртки: внешние отступы и выравнивание в строке формы. */
  className?: string;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm text-foreground ${className ?? ''}`}>
      <input type="checkbox" {...props} className="size-4 shrink-0 accent-primary" />
      {label}
    </label>
  );
}

/**
 * Строчная ссылка.
 *
 * Была четырьмя разными способами: `text-primary underline` (7 мест), `cursor-pointer
 * text-primary`, `<summary>` и `<Link>` в навигации. Один примитив — одно поведение и один вид.
 */
export function Link({
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) {
  return (
    <a {...props} className={`text-primary underline hover:no-underline ${props.className ?? ''}`}>
      {children}
    </a>
  );
}

/**
 * Переключатель вида: «день / неделя», «все / неразобранные / разобранные».
 *
 * Отдельный примитив, а не кнопка: у выбранного состояния своя роль (`aria-pressed`), и это не
 * действие, а выбор из нескольких. Раньше такие переключатели рисовались чёрными кнопками
 * (`bg-slate-900`) и спорили с главным действием.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  /** Что выбирает человек: нужно для чтения с экрана, на экране не показывается. */
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-input">
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`h-[var(--control-height-sm)] px-3 text-xs font-medium transition first:rounded-l-md last:rounded-r-md ${
              selected
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Вертикальный стек.
 *
 * Отступ выбирается **по смыслу**, а не по вкусу: внутри элемента, между полями, между блоками.
 * В замерах было пять значений `gap` без правила — «когда 4, когда 6» решалось на месте.
 */
export function Stack({
  gap = 'field',
  children,
  className,
}: {
  gap?: 'inline' | 'field' | 'block';
  children: ReactNode;
  className?: string;
}) {
  const gaps = { inline: 'gap-1', field: 'gap-3', block: 'gap-6' } as const;

  return <div className={`flex flex-col ${gaps[gap]} ${className ?? ''}`}>{children}</div>;
}

/**
 * Действия формы: главная кнопка и «Отмена».
 *
 * Порядок и отступы закреплены здесь, потому что «Отмена» то появлялась, то нет, а стояла то слева,
 * то справа. Форма создания, которая открывается кнопкой, обязана закрываться — иначе её нечем
 * закрыть, кроме создания записи.
 */
export function FormActions({
  submitLabel,
  onCancel,
  pending = false,
  disabled = false,
  cancelLabel = 'Отмена',
}: {
  submitLabel: string;
  onCancel?: () => void;
  pending?: boolean;
  disabled?: boolean;
  cancelLabel?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={pending || disabled}>
        {pending ? 'Сохраняем…' : submitLabel}
      </Button>
      {onCancel !== undefined && (
        <Button tone="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
    </div>
  );
}

export function Alert({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success' | 'warning';
  children: ReactNode;
}) {
  /**
   * Заливки статусов — токенами: в тёмной теме они обязаны темнеть. Светлый `amber-50` на тёмной
   * странице стал бы ярким пятном и перетянул внимание с содержимого.
   */
  const tones = {
    info: 'border-info-border bg-info-soft text-info-foreground',
    error: 'border-danger-border bg-danger-soft text-danger-foreground',
    success: 'border-success-border bg-success-soft text-success-foreground',
    warning: 'border-warning-border bg-warning-soft text-warning-foreground',
  } as const;

  return (
    <div role="status" className={`rounded-md border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-muted text-foreground',
    success: 'bg-success-soft text-success-foreground',
    warning: 'bg-warning-soft text-warning-foreground',
    danger: 'bg-danger-soft text-danger-foreground',
  } as const;

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            {head.map((title) => (
              <th key={title} className="px-3 py-2 font-medium">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        {/*
          Строки подсвечиваются при наведении: кликабельные места должны быть
          заметны без подсказки. Строки правки помечаются `data-static` — они
          открыты по клику и фон у них свой.
        */}
        <tbody className="[&>tr:not([data-static]):hover]:bg-muted">{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Календарные даты приходят строками (ADR-016) — показываем как есть. */
export function formatDate(value: string | null): string {
  if (value === null || value === '') return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return day !== undefined && month !== undefined && year !== undefined
    ? `${day}.${month}.${year}`
    : value;
}

export function formatDateTime(value: string | null): string {
  if (value === null) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' });
}
