import { AppError } from '../errors';

/**
 * Ошибки PostgreSQL, которые нужно превратить в понятный отказ API.
 *
 * Проверки в сервисах дают осмысленное сообщение заранее, но БД остаётся
 * последней линией защиты: уникальные имена, `on delete restrict` и составные
 * ключи ловят то, что не удалось предвидеть. Без этого перевода нарушение
 * ограничения выглядело бы как «Внутренняя ошибка сервера».
 *
 * Drizzle оборачивает ошибку драйвера в `DrizzleQueryError` и кладёт исходную в
 * `cause`, поэтому код ограничения ищется по цепочке причин (проверено на
 * реальном драйвере: `code = 23505`, `constraint_name = ...` лежат в `cause`).
 */

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const NOT_NULL_VIOLATION = '23502';
const CHECK_VIOLATION = '23514';

/** Насколько глубоко разворачиваем `cause`: больше двух уровней не встречается. */
const MAX_CAUSE_DEPTH = 4;

interface PostgresErrorLike {
  code?: unknown;
  constraint_name?: unknown;
  constraint?: unknown;
  detail?: unknown;
  cause?: unknown;
}

function asPostgresError(error: unknown): PostgresErrorLike | null {
  if (typeof error !== 'object' || error === null) return null;
  return error as PostgresErrorLike;
}

/** Ищет ошибку с кодом PostgreSQL по цепочке `cause`. */
function findPostgresError(error: unknown): PostgresErrorLike | null {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const candidate = asPostgresError(current);
    if (candidate === null) return null;
    if (typeof candidate.code === 'string') return candidate;
    if (candidate.cause === undefined) return null;
    current = candidate.cause;
  }

  return null;
}

function constraintName(error: PostgresErrorLike): string | null {
  const value = error.constraint_name ?? error.constraint;
  return typeof value === 'string' ? value : null;
}

/** Нарушено ли конкретное ограничение (по коду и, если нужно, по имени). */
export function isDatabaseConstraintError(
  error: unknown,
  kind: 'unique' | 'foreign_key',
  constraint?: string,
): boolean {
  const postgres = findPostgresError(error);
  if (postgres === null) return false;

  const expected = kind === 'unique' ? UNIQUE_VIOLATION : FOREIGN_KEY_VIOLATION;
  if (postgres.code !== expected) return false;

  if (constraint === undefined) return true;
  return constraintName(postgres)?.includes(constraint) ?? false;
}

/**
 * Превращает нарушение ограничения БД в `AppError`.
 *
 * Ошибки другого вида возвращаются как есть: неизвестное не маскируем.
 */
export function toDatabaseAppError(
  error: unknown,
  messages: {
    unique?: string;
    foreignKey?: string;
    details?: unknown;
  },
): unknown {
  const postgres = findPostgresError(error);
  if (postgres === null) return error;

  const options = {
    cause: error,
    ...(messages.details === undefined ? {} : { details: messages.details }),
  };

  if (postgres.code === UNIQUE_VIOLATION && messages.unique !== undefined) {
    return new AppError('CONFLICT', messages.unique, options);
  }

  if (postgres.code === FOREIGN_KEY_VIOLATION && messages.foreignKey !== undefined) {
    return new AppError('CONFLICT', messages.foreignKey, options);
  }

  const fallback = messages.unique ?? messages.foreignKey;
  if (
    (postgres.code === NOT_NULL_VIOLATION || postgres.code === CHECK_VIOLATION) &&
    fallback !== undefined
  ) {
    return new AppError('VALIDATION_FAILED', fallback, options);
  }

  return error;
}

/** Выполняет операцию и переводит нарушение ограничения в понятную ошибку. */
export async function withDatabaseErrors<T>(
  operation: () => Promise<T>,
  messages: { unique?: string; foreignKey?: string; details?: unknown },
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toDatabaseAppError(error, messages);
  }
}
