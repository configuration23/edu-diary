// Поиск секретов в репозитории (SECURITY.md §6).
//
// Секретов в репозитории быть не должно: значения приходят только из переменных
// окружения. Проверка ищет типичные шаблоны ключей, а также присваивания
// «секретному» имени длинной строки-литерала. Значения в отчёте маскируются.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Каталоги, которые не являются содержимым репозитория. */
export const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.vite',
  '.playwright',
  'playwright-report',
  'test-results',
]);

/** Файлы вне проверки: локальные секреты, lockfile, сам сканер. */
const IGNORED_FILES = new Set([
  '.env',
  '.env.local',
  '.env.example',
  'package-lock.json',
  'scan-secrets.mjs',
  'check-secrets.mjs',
  'secrets.test.mjs',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.md',
  '.sql',
  '.sh',
  '.conf',
  '.example',
]);

/** Шаблоны высокой точности: срабатывают и в документации. */
export const HIGH_CONFIDENCE_PATTERNS = [
  {
    id: 'private-key-block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  { id: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

/** Присваивание секретному имени длинного литерала — только для кода и конфигов. */
export const ASSIGNMENT_PATTERN =
  /\b(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)\w*\s*[:=]\s*["'`]([^"'`\n]{12,})["'`]/gi;

const PLACEHOLDER_MARKERS = [
  'example',
  'change-me',
  'changeme',
  'change_me',
  'placeholder',
  'your-',
  'your_',
  'dummy',
  'sample',
  'replace',
  'xxx',
  'todo',
  'test',
];

function isPlaceholder(value) {
  const lower = value.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) return true;
  if (value.startsWith('${') || value.includes('${')) return true;
  if (/^[A-Z0-9_]+$/.test(value)) return true;
  return false;
}

function mask(value) {
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}…${'*'.repeat(6)}`;
}

function lineOf(content, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (content[position] === '\n') line += 1;
  }
  return line;
}

function isMarkdown(filePath) {
  return filePath.endsWith('.md');
}

/**
 * Ищет секреты в тексте файла.
 *
 * @returns {{ file: string, line: number, rule: string, masked: string }[]}
 */
export function scanText(content, filePath) {
  const findings = [];

  for (const { id, pattern } of HIGH_CONFIDENCE_PATTERNS) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    for (const match of content.matchAll(global)) {
      findings.push({
        file: filePath,
        line: lineOf(content, match.index ?? 0),
        rule: id,
        masked: mask(match[0]),
      });
    }
  }

  if (!isMarkdown(filePath)) {
    const global = new RegExp(ASSIGNMENT_PATTERN.source, ASSIGNMENT_PATTERN.flags);
    for (const match of content.matchAll(global)) {
      const value = match[1];
      if (value === undefined || isPlaceholder(value)) continue;
      findings.push({
        file: filePath,
        line: lineOf(content, match.index ?? 0),
        rule: 'hardcoded-secret-assignment',
        masked: mask(value),
      });
    }
  }

  return findings;
}

function collectFiles(directory, collected = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      collectFiles(path.join(directory, entry.name), collected);
      continue;
    }

    if (!entry.isFile()) continue;
    if (IGNORED_FILES.has(entry.name)) continue;
    if (entry.name.startsWith('.env.')) continue;

    const extension = path.extname(entry.name);
    if (extension !== '' && !TEXT_EXTENSIONS.has(extension)) continue;

    collected.push(path.join(directory, entry.name));
  }

  return collected;
}

/** Проверяет репозиторий целиком. Локальные `.env` не считаются частью репозитория. */
export function scanRepository(repositoryRoot) {
  const findings = [];

  for (const filePath of collectFiles(repositoryRoot)) {
    if (!statSync(filePath).isFile()) continue;
    const content = readFileSync(filePath, 'utf8');
    findings.push(
      ...scanText(content, path.relative(repositoryRoot, filePath).split(path.sep).join('/')),
    );
  }

  return findings;
}
