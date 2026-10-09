import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Пути внутри приложения.
 *
 * Модуль намеренно не полагается на расположение файла: собранный бандл лежит в
 * `apps/api/dist`, исходники — в `apps/api/src`, а рабочий каталог может быть
 * любым (в том числе `/app` в контейнере). Корень пакета ищется по `package.json`
 * с именем `@edu-diary/api` вверх от рабочего каталога и от самого модуля.
 */

const API_PACKAGE_NAME = '@edu-diary/api';

let cachedApiRoot: string | null = null;
let cachedVersion: string | null = null;

function* ancestors(startDirectory: string): Generator<string> {
  let current = path.resolve(startDirectory);
  for (;;) {
    yield current;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function readPackageName(directory: string): string | null {
  const manifestPath = path.join(directory, 'package.json');
  if (!existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown };
    return typeof manifest.name === 'string' ? manifest.name : null;
  } catch {
    return null;
  }
}

/** Абсолютный путь к каталогу `apps/api`. */
export function apiPackageRoot(): string {
  if (cachedApiRoot !== null) return cachedApiRoot;

  const starts = [process.cwd()];
  try {
    starts.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    // import.meta.url недоступен (например, при нестандартной загрузке) — хватит cwd.
  }

  for (const start of starts) {
    for (const directory of ancestors(start)) {
      if (readPackageName(directory) === API_PACKAGE_NAME) {
        cachedApiRoot = directory;
        return directory;
      }
    }
  }

  throw new Error(
    `Не найден каталог пакета ${API_PACKAGE_NAME}: нужен package.json с этим именем выше рабочего каталога`,
  );
}

/** Абсолютный путь к корню репозитория (родитель каталогов `apps` и `packages`). */
export function repositoryRoot(): string {
  return path.resolve(apiPackageRoot(), '..', '..');
}

/** Версия приложения из `apps/api/package.json`. */
export function applicationVersion(): string {
  if (cachedVersion !== null) return cachedVersion;

  try {
    const manifest = JSON.parse(
      readFileSync(path.join(apiPackageRoot(), 'package.json'), 'utf8'),
    ) as { version?: unknown };
    cachedVersion = typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }

  return cachedVersion;
}

/** Каталог SQL-миграций Drizzle. */
export function migrationsDirectory(): string {
  return path.join(apiPackageRoot(), 'drizzle');
}

/** Тестовые сценарии сбрасывают кэш путей между проверками. */
export function resetPathCache(): void {
  cachedApiRoot = null;
  cachedVersion = null;
}
