import type { ThemePreference } from '@edu-diary/contracts';

/**
 * Тема оформления.
 *
 * Три состояния: `light`, `dark`, `system`. «Как в системе» — не «светлая»: человек, у которого ОС
 * переключает тему по расписанию, ждёт того же от дневника, поэтому для `system` мы **подписаны** на
 * `prefers-color-scheme` и меняем оформление без перезагрузки.
 *
 * Истина — на сервере (личная настройка учётной записи). Локальный кэш нужен ровно для одного:
 * чтобы **первый кадр** не был светлым у того, кто выбрал тёмную тему, — иначе при каждой загрузке
 * экран мигает.
 */

const CACHE_KEY = 'edu-diary:theme';

/** Что применять: сохранённый выбор, а без него — системная настройка. */
export function readCachedTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(CACHE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    /** Приватный режим может запрещать хранилище — тогда просто следуем системе. */
    return 'system';
  }
}

/** Запомнить выбор для первого кадра следующей загрузки. */
export function cacheTheme(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(CACHE_KEY, theme);
  } catch {
    /* Нечего делать: без кэша будет один мигающий кадр, это не ошибка. */
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Применить тему к документу. Возвращает функцию отписки от системной настройки. */
export function applyTheme(theme: ThemePreference): () => void {
  const root = document.documentElement;

  const paint = (): void => {
    const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());

    /**
     * Атрибут, а не класс: `data-theme` читается в CSS как `:root[data-theme='dark']` и не мешает
     * стилям, которые уже висят на `<html>`.
     */
    if (dark) {
      root.dataset.theme = 'dark';
    } else {
      delete root.dataset.theme;
    }
  };

  paint();

  if (theme !== 'system') return () => undefined;

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (): void => paint();
  media.addEventListener('change', listener);

  return () => media.removeEventListener('change', listener);
}
