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

describeWithDatabase('защита входа', () => {
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

  it('после пяти неудач вход блокируется, и срок удваивается с каждой новой', async () => {
    const username = 'uchenik-blokirovka';
    await createUserAndLogin(testApp.app, adminCookie, {
      username,
      fullName: 'Ученик Блокировка',
      password: 'parol-uchenika-2025',
      roles: ['student'],
    });

    const attempt = () =>
      testApp.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username, password: 'nevernyy-parol-2025' },
      });

    /** Первые четыре неудачи — обычный отказ. */
    for (let index = 0; index < 4; index += 1) {
      const response = await attempt();
      expect(response.statusCode).toBe(401);
    }

    /** Пятая ставит блокировку на 5 минут. */
    expect((await attempt()).statusCode).toBe(401);

    const locked = await attempt();
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
    expect(
      (locked.json() as { error: { details: { retryAfterMinutes: number } } }).error.details
        .retryAfterMinutes,
    ).toBe(5);
  });

  it('временный пароль закрывает всё, кроме смены пароля', async () => {
    const username = 'uchenik-vremennyy';
    /** Именно с обязательной сменой: тест проверяет гейт, а не обычный вход. */
    await createUserAndLogin(
      testApp.app,
      adminCookie,
      {
        username,
        fullName: 'Ученик Временный',
        password: 'vremennyy-parol-2025',
        roles: ['student'],
      },
      { mustChangePassword: true },
    );

    const login = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: 'vremennyy-parol-2025' },
    });
    expect(login.statusCode).toBe(200);

    /** Cookie берём из заголовка: `cookies` у inject заполняется не во всех версиях. */
    const setCookie = login.headers['set-cookie'];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? '';
    const body = login.json() as { user: { mustChangePassword: boolean } };

    /** По умолчанию временный пароль помечен — значит гейт включён. */
    expect(body.user.mustChangePassword).toBe(true);

    const news = await testApp.app.inject({
      method: 'GET',
      url: '/api/news',
      headers: { cookie },
    });

    expect(news.statusCode).toBe(403);
    expect((news.json() as { error: { details: { reason: string } } }).error.details.reason).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );

    /**
     * Служебные маршруты не блокируются: без них приложение не отрисуется и вместо просьбы
     * сменить пароль человек увидит «не удалось получить состояние системы» (баг со стенда).
     */
    for (const url of ['/api/setup/status', '/api/health']) {
      const boot = await testApp.app.inject({ method: 'GET', url, headers: { cookie } });
      expect(boot.statusCode, `${url}: ${boot.body}`).toBe(200);
    }

    /** Себя узнать можно: без этого экран не поймёт, что происходит. */
    expect(
      (await testApp.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } }))
        .statusCode,
    ).toBe(200);

    const changed = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: 'vremennyy-parol-2025', newPassword: 'postoyannyy-parol-2025' },
    });

    expect(changed.statusCode).toBe(200);

    const afterChange = await testApp.app.inject({
      method: 'GET',
      url: '/api/news',
      headers: { cookie },
    });

    expect(afterChange.statusCode).toBe(200);
  });

  it('пароль нельзя менять чаще одного раза в 6 часов', async () => {
    const username = 'uchenik-chastota';
    await createUserAndLogin(testApp.app, adminCookie, {
      username,
      fullName: 'Ученик Частота',
      password: 'chastota-parol-2025',
      roles: ['student'],
      mustChangePassword: false,
    });

    const cookie = await login(testApp.app, username, 'chastota-parol-2025');

    const first = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { currentPassword: 'chastota-parol-2025', newPassword: 'pervyy-novyy-parol-2025' },
    });
    expect(first.statusCode).toBe(200);

    /** Вторая смена сразу — отказ с остатком времени: 6 часов ещё не прошли. */
    const second = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: {
        currentPassword: 'pervyy-novyy-parol-2025',
        newPassword: 'vtoroy-novyy-parol-2025',
      },
    });

    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();

    const minutes = (second.json() as { error: { details: { retryAfterMinutes: number } } }).error
      .details.retryAfterMinutes;
    expect(minutes).toBeGreaterThan(350);
    expect(minutes).toBeLessThanOrEqual(360);
  });
});
