import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkFiles, checkProject, RULES } from './architecture.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function file(relativePath, source) {
  return { path: path.join(repositoryRoot, relativePath), source };
}

function rulesOf(violations) {
  return violations.map((item) => item.rule);
}

describe('запрет импортов между модулями', () => {
  it('падает на обращении к внутреннему файлу чужого модуля', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('apps/api/src/modules/alpha/index.ts', 'export const alpha = 1;'),
        file('apps/api/src/modules/beta/index.ts', "import { alpha } from '../alpha';"),
        file(
          'apps/api/src/modules/beta/beta.service.ts',
          "import { alpha } from '../alpha/alpha.service';",
        ),
      ],
    });

    expect(rulesOf(violations)).toEqual([RULES.moduleBoundary]);
    expect(violations[0]?.file).toBe('apps/api/src/modules/beta/beta.service.ts');
    expect(violations[0]?.message).toContain("используйте '../alpha'");
  });

  it('пропускает обращение через публичный вход и к своему модулю', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('apps/api/src/modules/alpha/index.ts', 'export const alpha = 1;'),
        file('apps/api/src/modules/beta/index.ts', "import { alpha } from '../alpha';"),
        file(
          'apps/api/src/modules/beta/beta.service.ts',
          "export const beta = 2;\nimport { alpha } from '../alpha';",
        ),
        file(
          'apps/api/src/modules/beta/beta.repository.ts',
          "import { beta } from './beta.service';",
        ),
      ],
    });

    expect(violations).toEqual([]);
  });

  it('пропускает импорт из shared, но запрещает shared → модуль', () => {
    const allowed = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('apps/api/src/shared/errors.ts', 'export class AppError {}'),
        file(
          'apps/api/src/modules/alpha/index.ts',
          "import { AppError } from '../../shared/errors';",
        ),
      ],
    });
    expect(allowed).toEqual([]);

    const forbidden = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('apps/api/src/shared/errors.ts', "import { alpha } from '../modules/alpha';"),
        file('apps/api/src/modules/alpha/index.ts', 'export const alpha = 1;'),
      ],
    });
    expect(rulesOf(forbidden)).toEqual([RULES.moduleBoundary]);
  });

  it('требует публичный вход index.ts у каждого модуля', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [file('apps/api/src/modules/alpha/alpha.service.ts', 'export const alpha = 1;')],
    });

    expect(rulesOf(violations)).toEqual([RULES.modulePublicEntry]);
    expect(violations[0]?.file).toBe('apps/api/src/modules/alpha/index.ts');
  });

  it('допускает композицию модулей в корне приложения', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('apps/api/src/app.ts', "import { alpha } from './modules/alpha';"),
        file('apps/api/src/modules/alpha/index.ts', 'export const alpha = 1;'),
      ],
    });

    expect(violations).toEqual([]);
  });
});

describe('SQL только в репозиториях', () => {
  it('падает на SQL в сервисе и роуте', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('apps/api/src/modules/alpha/index.ts', 'export const alpha = 1;'),
        file('apps/api/src/modules/alpha/alpha.service.ts', "import { eq } from 'drizzle-orm';"),
        file('apps/api/src/modules/alpha/alpha.routes.ts', "import postgres from 'postgres';"),
      ],
    });

    expect(rulesOf(violations)).toEqual([RULES.sqlLocation, RULES.sqlLocation]);
  });

  it('разрешает SQL в репозитории, схеме и shared/db', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('apps/api/src/modules/alpha/index.ts', 'export const alpha = 1;'),
        file('apps/api/src/modules/alpha/alpha.repository.ts', "import { eq } from 'drizzle-orm';"),
        file(
          'apps/api/src/modules/alpha/alpha.schema.ts',
          "import { pgTable } from 'drizzle-orm/pg-core';",
        ),
        file('apps/api/src/shared/db/client.ts', "import postgres from 'postgres';"),
      ],
    });

    expect(violations).toEqual([]);
  });
});

describe('слои пакетов и приложений', () => {
  it('запрещает packages/* зависеть от приложений и от чужих пакетов', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('packages/domain/src/index.ts', "import { api } from '../../../apps/api/src/app';"),
        file('packages/domain/src/date.ts', "import { z } from 'zod';"),
      ],
    });

    expect(rulesOf(violations)).toEqual([RULES.packageLayering, RULES.packageLayering]);
  });

  it('разрешает contracts использовать zod', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [file('packages/contracts/src/health.ts', "import { z } from 'zod';")],
    });

    expect(violations).toEqual([]);
  });

  it('разрешает contracts переиспользовать чистую логику domain', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('packages/contracts/src/common.ts', "import { isISODate } from '@edu-diary/domain';"),
      ],
    });

    expect(violations).toEqual([]);
  });

  it('запрещает domain зависеть от zod и от contracts', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('packages/domain/src/date.ts', "import { z } from 'zod';"),
        file(
          'packages/domain/src/index.ts',
          "import { healthResponseSchema } from '@edu-diary/contracts';",
        ),
      ],
    });

    expect(rulesOf(violations)).toEqual([RULES.packageLayering, RULES.packageLayering]);
  });

  it('запрещает фронтенду импортировать бэкенд', () => {
    const violations = checkFiles({
      repoRoot: repositoryRoot,
      files: [
        file('apps/api/src/modules/alpha/index.ts', 'export const alpha = 1;'),
        file('apps/web/src/App.tsx', "import { alpha } from '../../api/src/modules/alpha';"),
      ],
    });

    expect(rulesOf(violations)).toEqual([RULES.appBoundary]);
  });
});

describe('проверка самого проекта', () => {
  it('в текущем дереве нарушений нет', () => {
    const { violations, checkedFiles } = checkProject(repositoryRoot);

    expect(checkedFiles).toBeGreaterThan(10);
    expect(violations.map((item) => `${item.file}: ${item.message}`)).toEqual([]);
  });
});
