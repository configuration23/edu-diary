import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ENV_INVALID_MARKER,
  EXAMPLE_SECRET_VALUES,
  EnvError,
  REQUIRED_SECRET_KEYS,
  loadEnv,
} from '../src/shared/env';
import { parseExampleEnv } from './helpers';

const validSource = {
  DATABASE_URL: 'postgres://edu_diary:secret@localhost:5432/edu_diary',
  SESSION_SECRET: 'a'.repeat(48),
  STORAGE_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  NODE_ENV: 'test',
} satisfies NodeJS.ProcessEnv;

function issuesOf(source: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.issues;
    throw error;
  }
  throw new Error('Ожидалась ошибка окружения, но проверка прошла');
}

describe('loadEnv: обязательные секреты', () => {
  it('принимает корректный набор', () => {
    const env = loadEnv(validSource);

    expect(env.databaseUrl).toBe(validSource.DATABASE_URL);
    expect(env.isTest).toBe(true);
    expect(env.port).toBe(3000);
    expect(env.logPretty).toBe(false);
  });

  it('перечисляет все отсутствующие секреты сразу', () => {
    const issues = issuesOf({ NODE_ENV: 'test' });

    expect(issues).toHaveLength(3);
    for (const key of REQUIRED_SECRET_KEYS) {
      expect(issues.some((issue) => issue.startsWith(`${key}: не задана`))).toBe(true);
    }
  });

  it('не стартует со значением-примером из .env.example', () => {
    const issues = issuesOf({
      ...validSource,
      SESSION_SECRET: EXAMPLE_SECRET_VALUES.SESSION_SECRET,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('SESSION_SECRET');
    expect(issues[0]).toContain('совпадает с примером');
  });

  it('не стартует, если примером равно значение любого обязательного секрета', () => {
    for (const key of REQUIRED_SECRET_KEYS) {
      const issues = issuesOf({ ...validSource, [key]: EXAMPLE_SECRET_VALUES[key] });
      expect(issues.some((issue) => issue.includes('совпадает с примером'))).toBe(true);
    }
  });

  it('не показывает значение секрета в сообщении', () => {
    const secret = 'super-secret-value-that-must-not-be-printed-123456';
    const issues = issuesOf({ ...validSource, SESSION_SECRET: secret.slice(0, 20) });

    expect(issues.join('\n')).not.toContain(secret);
  });
});

describe('loadEnv: форматы значений', () => {
  it('требует схему postgres в DATABASE_URL', () => {
    const issues = issuesOf({ ...validSource, DATABASE_URL: 'mysql://localhost:3306/edu' });
    expect(issues.some((issue) => issue.startsWith('DATABASE_URL:'))).toBe(true);
  });

  it('требует не короче 32 символов в SESSION_SECRET', () => {
    const issues = issuesOf({ ...validSource, SESSION_SECRET: 'short' });
    expect(issues.some((issue) => issue.includes('минимум 32 символа'))).toBe(true);
  });

  it('принимает ключ шифрования в hex на 64 символа', () => {
    const env = loadEnv({ ...validSource, STORAGE_ENCRYPTION_KEY: 'ab'.repeat(32) });
    expect(env.storageEncryptionKey).toBe('ab'.repeat(32));
  });

  it('отвергает ключ шифрования не на 32 байта', () => {
    const issues = issuesOf({
      ...validSource,
      STORAGE_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
    });
    expect(issues.some((issue) => issue.includes('32 байта'))).toBe(true);
  });

  it('отвергает неизвестный NODE_ENV и нечисловой PORT', () => {
    const issues = issuesOf({ ...validSource, NODE_ENV: 'staging', PORT: 'семь' });

    expect(issues.some((issue) => issue.startsWith('NODE_ENV:'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('PORT:'))).toBe(true);
  });

  it('включает читаемые логи вне production и выключает их в production', () => {
    expect(loadEnv({ ...validSource, NODE_ENV: 'development' }).logPretty).toBe(true);
    expect(loadEnv({ ...validSource, NODE_ENV: 'production' }).logPretty).toBe(false);
  });
});

describe('EnvError', () => {
  it('содержит стабильный маркер для скриптов и мониторинга', () => {
    const error = new EnvError(['X: не задана']);
    expect(error.message).toContain(ENV_INVALID_MARKER);
    expect(error.issues).toEqual(['X: не задана']);
  });
});

describe('.env.example', () => {
  const example = parseExampleEnv(
    readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'),
  );

  it('содержит примеры всех обязательных секретов', () => {
    for (const key of REQUIRED_SECRET_KEYS) {
      expect(example[key], `в .env.example нет ${key}`).toBeDefined();
    }
  });

  it('примеры совпадают со значениями, которые распознаёт приложение', () => {
    for (const key of REQUIRED_SECRET_KEYS) {
      expect(example[key], `значение ${key} в .env.example разошлось с EXAMPLE_SECRET_VALUES`).toBe(
        EXAMPLE_SECRET_VALUES[key],
      );
    }
  });

  it('примеры не проходят проверку окружения', () => {
    const issues = issuesOf({
      DATABASE_URL: example.DATABASE_URL ?? '',
      SESSION_SECRET: example.SESSION_SECRET ?? '',
      STORAGE_ENCRYPTION_KEY: example.STORAGE_ENCRYPTION_KEY ?? '',
    });

    expect(issues).toHaveLength(3);
  });
});
