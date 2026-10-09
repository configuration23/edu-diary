#!/usr/bin/env node
// Проверка на утечку секретов. Падает с кодом 1 — ломает CI.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepository } from './scan-secrets.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const findings = scanRepository(repositoryRoot);

if (findings.length === 0) {
  console.log('Секретов в репозитории не найдено');
  process.exit(0);
}

console.error(`Найдены потенциальные секреты — ${findings.length}:`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line} — [${finding.rule}] ${finding.masked}`);
}
console.error('Секреты хранятся только в переменных окружения: docs/SECURITY.md §3.2.');
process.exit(1);
