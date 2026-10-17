import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, completeSetup, createTestApp, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Блок «Об учебном заведении» на «Обзоре».
 *
 * **Дефект, найденный владельцем:** поля блока показывались в форме настроек, но **не сохранялись** —
 * в список записываемых полей их забыли добавить. Администратор заполнял, жал «Сохранить», а после
 * перезагрузки поля были пустыми, и на «Обзоре» блока не было.
 *
 * Поэтому проверяем **запись и чтение обратно**, а не только наличие полей: ошибка была именно в
 * том, что форма отправляла значения, а сервис их не сохранял.
 */
describeWithDatabase('блок «Об учебном заведении»', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);

    ({ cookie: adminCookie } = await completeSetup(testApp.app, {
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

  it('заголовок и текст сохраняются и читаются обратно', async () => {
    const saved = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/branding',
      headers: { cookie: adminCookie },
      payload: {
        aboutTitle: 'Об учебном заведении',
        aboutText: 'Колледж основан в 1930 году.',
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);

    /** Читаем **отдельным запросом**: так видно, что данные дошли до хранилища, а не остались в ответе. */
    const read = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings/about',
      headers: { cookie: adminCookie },
    });
    expect(read.statusCode, read.body).toBe(200);

    const about = read.json() as { title: string | null; text: string | null; visible: boolean };
    expect(about.title).toBe('Об учебном заведении');
    expect(about.text).toBe('Колледж основан в 1930 году.');
  });

  it('блок виден всем вошедшим, а не только администратору', async () => {
    /**
     * Ученику и представителю «Обзор» открывается первым, и блок должен быть виден им тоже.
     * Брендинг для этого не годится: он требует `academics:read`, и раньше «Обзор» падал с `403`.
     */
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: adminCookie },
      payload: {
        username: 'uchenik-about',
        fullName: 'Ученик Проверочный',
        password: 'kollegiya-vesna-2025',
        roles: ['student'],
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    const login = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'uchenik-about', password: 'kollegiya-vesna-2025' },
    });
    const cookie = login.cookies.find((item) => item.name === 'edu_diary_session');
    const studentCookie = cookie === undefined ? '' : `${cookie.name}=${cookie.value}`;

    const read = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings/about',
      headers: { cookie: studentCookie },
    });

    expect(read.statusCode, read.body).toBe(200);
    expect((read.json() as { title: string | null }).title).toBe('Об учебном заведении');
  });

  it('видимость блока — отдельная настройка: скрыть и показать обратно', async () => {
    /**
     * «Заполнено значит показать» — плохой переключатель: администратор мог заполнить текст, но не
     * хотеть блок на первой странице. Поэтому видимость — **явная настройка**.
     */
    const hidden = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/branding',
      headers: { cookie: adminCookie },
      payload: { aboutVisible: false },
    });
    expect(hidden.statusCode, hidden.body).toBe(200);

    const afterHide = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings/about',
      headers: { cookie: adminCookie },
    });
    expect((afterHide.json() as { visible: boolean }).visible).toBe(false);

    /** Скрытие не стирает текст: вернуть блок можно, не заполняя заново. */
    expect((afterHide.json() as { title: string | null }).title).toBe('Об учебном заведении');

    const shown = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/branding',
      headers: { cookie: adminCookie },
      payload: { aboutVisible: true },
    });
    expect(shown.statusCode, shown.body).toBe(200);

    const afterShow = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings/about',
      headers: { cookie: adminCookie },
    });
    expect((afterShow.json() as { visible: boolean }).visible).toBe(true);
  });
});
