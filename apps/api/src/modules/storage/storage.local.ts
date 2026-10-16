import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { PutObjectInput, StorageAdapter, StoredObject } from './storage.adapter';

/**
 * Локальное хранилище: каталог на диске, смонтированный томом.
 *
 * Вариант по умолчанию (решение владельца): ничего дополнительно поднимать не нужно. Важно,
 * чтобы каталог был **вне контейнера приложения** — иначе файлы исчезнут вместе с
 * контейнером при обновлении (`ARCHITECTURE.md` §7).
 *
 * Защита от выхода за каталог: ключ проверяется так, чтобы `../` и абсолютные пути не
 * сработали, даже если он попадёт сюда не из `objectKey`.
 */
export function createLocalStorage(rootPath: string): StorageAdapter {
  const root = resolve(rootPath);

  /**
   * Полный путь к объекту или отказ.
   *
   * Проверяем **после** нормализации: ключ собирается из UUID, но полагаться на это
   * нельзя — цена ошибки здесь слишком высока (чтение или запись произвольного файла).
   *
   * Разделитель не берём из платформы: `resolve` на Windows возвращает `\`, на Linux —
   * `/`, и проверка, написанная под одну систему, пропускала бы выход из каталога на
   * другой. Достаточно убедиться, что следующий символ — разделитель в любом виде.
   */
  function pathOf(key: string): string {
    const full = resolve(join(root, key));

    if (full !== root && !/^[\\/]/.test(full.slice(root.length))) {
      throw new Error(`Ключ объекта вне хранилища: ${key}`);
    }

    return full;
  }

  return {
    kind: 'local',

    async put(input: PutObjectInput): Promise<void> {
      const full = pathOf(input.key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, input.body);
    },

    async get(key: string): Promise<StoredObject | null> {
      try {
        const body = await readFile(pathOf(key));
        return { key, body, mimeType: 'application/octet-stream' };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async remove(key: string): Promise<void> {
      await rm(pathOf(key), { force: true });
    },

    async health(): Promise<{ ok: boolean; detail: string | null }> {
      try {
        await mkdir(root, { recursive: true });
        return { ok: true, detail: root };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
