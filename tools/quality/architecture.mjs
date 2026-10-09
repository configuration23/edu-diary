// Проверка границ модулей (ARCHITECTURE.md §3).
//
// Правила:
//  1. module-boundary     — модуль обращается к другому модулю только через его `index.ts`;
//                           `src/shared/**` не импортирует модули вообще;
//  2. module-public-entry — у каждого модуля есть публичный вход `index.ts`;
//  3. sql-location        — SQL-пакеты используются только в репозиториях, схемах и `shared/db`;
//  4. package-layering    — пакеты `packages/*` не зависят от приложений и от чужих пакетов;
//  5. app-boundary        — фронтенд не импортирует код бэкенда.
//
// Работает по списку файлов в памяти: и над деревом проекта, и над синтетическими
// примерами в тестах (поэтому правило проверяемо, а не «на словах»).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const RULES = {
  moduleBoundary: 'module-boundary',
  modulePublicEntry: 'module-public-entry',
  sqlLocation: 'sql-location',
  packageLayering: 'package-layering',
  appBoundary: 'app-boundary',
};

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts'];
const SQL_PACKAGES = ['drizzle-orm', 'postgres'];
const NODE_BUILTIN_PREFIX = 'node:';

const API_MODULES_PREFIX = 'apps/api/src/modules/';
const API_SHARED_PREFIX = 'apps/api/src/shared/';

const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Нормализует путь к виду с прямыми слэшами и без завершающего слэша. */
export function toPosix(value) {
  return value.split(path.sep).join('/').replace(/\/+$/, '');
}

function lineOf(source, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (source[position] === '\n') line += 1;
  }
  return line;
}

/** Возвращает уникальные спецификаторы импортов с номерами строк. */
export function extractImports(source) {
  const found = new Map();

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier === undefined || specifier === '') continue;
      if (!found.has(specifier)) found.set(specifier, lineOf(source, match.index ?? 0));
    }
  }

  return [...found].map(([specifier, line]) => ({ specifier, line }));
}

function isRelative(specifier) {
  return specifier.startsWith('.');
}

function isSqlPackage(specifier) {
  return SQL_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

/** Является ли файл разрешённым местом для SQL. */
export function isSqlAllowedLocation(relativePath) {
  if (relativePath.startsWith('apps/api/src/shared/db/')) return true;
  return /\.(repository|schema)\.tsx?$/.test(relativePath);
}

/** Модуль, которому принадлежит путь (файл или каталог модуля), или null. */
export function moduleOf(relativePath) {
  if (!relativePath.startsWith(API_MODULES_PREFIX)) return null;
  const rest = relativePath.slice(API_MODULES_PREFIX.length);
  const slash = rest.indexOf('/');
  const name = slash === -1 ? rest : rest.slice(0, slash);
  return name === '' ? null : name;
}

/** Ищет существующий файл среди кандидатов относительного импорта. */
export function resolveRelativeImport(specifier, fromFile, fileSet) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base];

  if (SOURCE_EXTENSIONS.some((extension) => base.endsWith(extension))) {
    candidates.push(base.replace(/\.tsx?$/, '.js'));
  } else {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(`${base}${extension}`);
    for (const extension of SOURCE_EXTENSIONS)
      candidates.push(path.join(base, `index${extension}`));
  }

  for (const candidate of candidates) {
    const normalized = toPosix(candidate);
    if (fileSet.has(normalized)) return normalized;
  }

  return null;
}

function violation({ rule, file, line, specifier, message }) {
  return { rule, file, line, specifier, message };
}

/**
 * Проверяет один файл.
 *
 * @param {{ path: string, source: string }} file
 * @param {{ repoRoot: string, fileSet: Set<string> }} context
 */
