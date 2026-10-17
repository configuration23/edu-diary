#!/usr/bin/env node
// Пересобрать отчёт о состоянии интерфейса: node tools/quality/write-ui-inventory.mjs
//
// Отчёт — не «документ на память», а снимок кода. Поэтому он генерируется: если править числа
// руками, они разойдутся с кодом после первой же правки.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { measureSources, toMarkdown } from './ui-inventory.mjs';

const SOURCE_ROOT = path.resolve('apps/web/src');
const TARGET = path.resolve('docs/UI-INVENTORY.md');

/** Все `.tsx` под каталогом, рекурсивно. */
function collectTsx(directory) {
  const result = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      result.push(...collectTsx(full));
      continue;
    }

    if (!entry.name.endsWith('.tsx')) continue;

    result.push({
      path: path.relative(process.cwd(), full).split(path.sep).join('/'),
      text: readFileSync(full, 'utf8'),
    });
  }

  return result;
}

const sources = collectTsx(SOURCE_ROOT);

if (sources.length === 0) {
  console.error(`Не найдено ни одного .tsx в ${SOURCE_ROOT}`);
  process.exit(2);
}

const metrics = measureSources(sources);

writeFileSync(TARGET, toMarkdown(metrics), 'utf8');

console.log(`Отчёт записан: ${path.relative(process.cwd(), TARGET)}`);
console.log(`Файлов: ${metrics.totals.files}, строк: ${metrics.totals.lines}`);
console.log(
  `Сырых контролов: ${metrics.rawControls.reduce((sum, item) => sum + item.count, 0)}, ` +
    `скопированная рамка: ${metrics.frame.count}, ` +
    `максимальная глубина: ${metrics.nesting.deepest}`,
);
