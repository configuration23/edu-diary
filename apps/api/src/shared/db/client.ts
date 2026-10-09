import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

/**
 * Подключение к PostgreSQL (ADR-002).
 *
 * Схема Drizzle передаётся при запросах явно (`db.orm.select().from(table)`),
 * поэтому тип базы не зависит от общего агрегата схемы: модули не обязаны
 * «светить» свои таблицы наружу.
 */

export interface DatabasePing {
  ok: boolean;
  latencyMs: number | null;
  message?: string;
}

export interface PingOptions {
  timeoutMs?: number;
}

export interface Database {
  readonly sql: Sql;
  readonly orm: PostgresJsDatabase<Record<string, never>>;
  /** Проверка соединения для healthcheck: ошибки не бросаются, а возвращаются. */
  ping(options?: PingOptions): Promise<DatabasePing>;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  /** Размер пула. Для миграций достаточно 1. */
  max?: number;
  /** Таймаут установки соединения, секунды. */
  connectTimeoutSeconds?: number;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

async function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`превышен таймаут ${timeoutMs} мс`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createDatabase(databaseUrl: string, options: CreateDatabaseOptions = {}): Database {
  const sql = postgres(databaseUrl, {
    max: options.max ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    idle_timeout: 30,
    onnotice: () => {},
  });

  const orm = drizzle(sql);

  return {
    sql,
    orm,

    async ping({ timeoutMs = 2000 }: PingOptions = {}): Promise<DatabasePing> {
      const startedAt = performance.now();

      try {
        await withTimeout(sql`select 1`, timeoutMs);
        return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
      } catch (error) {
        return { ok: false, latencyMs: null, message: describeError(error) };
      }
    },

    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}
