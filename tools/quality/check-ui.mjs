#!/usr/bin/env node
// Замок оформления: node tools/quality/check-ui.mjs
//
// Падает с кодом 1 и ломает сборку. Без него правила держатся на дисциплине: один новый экран — и в
// разметку возвращаются `text-slate-500`, `<select>` и `gap-4`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { checkSources } from './ui-rules.mjs';

const ROOT = path.resolve('apps/web/src');

function collect(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) return collect(full);
    if (!full.endsWith('.tsx') && !full.endsWith('.ts')) return [];

    return [
      {
        path: path.relative(process.cwd(), full).split(path.sep).join('/'),
        text: readFileSync(full, 'utf8'),
      },
    ];
  });
}

const violations = checkSources(collect(ROOT));

if (violations.length === 0) {
  console.log('Оформление: нарушений нет.');
  process.exit(0);
}

console.error(`Оформление: нарушений ${violations.length}\n`);

for (const violation of violations) {
  console.error(`${violation.path}:${violation.line} — ${violation.rule}: ${violation.found}`);
  console.error(`  → ${violation.hint}`);
}

console.error('\nПравила и классы объектов: docs/UI-KIT.md. Проверка есть в `npm run check:ui`.');

process.exit(1);
