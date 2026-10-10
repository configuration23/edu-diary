import { describe, expect, it } from 'vitest';

import {
  decideOutcome,
  firstLine,
  imageReference,
  isRegistryLimit,
  REQUIRED_IMAGES,
  REGISTRY_HINT,
} from './check-registry-access.mjs';

/**
 * Разбор ответов реестра: проверка отделяет исчерпанный лимит Docker Hub от
 * прочих сбоев. Именно на этом различии строится предполётная проверка в CI,
 * а воспроизвести 429 в тесте нельзя — поэтому логика вынесена в чистые функции.
 */

describe('isRegistryLimit', () => {
  it('узнаёт исчерпанный лимит Docker Hub', () => {
    expect(
      isRegistryLimit('toomanyrequests: You have reached your unauthenticated pull rate limit.'),
    ).toBe(true);
    expect(isRegistryLimit('unexpected status from HEAD request: 429 Too Many Requests')).toBe(
      true,
    );
  });

  it('узнаёт отказ авторизации', () => {
    expect(isRegistryLimit('unauthorized: authentication required')).toBe(true);
    expect(isRegistryLimit('denied: requested access to the resource is denied')).toBe(true);
    expect(isRegistryLimit('unexpected status: 401 Unauthorized')).toBe(true);
    expect(isRegistryLimit('unexpected status: 403 Forbidden')).toBe(true);
  });

  it('не считает лимитом обычные сбои', () => {
    expect(isRegistryLimit('no such manifest: docker.io/library/nginx:нет-такого')).toBe(false);
    expect(isRegistryLimit('dial tcp: lookup registry-1.docker.io: no such host')).toBe(false);
    expect(isRegistryLimit('код 1')).toBe(false);
  });
});

describe('firstLine', () => {
  it('берёт только первую строку ответа', () => {
    expect(firstLine('первая строка\nвторая\nтретья')).toBe('первая строка');
    expect(firstLine('  с отступами  \nмусор')).toBe('с отступами');
  });
});

describe('imageReference', () => {
  it('подставляет зеркало реестра перед именем образа', () => {
    expect(imageReference('postgres:16-alpine')).toBe('postgres:16-alpine');
    expect(imageReference('postgres:16-alpine', 'mirror.example.ru/library/')).toBe(
      'mirror.example.ru/library/postgres:16-alpine',
    );
  });
});

describe('decideOutcome', () => {
  it('лимит реестра — ошибка с подсказкой про секреты', () => {
    const outcome = decideOutcome({
      problems: [{ reference: 'postgres:16-alpine', error: 'toomanyrequests' }],
      unavailable: [],
      strict: false,
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.level).toBe('error');
    expect(outcome.output).toContain('postgres:16-alpine');
    expect(outcome.output).toContain(REGISTRY_HINT);
  });

  it('прочий сбой без strict — предупреждение, сборка продолжается', () => {
    const outcome = decideOutcome({
      problems: [],
      unavailable: [{ reference: 'caddy:2-alpine', error: 'no such host' }],
      strict: false,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.level).toBe('warning');
    expect(outcome.output).toContain('caddy:2-alpine');
  });

  it('прочий сбой со strict — ошибка', () => {
    const outcome = decideOutcome({
      problems: [],
      unavailable: [{ reference: 'caddy:2-alpine', error: 'no such host' }],
      strict: true,
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.level).toBe('error');
  });

  it('всё доступно — успех', () => {
    const outcome = decideOutcome({ problems: [], unavailable: [], strict: true });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.output).toContain('доступны');
  });

  it('проверяет те же образы, что скачивает стек', () => {
    expect(REQUIRED_IMAGES).toEqual([
      'postgres:16-alpine',
      'caddy:2-alpine',
      'nginx:stable-alpine',
    ]);
  });
});
