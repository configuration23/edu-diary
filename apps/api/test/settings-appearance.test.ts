import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { completeSetup, createTestApp, createUserAndLogin, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Оформление уроков: значки событий и цвета предметов.
 *
 * Проверяем то, что нельзя увидеть в интерфейсе: значения по умолчанию, частичную
 * правку, право на изменение (только администратор) и защиту от произвольного
 * символа — значок попадает в разметку, поэтому принимается только из набора.
 */

interface Json {
  [key: string]: unknown;
}

describeWithDatabase('оформление уроков', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;

  const auth = () => ({ cookie: adminCookie });

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-oformlenie',
      fullName: 'Преподаватель Оформления',
      password: 'kolledzh-oformlenie-2025',
      roles: ['teacher'],
    });
    teacherCookie = teacher.cookie;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('без настройки возвращает значения по умолчанию', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings/appearance',
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    const appearance = response.json() as Json;
    expect(appearance.markersEnabled).toBe(true);
    expect(appearance.colorsEnabled).toBe(true);
    expect((appearance.markers as Json).replaced).toBe('🔄');
    expect((appearance.markers as Json).cancelled).toBe('❎');
  });

  it('преподаватель читает оформление, но не меняет его', async () => {
    const read = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings/appearance',
      headers: { cookie: teacherCookie },
    });
    expect(read.statusCode).toBe(200);

    const write = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/appearance',
      headers: { cookie: teacherCookie },
      payload: { markersEnabled: false },
    });
    expect(write.statusCode).toBe(403);
  });

  it('частичная правка не затирает остальные поля', async () => {
    const changed = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/appearance',
      headers: auth(),
      payload: { markersEnabled: false },
    });
    expect(changed.statusCode).toBe(200);
    expect((changed.json() as Json).markersEnabled).toBe(false);

    // Меняем только значок замены: цвета и значок отмены остаются как были.
    const markers = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/appearance',
      headers: auth(),
      payload: { markers: { replaced: '⛔' } },
    });
    expect(markers.statusCode).toBe(200);

    const appearance = markers.json() as Json;
    expect(appearance.markersEnabled).toBe(false);
    expect((appearance.markers as Json).replaced).toBe('⛔');
    expect((appearance.markers as Json).cancelled).toBe('❎');
    expect(appearance.colorsEnabled).toBe(true);
  });

  it('значок вне набора или длиннее одного символа отклоняется', async () => {
    const alien = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/appearance',
      headers: auth(),
      payload: { markers: { replaced: '<script>' } },
    });
    expect(alien.statusCode).toBe(400);

    const text = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/appearance',
      headers: auth(),
      payload: { markers: { cancelled: 'отм' } },
    });
    expect(text.statusCode).toBe(400);
  });

  it('правка оформления попадает в аудит', async () => {
    await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/appearance',
      headers: auth(),
      payload: { colorsEnabled: false },
    });

    const audit = await testApp.app.inject({
      method: 'GET',
      url: '/api/audit?entityKind=appearance&limit=5',
      headers: auth(),
    });

    expect(audit.statusCode).toBe(200);
    const items = (audit.json() as { items: Json[] }).items;
    expect(items.some((item) => item.entityKind === 'appearance')).toBe(true);
  });
});
