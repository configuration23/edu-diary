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

  it('битый JSON — ошибка клиента, а не сбой сервера', async () => {
    /**
     * Находка F-07: тело с неверным JSON давало 500. Сервер не должен считать ошибку клиента
     * внутренним сбоем — иначе мониторинг зашумлён, а человек видит «внутренняя ошибка».
     */
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{ это не json',
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('ученик не может менять роли учётных записей', async () => {
    /** Находка F-13: раньше здесь был 500, и было непонятно, где именно проверяются права. */
    const student = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'uchenik-roli',
      fullName: 'Ученик Роли',
      password: 'kolledzh-roli-2025',
      roles: ['student'],
    });

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/users/00000000-0000-7000-8000-000000000000/roles',
      headers: { cookie: student.cookie },
      payload: { roles: ['admin'] },
    });

    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('перебор по списку логинов упирается в лимит адреса', async () => {
    /**
     * Находка: несуществующие логины не лимитировались — 6 попыток и ни одного 429. Ограничение по
     * учётной записи такой перебор не ловит, поэтому счётчик ведётся по адресу.
     */
    const attempt = (username: string) =>
      testApp.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.7' },
        payload: { username, password: 'nesushchestvuyushchiy-parol-2025' },
      });

    /** Двадцать разных логинов — каждый по одному разу. */
    for (let index = 0; index < 20; index += 1) {
      const response = await attempt(`net-takogo-${index}`);
      expect(response.statusCode).toBe(401);
    }

    /** Двадцать первая попытка — блокировка адреса. */
    const blocked = await attempt('net-takogo-21');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('несуществующий логин ведёт себя как существующий', async () => {
    /**
     * Владелец: разное поведение для существующих и несуществующих логинов недопустимо — это вектор
     * разведки перед атакой. Проверяем одинаковые коды и одинаковый текст блокировки.
     */
    const attempt = (username: string) =>
      testApp.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '198.51.100.9' },
        payload: { username, password: 'nesushchestvuyushchiy-parol-2025' },
      });

    /** Пять неудач по несуществующему логину — те же 401, что и по существующему. */
    for (let index = 0; index < 5; index += 1) {
      expect((await attempt('takogo-net-v-gorode')).statusCode).toBe(401);
    }

    const blocked = await attempt('takogo-net-v-gorode');
    expect(blocked.statusCode).toBe(429);

    /** Текст блокировки одинаков для любого логина: никаких «учётка не найдена» и точных сроков. */
    expect((blocked.json() as { error: { message: string } }).error.message).toBe(
      'Превышено количество попыток входа. Попробуйте повторить позже.',
    );
  });
});
