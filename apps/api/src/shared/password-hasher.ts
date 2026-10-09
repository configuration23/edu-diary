import { hash, verify } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';

/**
 * Хеширование паролей — argon2id (SECURITY.md §3.1).
 *
 * Параметры соответствуют рекомендации OWASP: 19 МиБ памяти, 2 прохода.
 * `verifyDummy` нужен, чтобы ответ при неизвестном логине занимал столько же
 * времени, сколько при неверном пароле: иначе по времени ответа можно узнать,
 * существует ли учётная запись.
 */

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hashValue: string, plain: string): Promise<boolean>;
  verifyDummy(plain: string): Promise<void>;
}

/**
 * Значение `Algorithm.Argon2id` из @node-rs/argon2.
 *
 * Библиотека объявляет его как ambient const enum, который недоступен при
 * `isolatedModules`, поэтому числовое значение зафиксировано здесь с проверкой
 * в тесте.
 */
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function createPasswordHasher(): PasswordHasher {
  let dummyHash: string | null = null;

  const ensureDummyHash = async (): Promise<string> => {
    dummyHash ??= await hash(randomUUID(), ARGON2_OPTIONS);
    return dummyHash;
  };

  return {
    hash(plain: string): Promise<string> {
      return hash(plain, ARGON2_OPTIONS);
    },

    async verify(hashValue: string, plain: string): Promise<boolean> {
      try {
        return await verify(hashValue, plain, ARGON2_OPTIONS);
      } catch {
        return false;
      }
    },

    async verifyDummy(plain: string): Promise<void> {
      try {
        await verify(await ensureDummyHash(), plain, ARGON2_OPTIONS);
      } catch {
        // Проверка нужна только ради времени ответа.
      }
    },
  };
}
