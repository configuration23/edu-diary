import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  completeSetup,
  createTestApp,
  createUserAndLogin,
  login,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

describeWithDatabase('сессии: сроки и управление', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));
  });

  afterAll(async () => {
    await database.dispose();
  });

  const sessionsOf = (cookie: string) =>
    testApp.app.inject({ method: 'GET', url: '/api/auth/sessions', headers: { cookie } });

  it('простой ограничен 30 минутами, абсолютный срок — по роли', async () => {
    await createUserAndLogin(testApp.app, adminCookie, {
      username: 'uchenik-srok',
      fullName: 'Ученик Срок',
      password: 'kolledzh-srok-2025',
      roles: ['student'],
    });

    const cookie = await login(testApp.app, 'uchenik-srok', 'kolledzh-srok-2025');
    const response = await sessionsOf(cookie);

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      items: Array<{ current: boolean; expiresAt: string; absoluteExpiresAt: string }>;
      idleMinutes: number;
    };

    /** Число берётся с сервера: подсказка в профиле не должна врать. */
    expect(body.idleMinutes).toBe(30);

    const current = body.items.find((item) => item.current);
    expect(current).toBeDefined();
    if (current === undefined) return;

    const idleMs = new Date(current.expiresAt).getTime() - Date.now();
    expect(idleMs).toBeGreaterThan(25 * 60_000);
    expect(idleMs).toBeLessThanOrEqual(30 * 60_000);

    /** Ученику — 30 дней, а не 12 часов: иначе вход каждый день. */
    const absoluteDays =
      (new Date(current.absoluteExpiresAt).getTime() - Date.now()) / (24 * 3_600_000);
    expect(absoluteDays).toBeGreaterThan(29);
    expect(absoluteDays).toBeLessThanOrEqual(30);
  });

  it('вторая сессия видна в списке, отзыв оставляет только текущую', async () => {
    /** Хелпер уже входит один раз — это и есть первая сессия. */
    const first = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'uchenik-dve',
      fullName: 'Ученик Две Сессии',
      password: 'kolledzh-dve-2025',
      roles: ['student'],
    });

    const second = await login(testApp.app, 'uchenik-dve', 'kolledzh-dve-2025');

    const before = (await sessionsOf(second)).json() as { items: Array<{ id: string }> };
    expect(before.items).toHaveLength(2);

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/auth/sessions',
      headers: { cookie: second },
    });

    expect(removed.statusCode).toBe(200);
    expect((removed.json() as { removed: number }).removed).toBe(1);

    /** Первая сессия отозвана: её cookie больше не работает. */
    const oldSession = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: first.cookie },
    });
    expect(oldSession.statusCode).toBe(401);

    /** Текущая — жива. */
    const current = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: second },
    });
    expect(current.statusCode).toBe(200);
  });

  it('чужую сессию отозвать нельзя: ответ неотличим от «не найдено»', async () => {
    await createUserAndLogin(testApp.app, adminCookie, {
      username: 'uchenik-chuzhaya',
      fullName: 'Ученик Чужая',
      password: 'kolledzh-chuzhaya-2025',
      roles: ['student'],
    });

    const own = await login(testApp.app, 'uchenik-chuzhaya', 'kolledzh-chuzhaya-2025');
    const list = (await sessionsOf(own)).json() as { items: Array<{ id: string }> };
    const sessionId = list.items[0]?.id ?? '';

    /** Администратор пробует закрыть чужую сессию по её идентификатору. */
    const response = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${sessionId}`,
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(404);

    /** И чужая сессия продолжает работать. */
    const stillAlive = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: own },
    });
    expect(stillAlive.statusCode).toBe(200);
  });
});
