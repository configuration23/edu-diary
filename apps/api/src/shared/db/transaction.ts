import type { Database, Executor } from './client';

/**
 * Выполняет операцию в транзакции.
 *
 * Если исполнитель уже передан (операция — часть более крупной транзакции,
 * например мастер настройки), новая транзакция не открывается. Иначе изменение
 * и запись в аудит происходят вместе (ADR-012).
 */
export function withTransaction<T>(
  db: Database,
  executor: Executor | undefined,
  operation: (executor: Executor) => Promise<T>,
): Promise<T> {
  return executor === undefined ? db.transaction(operation) : operation(executor);
}
