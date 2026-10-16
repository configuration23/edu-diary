import { z } from 'zod';

/**
 * Настройки хранилища файлов (Этап 5).
 *
 * Это **системные** настройки: адрес хранилища и ключи доступа к нему. Правит их только
 * администратор — директору видеть их незачем, и разделение «бизнес и системные настройки»
 * записано в `BACKLOG.md` отдельной задачей.
 *
 * Ключи доступа **не возвращаются** в открытом виде: в ответе только признак «задан». Иначе
 * сохранённый пароль уходил бы в браузер, в кэш и в историю.
 */

export const storageSettingsSchema = z.object({
  /** `local` — каталог на диске, `s3` — внешнее хранилище. */
  provider: z.string(),
  localPath: z.string().nullable(),
  endpoint: z.string().nullable(),
  bucket: z.string().nullable(),
  region: z.string().nullable(),
  /** Ключ задан: само значение не показываем. */
  accessKeySet: z.boolean(),
  secretKeySet: z.boolean(),
  /** Предельный размер файла в мегабайтах (диапазон 1–50 проверяет сервер). */
  maxFileMb: z.number().int(),
  /** Белый список расширений строкой через запятую; `null` — значения по умолчанию. */
  allowedTypes: z.string().nullable(),
});
export type StorageSettingsDto = z.infer<typeof storageSettingsSchema>;

export const updateStorageSettingsRequestSchema = z.object({
  provider: z.enum(['local', 's3']).optional(),
  localPath: z.string().max(500).optional(),
  endpoint: z.string().max(500).optional(),
  bucket: z.string().max(200).optional(),
  region: z.string().max(100).optional(),
  /** Пустая строка означает «не менять»: иначе сохранение формы стёрло бы пароль. */
  accessKey: z.string().max(500).optional(),
  secretKey: z.string().max(500).optional(),
  maxFileMb: z.number().int().min(1).max(50).optional(),
  allowedTypes: z.string().max(2000).optional(),
});
export type UpdateStorageSettingsRequest = z.infer<typeof updateStorageSettingsRequestSchema>;

/** Результат проверки подключения: администратору нужен факт, а не догадка. */
export const storageTestResultSchema = z.object({
  ok: z.boolean(),
  /** Шаг, на котором остановились: до него всё работало. */
  step: z.enum(['health', 'write', 'read', 'remove', 'done']),
  message: z.string(),
  /** Что делать: администратор читает именно эту строку, когда файлы не грузятся. */
  hint: z.string(),
  detail: z.string().nullable(),
  /** Что проверили: «локальный каталог» или «внешнее хранилище (S3)». */
  checked: z.string(),
});
export type StorageTestResultDto = z.infer<typeof storageTestResultSchema>;
