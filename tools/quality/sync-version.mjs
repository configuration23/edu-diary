#!/usr/bin/env node
/**
 * Версия монорепозитория: сверка и разнесение по пакетам.
 *
 * Источник истины — корневой `package.json`. Версия интерфейса вшивается в
 * бандл при сборке, поэтому расхождение версий означало бы, что в браузере
 * показывается одно, а на сервере работает другое (docs/VERSIONING.md).
 *
 *   node tools/quality/sync-version.mjs          — проверить (код 1 при расхождении)
 *   node tools/quality/sync-version.mjs --write  — привести пакеты к корневой версии
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKSPACE_PACKAGES = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/contracts/package.json',
  'packages/domain/package.json',
];

const write = process.argv.includes('--write');

function readVersion(relativePath) {
  const raw = readFileSync(`${ROOT}${relativePath}`, 'utf8');
  const parsed = JSON.parse(raw);

  return { raw, version: parsed.version };
}

const root = readVersion('package.json');
const mismatched = [];

for (const relativePath of WORKSPACE_PACKAGES.slice(1)) {
  const current = readVersion(relativePath);
  if (current.version === root.version) continue;

  mismatched.push(`${relativePath}: ${current.version} → ${root.version}`);

  if (write) {
    // Правим только строку версии, сохраняя форматирование файла.
    const updated = current.raw.replace(
      `"version": "${current.version}"`,
      `"version": "${root.version}"`,
    );
    writeFileSync(`${ROOT}${relativePath}`, updated, 'utf8');
  }
}

if (mismatched.length === 0) {
  console.log(`Версии совпадают: ${root.version} (проверено файлов: ${WORKSPACE_PACKAGES.length})`);
  process.exit(0);
}

for (const line of mismatched) console.error(`  ${line}`);
console.error(
  write
    ? `Версии приведены к ${root.version}`
    : `Версии расходятся с корневой (${root.version}). Запустите: node tools/quality/sync-version.mjs --write`,
);

process.exit(write ? 0 : 1);
