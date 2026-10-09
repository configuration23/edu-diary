// Сборка API одним проходом esbuild: исходники пакетов и модулей бандлятся,
// внешние зависимости остаются в node_modules (их ставит runtime-образ).
// Схема опробована и зафиксирована в docs/DECISIONS.md (ADR-023).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(apiRoot, 'package.json'), 'utf8'));

/** Внешними остаются все зависимости, кроме пакетов самого монорепозитория. */
const external = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
]
  .filter((name) => !name.startsWith('@edu-diary/'))
  .sort();

await build({
  absWorkingDir: apiRoot,
  entryPoints: {
    main: 'src/main.ts',
    migrate: 'src/migrate.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
});
