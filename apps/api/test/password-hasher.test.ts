import { describe, expect, it } from 'vitest';

import { createPasswordHasher } from '../src/shared/password-hasher';

describe('хеширование паролей', () => {
  const hasher = createPasswordHasher();

  it('создаёт argon2id-хеш и проверяет пароль', async () => {
    const hash = await hasher.hash('tihiy-les-2025');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(hasher.verify(hash, 'tihiy-les-2025')).resolves.toBe(true);
  });

  it('не принимает неверный пароль', async () => {
    const hash = await hasher.hash('tihiy-les-2025');
    await expect(hasher.verify(hash, 'drugoi-parol-2025')).resolves.toBe(false);
  });

  it('не падает на повреждённом хеше', async () => {
    await expect(hasher.verify('не-хеш', 'parol')).resolves.toBe(false);
    await expect(hasher.verify('', 'parol')).resolves.toBe(false);
  });

  it('даёт разные хеши для одного пароля (соль)', async () => {
    const first = await hasher.hash('tihiy-les-2025');
    const second = await hasher.hash('tihiy-les-2025');

    expect(first).not.toBe(second);
  });

  it('проверка-заглушка завершается без ошибок', async () => {
    await expect(hasher.verifyDummy('lyuboy-parol')).resolves.toBeUndefined();
  });
});
