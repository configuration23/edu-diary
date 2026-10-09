import { randomBytes } from 'node:crypto';

/**
 * Идентификаторы — UUID v7 (ADR-015): сортируемые по времени создания и
 * неугадываемые. В первой версии проекта идентификаторы вида `s-1` позволяли
 * перебором запрашивать чужие данные.
 *
 * В Postgres 16 нет встроенной функции uuidv7(), поэтому значение создаётся в
 * приложении и подставляется через `$defaultFn` в схемах Drizzle.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);

  // 48 бит времени в миллисекундах — старшие байты идентификатора.
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // версия 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // вариант RFC 4122

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
