import { describe, expect, it } from 'vitest';

import { isUuid, uuidv7 } from '../src/shared/ids';

describe('uuidv7', () => {
  it('возвращает строку нужного формата', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(isUuid(id)).toBe(true);
    expect(id).toHaveLength(36);
  });

  it('ставит версию 7 и вариант RFC 4122', () => {
    const id = uuidv7();
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('сортируются по времени создания (ADR-015)', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_001_000);
    expect(earlier < later).toBe(true);
    expect(uuidv7(0) < uuidv7(2 ** 47)).toBe(true);
  });

  it('не повторяется', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it('кодирует переданное время в старших байтах', () => {
    const id = uuidv7(0x0000_0000_0001);
    expect(id.startsWith('00000000-0001')).toBe(true);
  });
});

describe('isUuid', () => {
  it('отвергает неподходящие значения', () => {
    expect(isUuid('s-1')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
