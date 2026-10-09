import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ADMIN_PASSWORD,
  completeSetup,
  createTestApp,
  createUserAndLogin,
  login,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

const USER_PASSWORD = 'uchenik-2025-secret';

describeWithDatabase('вход, сессии и пароли', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('отдаёт cookie сессии и текущего пользователя', async () => {
    const cookie = await login(testApp.app, 'admin', ADMIN_PASSWORD);

    const me = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { username: 'admin', isActive: true, mustChangePassword: false },
      permissions: expect.arrayContaining([{ permission: 'users:read', scope: 'all' }]),
    });
  });

  it('не различает неизвестный логин и неверный пароль', async () => {
    const unknown = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'net-takogo', password: 'kakoy-to-parol-2025' },
    });
    const wrong = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'ne-tot-parol-2025' },
    });

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    expect(wrong.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('блокирует учётную запись после серии неудачных попыток', async () => {
    const user = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'blokirovka',
      fullName: 'Пользователь Блокировка',
      password: USER_PASSWORD,
      roles: ['teacher'],
    });
    expect(user.cookie).toBeTruthy();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'blokirovka', password: 'nepravilnyy-parol' },
      });
      expect(response.statusCode).toBe(401);
    }

    // Шестая попытка: учётка заблокирована, даже пароль верный.
    const locked = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'blokirovka', password: USER_PASSWORD },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });

    const events = await testApp.app.inject({
      method: 'GET',
      url: '/api/security/events',
      headers: { cookie: adminCookie },
    });
    const body = events.json() as { items: Array<{ kind: string }> };
    const kinds = body.items.map((item) => item.kind);

    expect(kinds).toContain('failed_login_burst');
    expect(kinds).toContain('account_locked');
  });

  it('не пускает отключённую учётную запись', async () => {
    const user = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'otklyuchen',
      fullName: 'Пользователь Отключённый',
      password: USER_PASSWORD,
      roles: ['teacher'],
    });

    const disabled = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: { cookie: adminCookie },
      payload: { isActive: false },
    });
    expect(disabled.statusCode).toBe(200);

    const attempt = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'otklyuchen', password: USER_PASSWORD },
    });
    expect(attempt.statusCode).toBe(403);
    expect(attempt.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('разрешает администратору сбросить пароль и требует его смены', async () => {
    const user = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'sbraspol',
      fullName: 'Пользователь Сброс',
      password: USER_PASSWORD,
      roles: ['teacher'],
    });

    const reset = await testApp.app.inject({
      method: 'POST',
      url: `/api/users/${user.id}/reset-password`,
      headers: { cookie: adminCookie },
      payload: { password: 'novyy-vremennyy-parol' },
    });
    expect(reset.statusCode).toBe(200);

    // Прежний пароль больше не действует, временный требует смены.
    const oldPassword = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'sbraspol', password: USER_PASSWORD },
    });
    expect(oldPassword.statusCode).toBe(401);

    const cookie = await login(testApp.app, 'sbraspol', 'novyy-vremennyy-parol');
    const me = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(me.json()).toMatchObject({ user: { mustChangePassword: true } });
  });

  it('меняет свой пароль и отзывает остальные сессии', async () => {
    const user = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'smena',
      fullName: 'Пользователь Смена',
      password: USER_PASSWORD,
      roles: ['teacher'],
    });

    // Вторая сессия того же пользователя.
    const secondCookie = await login(testApp.app, 'smena', USER_PASSWORD);

    const changed = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: user.cookie },
      payload: { currentPassword: USER_PASSWORD, newPassword: 'sovershenno-novyy-parol' },
    });
    expect(changed.statusCode).toBe(200);

    // Текущая сессия жива, вторая отозвана.
    const current = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: user.cookie },
    });
    expect(current.statusCode).toBe(200);

    const revoked = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: secondCookie },
    });
    expect(revoked.statusCode).toBe(401);

    // Старый пароль не работает, новый — работает.
    const oldLogin = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'smena', password: USER_PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);
    await expect(login(testApp.app, 'smena', 'sovershenno-novyy-parol')).resolves.toBeTruthy();
  });

  it('отвергает слабый новый пароль', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie: adminCookie },
      payload: { currentPassword: ADMIN_PASSWORD, newPassword: 'admin' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('выход отзывает сессию', async () => {
    const cookie = await login(testApp.app, 'admin', ADMIN_PASSWORD);

    const logout = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);

    const me = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(401);
  });
});
