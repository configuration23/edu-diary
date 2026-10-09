// Тест сборки: внешние домены в клиентском бандле (SECURITY.md §3.8).
//
// Правило появилось не из теории: в первой версии index.html подключал Google
// Fonts, и браузер посетителя обращался к внешнему сервису. Любое такое
// обращение — передача данных за пределы контура и нарушение локализации.
//
// Исключения — только «не загружаемые» адреса: пространства имён в inline-SVG,
// идентификаторы схем и ссылки внутри текстов сообщений. Они не приводят к
// сетевым запросам и перечислены явно, чтобы исключение нельзя было добавить
// незаметно. Отдельно проверяются «загружающие» контексты (src, href, url(),
// fetch): там адрес запрещён независимо от хоста.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** Локальные адреса: обращения внутрь контура допустимы. */
export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * Адреса, которые не приводят к запросу в сеть.
 *
 * Список ведётся вручную: каждый хост добавляется осознанно, с пояснением, и
 * виден в отчёте сборки. Если в бандле появился внешний адрес, которого здесь
 * нет, сборка падает — так новое обращение не проскочит незаметно.
 */
export const NON_LOADING_HOSTS = new Set([
  // Пространства имён в inline-SVG и MathML.
  'www.w3.org',
  // Идентификатор JSON Schema в строке (`$schema`), никогда не запрашивается.
  'json-schema.org',
  // Ссылки на документацию, обсуждения и баг-трекеры внутри текстов сообщений
  // об ошибках в зависимостях (React, React DOM, компиляторы): это строки,
  // а не запросы. Загрузка с этих хостов всё равно запрещена — см. правило
  // «loading» ниже: адрес в контексте src/href/url()/fetch падает независимо
  // от того, есть хост в этом списке или нет.
  'react.dev',
  'reactjs.org',
  'github.com',
  'developer.mozilla.org',
  'bugs.webkit.org',
  'bugs.chromium.org',
  'bugzilla.mozilla.org',
]);

const SCANNED_EXTENSIONS = ['.js', '.mjs', '.cjs', '.css', '.html', '.svg'];

const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s"'`()<>\\]+/gi;
const PROTOCOL_RELATIVE_PATTERN =
  /(?<![\w:.])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}(?::\d+)?[^\s"'`()<>\\]*/gi;

/** Загрузка ресурса: такие адреса опасны независимо от хоста. */
const LOADING_CONTEXT_PATTERN =
  /(?:src|href|srcset|action|data|poster)\s*=\s*["']?([^"'\s>]+)|url\(\s*["']?([^"')]+)["']?\s*\)|(?:importScripts|fetch|XMLHttpRequest|EventSource|WebSocket|sendBeacon)\s*\(\s*["']([^"']+)["']|@import\s+(?:url\()?\s*["']?([^"'\s;)]+)/gi;

const HOSTNAME_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$|^localhost$|^(?:\d{1,3}\.){3}\d{1,3}$/;

function hostOf(url) {
  const withoutScheme = url.replace(/^https?:\/\//i, '').replace(/^\/\//, '');
  const host = withoutScheme.split(/[/?#]/, 1)[0] ?? '';
  return host.toLowerCase();
}

function isLocalHost(host) {
  const bare = host.replace(/:\d+$/, '');
  return LOCAL_HOSTS.has(bare);
}

/** Отбрасывает «адреса» из шаблонных строк вида `http://${host}`. */
function isValidHostname(host) {
  const bare = host.replace(/:\d+$/, '');
  if (bare.startsWith('[') || bare.endsWith(']')) {
    return /^\[[0-9a-f:]+\]$/.test(bare); // IPv6
  }
  return HOSTNAME_PATTERN.test(bare);
}

/**
 * Убирает из CSS блочные комментарии: они не выполняются, но содержат ссылки
 * на сайт инструмента (например, баннер Tailwind).
 */
export function stripNonExecutableComments(content, filePath) {
  return filePath.endsWith('.css') ? content.replace(/\/\*[\s\S]*?\*\//g, ' ') : content;
}

/**
 * Ищет внешние адреса в тексте бандла.
 *
 * @returns {{ url: string, host: string, kind: 'external' | 'loading' | 'allowed' }[]}
 */
export function findExternalReferences(content) {
  const references = new Map();

  const collect = (url, loading) => {
    const normalized = url.replace(/[),;]+$/, '');
    const host = hostOf(normalized);
    if (host === '' || isLocalHost(host) || !isValidHostname(host)) return;

    const bare = host.replace(/:\d+$/, '');
    const kind = loading || NON_LOADING_HOSTS.has(bare) === false ? 'external' : 'allowed';
    const existing = references.get(normalized);
    if (existing === undefined || (existing.kind === 'allowed' && kind === 'external')) {
      references.set(normalized, { url: normalized, host: bare, kind });
    }
  };

  for (const match of content.matchAll(ABSOLUTE_URL_PATTERN)) {
    if (match[0] !== undefined) collect(match[0], false);
  }

  for (const match of content.matchAll(PROTOCOL_RELATIVE_PATTERN)) {
    if (match[0] !== undefined) collect(match[0], false);
  }

  for (const match of content.matchAll(LOADING_CONTEXT_PATTERN)) {
    const url = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (url === undefined) continue;
    if (!/^(https?:)?\/\//i.test(url)) continue;
    collect(url, true);
  }

  return [...references.values()];
}

/** Рекурсивно собирает файлы бандла. */
export function collectBundleFiles(directory) {
  const collected = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectBundleFiles(entryPath));
      continue;
    }
    if (SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      collected.push(entryPath);
    }
  }

  return collected;
}

/**
 * Проверяет каталог сборки.
 *
 * @returns {{ failures: {file: string, url: string, host: string, kind: string}[],
 *             allowed: {file: string, url: string}[] }}
 */
export function scanBundle(directory) {
  const failures = [];
  const allowed = [];

  for (const filePath of collectBundleFiles(directory)) {
    const content = stripNonExecutableComments(readFileSync(filePath, 'utf8'), filePath);

    for (const reference of findExternalReferences(content)) {
      if (reference.kind === 'external') {
        failures.push({
          file: filePath,
          url: reference.url,
          host: reference.host,
          kind: reference.kind,
        });
      } else {
        allowed.push({ file: filePath, url: reference.url });
      }
    }
  }

  return { failures, allowed };
}
