import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Симметричное шифрование секретов настроек (`ARCHITECTURE.md` §7).
 *
 * Ключи доступа к S3 лежат в базе настроек, то есть в открытом виде попали бы в дамп и в
 * бэкап. Поэтому шифруем их ключом из переменных окружения: дампа базы недостаточно,
 * чтобы добраться до хранилища.
 *
 * Формат: `v1:<iv base64>:<tag base64>:<данные base64>`. Версия в начале — чтобы способ
 * шифрования можно было сменить, не разбирая старые записи наугад.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/** Ключ шифрования: 32 байта в base64 или 64 hex-символа. */
function keyOf(secret: string): Buffer {
  const trimmed = secret.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');

  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === 32) return decoded;

  /**
   * Из строки произвольной длины делаем ключ хешем: требовать строго 32 байта неудобно, а
   * предсказуемость важнее — иначе настройки, зашифрованные с одним ключом, не прочитаются
   * после перезапуска.
   */
  return createHash('sha256').update(trimmed, 'utf8').digest();
}

export function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyOf(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Расшифровать секрет.
 *
 * Возвращаем `null`, а не исключение: настройка может быть испорчена или зашифрована
 * другим ключом (например, ключ окружения сменили). Это не повод падать всему
 * приложению — хранилище просто останется ненастроенным, и администратор задаст ключи
 * заново.
 */
export function decryptSecret(payload: string, secret: string): string | null {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const iv = Buffer.from(parts[1] ?? '', 'base64');
    const tag = Buffer.from(parts[2] ?? '', 'base64');
    const data = Buffer.from(parts[3] ?? '', 'base64');

    const decipher = createDecipheriv(ALGORITHM, keyOf(secret), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Зашифровано ли значение: по префиксу видно, нужна ли расшифровка. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`);
}
