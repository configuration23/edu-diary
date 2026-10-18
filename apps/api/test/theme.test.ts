import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, completeSetup, createTestApp, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Тема оформления — личная настройка учётной записи.
 *
 * Решение владельца: переключатель в профиле, настройка **серверная**. Поэтому проверяем не только
 * запись, но и то, что выбранное значение **возвращается в сессии**: именно оттуда его берёт фронт.
 * Иначе переключатель менялся бы, а после перезагрузки возвращался к прежнему.
 */
describeWithDatabase('тема оформления', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let cookie: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);

    ({ cookie } = await completeSetup(testApp.app, {
      institution: { title: 'Колледж', shortName: 'К', signature: 'Д' },
      academicYear: { title: '2026/2027', startsOn: '2026-09-01', endsOn: '2027-06-30' },
      period: {
        title: 'Семестр',
        kind: 'semester',
        startsOn: '2026-09-01',
        endsOn: '2026-12-31',
      },
      admin: { username: 'admin', fullName: 'Администратор', password: ADMIN_PASSWORD },
    }));
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  const me = () => testApp.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });

  it('по умолчанию — «как в системе»', async () => {
    /** Не «светлая»: у человека с тёмной ОС дневник должен быть тёмным сразу. */
    const response = await me();

    expect(response.statusCode).toBe(200);
    expect(response.json().user.theme).toBe('system');
  });

  it('выбранная тема сохраняется и возвращается в сессии', async () => {
    const saved = await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/theme',
      payload: { theme: 'dark' },
      headers: { cookie },
    });

    expect(saved.statusCode).toBe(200);
    expect((await me()).json().user.theme).toBe('dark');
  });

  it('возврат к «как в системе» работает', async () => {
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/theme',
      payload: { theme: 'system' },
      headers: { cookie },
    });

    expect((await me()).json().user.theme).toBe('system');
  });

  it('недопустимое значение отвергается', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/theme',
      payload: { theme: 'neon' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it('вид страниц по умолчанию — «компактно»', async () => {
    /**
     * Компактный вид — прежнее поведение спойлеров. Если сделать по умолчанию «развёрнуто», у всех
     * существующих учётных записей страницы внезапно удлинились бы.
     */
    expect((await me()).json().user.viewMode).toBe('compact');
  });

  it('вид страниц сохраняется и возвращается в сессии', async () => {
    const saved = await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/view-mode',
      payload: { viewMode: 'expanded' },
      headers: { cookie },
    });

    expect(saved.statusCode).toBe(200);
    expect((await me()).json().user.viewMode).toBe('expanded');

    /** Возвращаем компактный: следующие проверки не должны зависеть от порядка. */
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/view-mode',
      payload: { viewMode: 'compact' },
      headers: { cookie },
    });
  });

  it('недопустимый вид отвергается', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/view-mode',
      payload: { viewMode: 'huge' },
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
  });

  it('без сессии менять тему нельзя', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/auth/theme',
      payload: { theme: 'dark' },
    });

    expect(response.statusCode).toBe(401);
  });
});