function checkFile(file, context) {
  const { repoRoot, fileSet } = context;
  const relativePath = toPosix(path.relative(repoRoot, file.path));
  const violations = [];
  const currentModule = moduleOf(relativePath);
  const isApiFile = relativePath.startsWith('apps/api/src/');
  const packageMatch = /^packages\/([^/]+)\//.exec(relativePath);
  const packageName = packageMatch?.[1] ?? null;

  for (const { specifier, line } of extractImports(file.source)) {
    if (isSqlPackage(specifier) && isApiFile && !isSqlAllowedLocation(relativePath)) {
      violations.push(
        violation({
          rule: RULES.sqlLocation,
          file: relativePath,
          line,
          specifier,
          message: `SQL разрешён только в *.repository.ts, *.schema.ts и src/shared/db — перенесите запрос в репозиторий модуля`,
        }),
      );
    }

    if (!isRelative(specifier)) {
      // Внешние зависимости разрешены: их фиксирует lockfile, а фронтенд отдельно
      // проверяется тестом сборки на внешние домены (SECURITY.md §3.8).
      // Тестам разрешён инструментарий разработки (vitest, @playwright/test).
      const isTestFile = /\.test\.tsx?$/.test(relativePath) || relativePath.includes('/test/');

      if (packageName !== null && !isTestFile) {
        const allowedForPackage =
          specifier.startsWith(NODE_BUILTIN_PREFIX) ||
          (packageName === 'contracts' && (specifier === 'zod' || specifier.startsWith('zod/')));

        if (!allowedForPackage) {
          violations.push(
            violation({
              rule: RULES.packageLayering,
              file: relativePath,
              line,
              specifier,
              message: `пакет packages/${packageName} не должен зависеть от других пакетов (кроме zod в contracts)`,
            }),
          );
        }
      }
      continue;
    }

    // Если файла-цели нет в наборе (например, он не TypeScript), проверяем
    // по нормализованному пути: правила слоёв не должны зависеть от наличия файла.
    const resolvedPath =
      resolveRelativeImport(specifier, file.path, fileSet) ??
      toPosix(path.resolve(path.dirname(file.path), specifier));
    const resolved = toPosix(path.relative(repoRoot, resolvedPath));

    if (isApiFile && resolved.startsWith('apps/web/')) {
      violations.push(
        violation({
          rule: RULES.appBoundary,
          file: relativePath,
          line,
          specifier,
          message: 'бэкенд не импортирует код фронтенда',
        }),
      );
      continue;
    }

    const isWebFile = relativePath.startsWith('apps/web/');

    if (isWebFile && resolved.startsWith('apps/api/')) {
      violations.push(
        violation({
          rule: RULES.appBoundary,
          file: relativePath,
          line,
          specifier,
          message: 'фронтенд не импортирует код бэкенда: используйте HTTP API и packages/contracts',
        }),
      );
      continue;
    }

    if (packageName !== null && resolved.startsWith('apps/')) {
      violations.push(
        violation({
          rule: RULES.packageLayering,
          file: relativePath,
          line,
          specifier,
          message: `пакет packages/${packageName} не должен зависеть от приложений`,
        }),
      );
      continue;
    }

    if (currentModule !== null) {
      const ownModulePrefix = `${API_MODULES_PREFIX}${currentModule}/`;
      if (resolved.startsWith(ownModulePrefix)) continue;

      if (resolved.startsWith(API_SHARED_PREFIX)) continue;

      const targetModule = moduleOf(resolved);
      if (targetModule !== null) {
        if (resolved === `${API_MODULES_PREFIX}${targetModule}/index.ts`) continue;

        violations.push(
          violation({
            rule: RULES.moduleBoundary,
            file: relativePath,
            line,
            specifier,
            message: `обращение к модулю «${targetModule}» минуя публичный вход: используйте '../${targetModule}'`,
          }),
        );
        continue;
      }

      violations.push(
        violation({
          rule: RULES.moduleBoundary,
          file: relativePath,
          line,
          specifier,
          message:
            'модуль может импортировать только свои файлы, src/shared и публичные входы других модулей',
        }),
      );
      continue;
    }

    if (relativePath.startsWith(API_SHARED_PREFIX) && resolved.startsWith(API_MODULES_PREFIX)) {
      violations.push(
        violation({
          rule: RULES.moduleBoundary,
          file: relativePath,
          line,
          specifier,
          message:
            'src/shared не должен зависеть от модулей: зависимость идёт от модуля к shared, а не наоборот',
        }),
      );
    }
  }

  return violations;
}

/**
 * Проверяет набор файлов.
 *
 * @param {{ repoRoot: string, files: Array<{ path: string, source: string }> }} input
 */
export function checkFiles({ repoRoot, files }) {
  const absoluteRoot = path.resolve(repoRoot);
  const normalized = files.map((file) => ({ ...file, path: toPosix(path.resolve(file.path)) }));
  const fileSet = new Set(normalized.map((file) => file.path));

  const violations = [];

  for (const file of normalized) {
    violations.push(...checkFile(file, { repoRoot: absoluteRoot, fileSet }));
  }

  const moduleDirectories = new Set();
  for (const file of normalized) {
    const relativePath = toPosix(path.relative(absoluteRoot, file.path));
    const moduleName = moduleOf(relativePath);
    if (moduleName !== null) moduleDirectories.add(moduleName);
  }

  for (const moduleName of [...moduleDirectories].sort()) {
    const entry = `${API_MODULES_PREFIX}${moduleName}/index.ts`;
    if (!fileSet.has(toPosix(path.resolve(absoluteRoot, entry)))) {
      violations.push(
        violation({
          rule: RULES.modulePublicEntry,
          file: entry,
          line: 1,
          specifier: null,
          message: `у модуля «${moduleName}» нет публичного входа index.ts`,
        }),
      );
    }
  }

  return violations.sort((left, right) =>
    `${left.file}:${left.line}`.localeCompare(`${right.file}:${right.line}`),
  );
}

function collectSourceFiles(directory) {
  const collected = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      collected.push(entryPath);
    }
  }

  return collected;
}

/** Читает исходники проекта и проверяет их. */
export function checkProject(repoRoot) {
  const absoluteRoot = path.resolve(repoRoot);
  const directories = ['apps/api/src', 'apps/web/src', 'packages'];

  const files = [];
  for (const directory of directories) {
    const absolute = path.join(absoluteRoot, directory);
    for (const filePath of collectSourceFiles(absolute)) {
      files.push({ path: filePath, source: readFileSync(filePath, 'utf8') });
    }
  }

  return { violations: checkFiles({ repoRoot: absoluteRoot, files }), checkedFiles: files.length };
}

/** Человекочитаемая строка для отчёта. */
export function formatViolation(item) {
  const location = `${item.file}:${item.line}`;
  const about = item.specifier === null ? '' : ` (${item.specifier})`;
  return `${location}${about} — [${item.rule}] ${item.message}`;
}
