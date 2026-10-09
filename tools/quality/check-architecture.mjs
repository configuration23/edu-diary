#!/usr/bin/env node
// Проверка границ модулей. Падает с кодом 1 — то есть ломает сборку и CI.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkProject, formatViolation } from './architecture.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const { violations, checkedFiles } = checkProject(repositoryRoot);

if (violations.length === 0) {
  console.log(`Архитектура: нарушений нет (проверено файлов: ${checkedFiles})`);
  process.exit(0);
}

console.error(`Архитектура: найдено нарушений — ${violations.length}`);
for (const item of violations) {
  console.error(`  ${formatViolation(item)}`);
}
console.error('Подробности правил — docs/ARCHITECTURE.md §3.');
process.exit(1);
