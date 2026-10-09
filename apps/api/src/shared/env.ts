/**
 * Переменные окружения и проверка обязательных секретов (SECURITY.md §3.2).
 *
 * Приложение отказывается стартовать, если секрет не задан или равен значению
 * из `.env.example`. Значения секретов никогда не попадают в сообщение об
 * ошибке — только имена переменных и причина.
 */

export const REQUIRED_SECRET_KEYS = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'STORAGE_ENCRYPTION_KEY',
] as const;

/** Стабильный маркер в выводе: по нему скрипты и мониторинг отличают отказ старта. */
export const ENV_INVALID_MARKER = 'ENV_INVALID';

export type RequiredSecretKey = (typeof REQUIRED_SECRET_KEYS)[number];

/**
 * Значения-примеры, при которых приложение обязано упасть.
 *
 * Это единственный источник правды: тест `env.test.ts` проверяет, что в
 * `.env.example` для обязательных секретов указаны ровно эти значения.
 */
export const EXAMPLE_SECRET_VALUES: Readonly<Record<RequiredSecretKey, string>> = {
  DATABASE_URL: 'postgres://edu_diary:change-me-postgres-password@localhost:5432/edu_diary',
  SESSION_SECRET: 'change-me-session-secret-with-more-than-32-characters',
  STORAGE_ENCRYPTION_KEY: 'change-me-storage-encryption-key-32-bytes=',
};

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const NODE_ENVS = ['development', 'test', 'production'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type NodeEnv = (typeof NODE_ENVS)[number];

export interface AppEnv {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  isTest: boolean;
  host: string;
  port: number;
  logLevel: LogLevel;
  logPretty: boolean;
  /** Строка подключения к PostgreSQL. */
  databaseUrl: string;
  /** Секрет подписи сессий. */
  sessionSecret: string;
  /** Ключ шифрования секретов в БД: 32 байта в base64 или 64 hex-символа. */
  storageEncryptionKey: string;
  /** Строка подключения для интеграционных тестов; вне тестов не используется. */
  testDatabaseUrl: string | null;
}

export class EnvError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      [`${ENV_INVALID_MARKER}: приложение не может стартовать — исправьте переменные окружения`]
        .concat(issues.map((issue) => `  - ${issue}`))
        .join('\n'),
    );
    this.name = 'EnvError';
    this.issues = issues;
  }
}

function readValue(source: NodeJS.ProcessEnv, key: string): string | null {
  const raw = source[key];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

function decodeStorageEncryptionKey(value: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex');
  }

  if (value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32) return decoded;
  }

  return null;
}

function parseInteger(value: string, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

/**
 * Читает и проверяет окружение. Бросает `EnvError` со списком всех проблем
 * сразу, чтобы не запускать приложение по одной ошибке за раз.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const issues: string[] = [];

  const secrets = {
    DATABASE_URL: readValue(source, 'DATABASE_URL'),
    SESSION_SECRET: readValue(source, 'SESSION_SECRET'),
    STORAGE_ENCRYPTION_KEY: readValue(source, 'STORAGE_ENCRYPTION_KEY'),
  } satisfies Record<RequiredSecretKey, string | null>;

  for (const key of REQUIRED_SECRET_KEYS) {
    const value = secrets[key];
    if (value === null) {
      issues.push(`${key}: не задана (пример в .env.example, генерация — npm run bootstrap:env)`);
      continue;
    }
    if (value === EXAMPLE_SECRET_VALUES[key]) {
      // Значение-пример не проверяем на формат: суть проблемы именно в том, что
      // его не заменили, и одно сообщение понятнее двух.
      issues.push(
        `${key}: значение совпадает с примером из .env.example — задайте настоящее значение (npm run bootstrap:env)`,
      );
      continue;
    }
    if (key === 'DATABASE_URL' && !/^postgres(ql)?:\/\/\S+$/.test(value)) {
      issues.push(
        'DATABASE_URL: ожидается строка вида postgres://пользователь:пароль@хост:порт/база',
      );
    }
    if (key === 'SESSION_SECRET' && value.length < 32) {
      issues.push(
        `SESSION_SECRET: минимум 32 символа, сейчас ${value.length} (сгенерировать — npm run bootstrap:env)`,
      );
    }
    if (key === 'STORAGE_ENCRYPTION_KEY' && decodeStorageEncryptionKey(value) === null) {
      issues.push(
        'STORAGE_ENCRYPTION_KEY: нужен ключ ровно на 32 байта — base64 (44 символа) или 64 hex-символа',
      );
    }
  }

  const nodeEnvRaw = readValue(source, 'NODE_ENV') ?? 'development';
  const nodeEnv = (NODE_ENVS as readonly string[]).includes(nodeEnvRaw)
    ? (nodeEnvRaw as NodeEnv)
    : null;
  if (nodeEnv === null) {
    issues.push(`NODE_ENV: допустимы ${NODE_ENVS.join(', ')}, получено «${nodeEnvRaw}»`);
  }

  const portRaw = readValue(source, 'PORT') ?? '3000';
  const port = parseInteger(portRaw, 1, 65535);
  if (port === null) {
    issues.push(`PORT: ожидается целое число от 1 до 65535, получено «${portRaw}»`);
  }

  const logLevelRaw = readValue(source, 'LOG_LEVEL') ?? 'info';
  const logLevel = (LOG_LEVELS as readonly string[]).includes(logLevelRaw)
    ? (logLevelRaw as LogLevel)
    : null;
  if (logLevel === null) {
    issues.push(`LOG_LEVEL: допустимы ${LOG_LEVELS.join(', ')}, получено «${logLevelRaw}»`);
  }

  const resolvedNodeEnv = nodeEnv ?? 'development';
  const logPrettyRaw = readValue(source, 'LOG_PRETTY');
  // Читаемые логи — удобство локальной разработки; в test и production только JSON.
  const logPretty =
    logPrettyRaw === null ? resolvedNodeEnv === 'development' : logPrettyRaw === 'true';

  if (issues.length > 0) {
    throw new EnvError(issues);
  }

  return {
    nodeEnv: resolvedNodeEnv,
    isProduction: resolvedNodeEnv === 'production',
    isTest: resolvedNodeEnv === 'test',
    host: readValue(source, 'HOST') ?? '0.0.0.0',
    port: port ?? 3000,
    logLevel: logLevel ?? 'info',
    logPretty,
    databaseUrl: secrets.DATABASE_URL ?? '',
    sessionSecret: secrets.SESSION_SECRET ?? '',
    storageEncryptionKey: secrets.STORAGE_ENCRYPTION_KEY ?? '',
    testDatabaseUrl: readValue(source, 'TEST_DATABASE_URL'),
  };
}

/**
 * Подхватывает `.env` для локального запуска. В контейнере переменные приходят
 * от compose, и отсутствие файла — норма.
 */
export function loadEnvFile(filePath: string): boolean {
  try {
    process.loadEnvFile(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
