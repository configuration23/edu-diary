// Предполётная проверка внешних образов перед сборкой стека.
//
// Зачем: GitHub-hosted раннеры ходят в Docker Hub анонимно и с общих IP, поэтому
// скачивание упирается в лимит (`toomanyrequests`, `429 Too Many Requests`).
// Раньше это выяснялось глубоко внутри `docker compose up` или при инициализации
// сервисных контейнеров — с невнятным «exit code 1» и после сборки образов.
// Здесь мы проверяем ровно то, что реально скачивается, и объясняем причину.
//
// Запуск: npm run check:registry (node tools/quality/check-registry-access.mjs)
// Переменные:
//   STRICT_REGISTRY_CHECK=1 — любой недоступный образ считается ошибкой
//                             (для машин, у которых нет кеша образов);
//   DOCKER_REGISTRY         — префикс реестра (зеркало), как в docker-compose.yml.
//
// Проверка не тянет слои: `docker manifest inspect` только запрашивает манифест,
// поэтому расход лимита минимален. Разбор ответов вынесен в чистые функции —
// их проверяет `check-registry-access.test.mjs` без Docker и без сети.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Образы, которые скачиваются с внешнего реестра. `api`, `web` и `migrate`
 * собираются из этого репозитория и сюда не входят. Список повторяет
 * `docker-compose.yml` и `.github/workflows/ci.yml` (сервис postgres для e2e).
 */
export const REQUIRED_IMAGES = ['postgres:16-alpine', 'caddy:2-alpine', 'nginx:stable-alpine'];

export const REGISTRY_HINT =
  'Анонимный лимит Docker Hub исчерпан: IP у GitHub-hosted раннеров общий. ' +
  'Задайте секреты репозитория DOCKERHUB_USERNAME и DOCKERHUB_TOKEN ' +
  '(access token только на чтение) — тогда лимит считается по учётной записи. ' +
  'Либо укажите зеркало реестра: DOCKER_REGISTRY в .env.';

/** Лимит реестра или отказ авторизации — то, что не «рассосётся» само. */
export function isRegistryLimit(message) {
  return /toomanyrequests|too many requests|429|unauthorized|denied|\b401\b|\b403\b/i.test(message);
}

/** Первая строка сообщения: остальное — многострочный JSON от реестра. */
export function firstLine(value) {
  return value.split('\n')[0].trim();
}

/** Строит ссылку на образ с учётом зеркала реестра. */
export function imageReference(image, registryPrefix = '') {
  return `${registryPrefix}${image}`;
}

/**
 * Решение по результатам проверки.
 *
 * `problems` — отказы реестра (лимит, авторизация): это ошибка всегда.
 * `unavailable` — прочие сбои (нет сети, нет образа): предупреждение, потому
 * что образ может быть в локальном кеше; при `strict` — тоже ошибка.
 */
export function decideOutcome({ problems, unavailable, strict }) {
  if (problems.length > 0) {
    const lines = problems.map((item) => `  - ${item.reference}: ${firstLine(item.error)}`);
    return {
      exitCode: 1,
      output: ['Реестр отказывает в скачивании образов:', ...lines, '', REGISTRY_HINT].join('\n'),
      level: 'error',
    };
  }

  if (unavailable.length > 0 && strict) {
    return {
      exitCode: 1,
      output: `Образы недоступны, а STRICT_REGISTRY_CHECK=1:\n${unavailable
        .map((item) => `  - ${item.reference}: ${firstLine(item.error)}`)
        .join('\n')}`,
      level: 'error',
    };
  }

  if (unavailable.length > 0) {
    return {
      exitCode: 0,
      output:
        'Внимание: манифесты не получены, но это не похоже на лимит реестра. ' +
        'Если образов нет в локальном кеше, скачивание может не удаться:\n' +
        unavailable.map((item) => `  - ${item.reference}: ${firstLine(item.error)}`).join('\n'),
      level: 'warning',
    };
  }

  return { exitCode: 0, output: 'Внешние образы доступны.', level: 'info' };
}

/** Запрашивает манифест и возвращает текст ошибки либо null при успехе. */
function inspectManifest(reference) {
  const result = spawnSync('docker', ['manifest', 'inspect', reference], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) return null;

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return output === '' ? `код ${result.status ?? 'неизвестен'}` : output;
}

function main() {
  const strict = process.env.STRICT_REGISTRY_CHECK === '1';
  const prefix = process.env.DOCKER_REGISTRY ?? '';
  const references = [...new Set(REQUIRED_IMAGES.map((image) => imageReference(image, prefix)))];

  console.log(`Проверка доступа к реестру (strict=${strict ? 'да' : 'нет'})`);

  const problems = [];
  const unavailable = [];

  for (const reference of references) {
    const error = inspectManifest(reference);

    if (error === null) {
      console.log(`  ok    ${reference}`);
      continue;
    }

    const limit = isRegistryLimit(error);
    console.log(`  ${limit ? 'лимит' : 'нет'}  ${reference} — ${firstLine(error)}`);

    if (limit) problems.push({ reference, error });
    else unavailable.push({ reference, error });
  }

  const outcome = decideOutcome({ problems, unavailable, strict });
  const write = outcome.level === 'error' ? console.error : console.log;
  write(`\n${outcome.output}`);

  process.exit(outcome.exitCode);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) main();
