#!/usr/bin/env node
// Создаёт рабочий .env из .env.example, заменяя примеры настоящими случайными
// значениями. Нужен один раз на чистой машине:
//
//   npm run bootstrap:env && docker compose up
//
// Значения секретов не печатаются: они остаются только в файле .env.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = path.join(repositoryRoot, '.env.example');
const targetPath = path.join(repositoryRoot, '.env');
const force = process.argv.includes('--force');

if (!existsSync(examplePath)) {
  console.error(`Не найден ${examplePath}`);
  process.exit(1);
}

if (existsSync(targetPath) && !force) {
  console.error('Файл .env уже существует. Перезаписать: npm run bootstrap:env -- --force');
  process.exit(1);
}

const postgresPassword = randomBytes(24).toString('base64url');
const sessionSecret = randomBytes(48).toString('base64url');
const storageEncryptionKey = randomBytes(32).toString('base64');

function withPassword(connectionString, password) {
  const url = new URL(connectionString);
  url.password = password;
  return url.toString();
}

const replacements = new Map([
  ['POSTGRES_PASSWORD', postgresPassword],
  ['SESSION_SECRET', sessionSecret],
  ['STORAGE_ENCRYPTION_KEY', storageEncryptionKey],
]);

let databaseUrlSeen = false;
let testDatabaseUrlSeen = false;

const lines = readFileSync(examplePath, 'utf8').split('\n');
const result = lines.map((line) => {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return line;

  const separator = trimmed.indexOf('=');
  if (separator <= 0) return line;

  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim();

  if (key === 'DATABASE_URL') {
    databaseUrlSeen = true;
    return `${key}=${withPassword(value, postgresPassword)}`;
  }

  if (key === 'TEST_DATABASE_URL') {
    testDatabaseUrlSeen = true;
    return `${key}=${withPassword(value, postgresPassword)}`;
  }

  const replacement = replacements.get(key);
  return replacement === undefined ? line : `${key}=${replacement}`;
});

if (!databaseUrlSeen) {
  console.error('В .env.example нет DATABASE_URL — проверьте шаблон');
  process.exit(1);
}

const contents = result.join('\n');
for (const secret of [postgresPassword, sessionSecret, storageEncryptionKey]) {
  if (!contents.includes(secret)) {
    console.error('Не удалось подставить сгенерированные значения — проверьте .env.example');
    process.exit(1);
  }
}

writeFileSync(targetPath, contents.endsWith('\n') ? contents : `${contents}\n`, { mode: 0o600 });

console.log(`Создан ${targetPath} со случайными секретами.`);
console.log(`База: ${testDatabaseUrlSeen ? 'DATABASE_URL и TEST_DATABASE_URL' : 'DATABASE_URL'}`);
console.log('Дальше: npm run migrate && npm run dev — или docker compose up');
