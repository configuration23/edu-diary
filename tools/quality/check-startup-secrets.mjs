#!/usr/bin/env node
// Проверка «приложение отказывается стартовать без секретов» (ROADMAP.md, Этап 0).
//
// Запускает собранный API с разным окружением и убеждается, что процесс падает с
// ненулевым кодом и объясняет причину. Требует `npm run build`.
//
// NODE_ENV в проверках не development — иначе подхватился бы локальный .env и
// «отсутствующий» секрет нашёлся бы в файле.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const entryPoint = path.join(repositoryRoot, 'apps', 'api', 'dist', 'main.js');
const examplePath = path.join(repositoryRoot, '.env.example');

if (!existsSync(entryPoint)) {
  console.error(`Не найден собранный API: ${entryPoint}. Сначала выполните npm run build.`);
  process.exit(2);
}

if (!existsSync(examplePath)) {
  console.error(`Не найден ${examplePath}`);
  process.exit(2);
}

/** Читает значения-примеры прямо из .env.example, чтобы они не разошлись с кодом. */
function readExampleSecrets() {
  const values = {};

  for (const line of readFileSync(examplePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }

  return values;
}

const exampleSecrets = readExampleSecrets();

for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'STORAGE_ENCRYPTION_KEY']) {
  if (exampleSecrets[key] === undefined) {
    console.error(`В .env.example нет ${key}`);
    process.exit(2);
  }
}

const validSecrets = {
  DATABASE_URL: 'postgres://edu_diary:postgres-password@127.0.0.1:5432/edu_diary',
  SESSION_SECRET: 'bootstrap-check-session-secret-with-more-than-32-characters',
  STORAGE_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
};

const cases = [
  {
    name: 'без обязательных секретов',
    env: { NODE_ENV: 'test' },
    expectedKeys: ['DATABASE_URL', 'SESSION_SECRET', 'STORAGE_ENCRYPTION_KEY'],
  },
  {
    name: 'со значениями-примерами из .env.example',
    env: { NODE_ENV: 'test', ...exampleSecrets },
    expectedKeys: ['совпадает с примером'],
  },
  {
    name: 'без ключа шифрования хранилища',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: validSecrets.DATABASE_URL,
      SESSION_SECRET: validSecrets.SESSION_SECRET,
    },
    expectedKeys: ['STORAGE_ENCRYPTION_KEY'],
  },
  {
    name: 'с коротким секретом сессии',
    env: { NODE_ENV: 'test', ...validSecrets, SESSION_SECRET: 'too-short' },
    expectedKeys: ['минимум 32 символа'],
  },
];

/** Запускает процесс и пытается прочитать вывод; в песочнице без каналов — только код. */
function run(env) {
  const options = {
    cwd: repositoryRoot,
    env: { PATH: process.env.PATH, ...env },
    timeout: 30_000,
  };

  const piped = spawnSync(process.execPath, [entryPoint], { ...options, encoding: 'utf8' });
  if (piped.error?.code === 'EPERM') {
    const inherited = spawnSync(process.execPath, [entryPoint], { ...options, stdio: 'inherit' });
    return { status: inherited.status, output: '' };
  }

  return { status: piped.status, output: `${piped.stdout ?? ''}${piped.stderr ?? ''}` };
}

let failures = 0;

for (const testCase of cases) {
  const { status, output } = run(testCase.env);
  const problems = [];

  if (status === 0) problems.push('процесс завершился успешно, хотя должен был упасть');
  if (output !== '' && !output.includes('ENV_INVALID')) {
    problems.push('в выводе нет маркера ENV_INVALID');
  }
  for (const key of testCase.expectedKeys) {
    if (output !== '' && !output.includes(key)) problems.push(`в выводе нет «${key}»`);
  }

  if (problems.length === 0) {
    console.log(`  ok  ${testCase.name}${output === '' ? ' (вывод недоступен в песочнице)' : ''}`);
  } else {
    failures += 1;
    console.error(`  ПАДЕНИЕ  ${testCase.name}`);
    for (const problem of problems) console.error(`     - ${problem}`);
    if (output !== '') console.error(output.trimEnd());
  }
}

if (failures > 0) {
  console.error(`Отказ старта без секретов: не выполнено проверок — ${failures}`);
  process.exit(1);
}

console.log(`Отказ старта без секретов подтверждён (проверок: ${cases.length})`);
