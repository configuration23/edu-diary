// Сквозные сценарии на отдельной базе.
//
// Зачем: Playwright ожидает пустую базу (мастер настройки проходится один раз),
// а локальная `.env` обычно указывает на базу разработки с уже созданными
// данными. Этот запуск создаёт (при необходимости) отдельную базу, применяет к
// ней миграции и только затем запускает Playwright, поэтому база разработки не
// затрагивается.
//
// Запуск: npm run e2e:isolated
// Имя базы меняется переменной E2E_DATABASE_NAME, строка подключения берётся из
// DATABASE_URL или из `.env` (как в playwright.config.ts). Сценарии Этапа 1
// проходят мастер настройки и ждут пустую базу, поэтому по умолчанию база
// создаётся заново: `--keep` оставляет её содержимое (повторный прогон в том же
// состоянии), `--fresh` дополнительно пересоздаёт уже существующую базу.
//
// Дочерние процессы запускаются с `stdio: 'inherit'`: так вывод виден в
// консоли, а именованные каналы для перехвата не используются.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import postgres from 'postgres';

const DEFAULT_DATABASE_NAME = 'edu_diary_e2e';
const repoRoot = path.resolve(import.meta.dirname, '..', '..');

/** Читает `.env` как набор `КЛЮЧ=значение`; файла может не быть. */
function readEnvFile(filePath) {
  const values = {};

  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return values;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }

  return values;
}

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== '') {
    return process.env.DATABASE_URL;
  }

  const fromFile = readEnvFile(path.join(repoRoot, '.env')).DATABASE_URL;
  if (fromFile === undefined || fromFile === '') {
    throw new Error(
      'DATABASE_URL не задан: укажите переменную окружения или создайте .env (npm run bootstrap:env)',
    );
  }

  return fromFile;
}

/** Строка подключения к служебной базе `postgres` на том же сервере. */
function toAdminUrl(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url;
}

function toTargetUrl(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** Печатает адрес без пароля: он попадает в вывод команды. */
function describeUrl(value) {
  const url = new URL(value);
  const credentials = url.username === '' ? '' : `${url.username}@`;
  return `${url.protocol}//${credentials}${url.host}${url.pathname}`;
}

async function ensureDatabase(databaseUrl, databaseName, { recreate }) {
  const sql = postgres(toAdminUrl(databaseUrl, 'postgres').toString(), {
    max: 1,
    connectTimeoutSeconds: 10,
    onnotice: () => {},
  });

  try {
    // Имя базы не может быть параметром запроса: подставляем кавычки сами, а
    // значение берём только из проверенного шаблона.
    if (!/^[a-z_][a-z0-9_]*$/.test(databaseName)) {
      throw new Error(`Недопустимое имя базы: ${databaseName}`);
    }

    const existing = await sql`select 1 from pg_database where datname = ${databaseName}`;

    if (existing.length > 0 && recreate) {
      // Мастер настройки проходится один раз, поэтому остатки прошлого прогона
      // мешают сценариям сильнее, чем помогают.
      await sql.unsafe(`drop database if exists "${databaseName}" with (force)`);
      console.log(`База ${databaseName} пересоздана.`);
    } else if (existing.length > 0) {
      console.log(`База ${databaseName} уже существует — использую её как есть.`);
      return;
    }

    await sql.unsafe(`create database "${databaseName}"`);
    if (existing.length === 0) console.log(`Создана база ${databaseName}.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function runStep(title, command, args, env) {
  console.log(`\n=== ${title} ===`);

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.error(`\n${title}: неуспешно (код ${result.status ?? 'нет'})`);
    process.exit(result.status ?? 1);
  }
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  const targetName = process.env.E2E_DATABASE_NAME ?? DEFAULT_DATABASE_NAME;
  const devName = new URL(databaseUrl).pathname.replace('/', '');
  const args = process.argv.slice(2);
  const keepDatabase = args.includes('--keep');
  const freshDatabase = args.includes('--fresh');

  if (keepDatabase && freshDatabase) {
    throw new Error('Флаги --keep и --fresh противоречат друг другу: выберите один');
  }

  // Мастер настройки проходится один раз: по умолчанию базу создаём заново.
  const recreate = !keepDatabase || freshDatabase;

  if (targetName === devName) {
    throw new Error(
      `E2E_DATABASE_NAME совпадает с базой разработки (${devName}): сценарии проходят мастер настройки и меняют данные. Укажите отдельную базу.`,
    );
  }

  const targetUrl = toTargetUrl(databaseUrl, targetName);
  console.log(`Сквозные сценарии на отдельной базе: ${describeUrl(targetUrl)}`);

  await ensureDatabase(databaseUrl, targetName, { recreate });

  const env = { DATABASE_URL: targetUrl };

  // Сборка и миграции повторяют шаги CI: e2e проверяют собранный API.
  runStep('Сборка', 'npm', ['run', 'build'], env);
  runStep('Миграции', 'npm', ['run', 'migrate'], env);
  runStep('Сквозные сценарии', 'npm', ['run', 'test:e2e'], env);
}

await main();
