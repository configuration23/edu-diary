#!/usr/bin/env node
// Проверка сборки клиента на внешние домены. Падает с кодом 1 — ломает сборку.
import { existsSync } from 'node:fs';
import path from 'node:path';

import { scanBundle } from './bundle-domains.mjs';

const target = process.argv[2];

if (target === undefined) {
  console.error('Укажите каталог сборки: node tools/quality/check-bundle-domains.mjs <dist>');
  process.exit(2);
}

const directory = path.resolve(target);

if (!existsSync(directory)) {
  console.error(`Каталог сборки не найден: ${directory}. Сначала выполните npm run build.`);
  process.exit(2);
}

const { failures, allowed } = scanBundle(directory);

for (const item of allowed) {
  console.log(`Разрешено (не загружается): ${path.basename(item.file)} → ${item.url}`);
}

if (failures.length === 0) {
  console.log(`Внешних доменов в сборке нет (проверено: ${directory})`);
  process.exit(0);
}

console.error(`Найдены внешние адреса в сборке — ${failures.length}:`);
for (const item of failures) {
  console.error(`  ${path.basename(item.file)} → ${item.url}`);
}
console.error('Клиент не должен обращаться к внешним сервисам: docs/SECURITY.md §3.8.');
console.error(
  'Если адрес — часть текста сообщения зависимости (документация, ссылка на баг), добавьте хост в NON_LOADING_HOSTS с пояснением. Если это загрузка ресурса — правило нарушено, адрес нужно убрать.',
);
process.exit(1);
