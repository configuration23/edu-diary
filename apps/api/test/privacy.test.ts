import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  completeSetup,
  createStudent,
  createTestApp,
  createUserAndLogin,
  publishPolicy,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

describeWithDatabase('политика и согласия', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let studentId: string;
  let guardianUserId: string;
  let guardianCookie: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));

    const guardian = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'roditel-soglasie',
      fullName: 'Родитель Согласие',
      password: 'roditel-2025-secret',
      roles: ['parent'],
    });
    guardianUserId = guardian.id;
    guardianCookie = guardian.cookie;

    studentId = (await createStudent(testApp.app, adminCookie, { fullName: 'Ученик Согласие' })).id;

    await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${studentId}/guardians`,
      headers: { cookie: adminCookie },
      payload: { guardianUserId, relation: 'father' },
    });

    // Второй ученик без согласия — нужен для списка «без согласия».
    await createStudent(testApp.app, adminCookie, { fullName: 'Ученик Без Согласия' });
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('требует опубликованную политику до регистрации согласия', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/consents',
      headers: { cookie: adminCookie },
      payload: { studentId, guardianUserId, grantedVia: 'paper' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });

    const policy = await testApp.app.inject({
      method: 'GET',
      url: '/api/privacy-policy',
      headers: { cookie: adminCookie },
    });
    expect(policy.json()).toMatchObject({ current: null, editions: [] });
  });

  it('публикует редакцию политики', async () => {
    await publishPolicy(testApp.app, adminCookie);

    const policy = await testApp.app.inject({
      method: 'GET',
      url: '/api/privacy-policy',
      headers: { cookie: adminCookie },
    });

    expect(policy.json()).toMatchObject({
      current: { version: '1.0', publishedByName: 'Администратор Системы' },
      editions: [{ version: '1.0' }],
    });
  });

  it('отклоняет повторную публикацию той же версии', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/privacy-policy',
      headers: { cookie: adminCookie },
      payload: { version: '1.0', text: 'Другая редакция с тем же номером версии.' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('отказывает в согласии от непривязанного представителя', async () => {
    const stranger = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'chuzhoy',
      fullName: 'Посторонний Пользователь',
      password: 'postoronniy-2025-parol',
      roles: ['parent'],
    });

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/consents',
      headers: { cookie: adminCookie },
      payload: { studentId, guardianUserId: stranger.id, grantedVia: 'paper' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('регистрирует согласие со ссылкой на редакцию политики', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/consents',
      headers: { cookie: adminCookie },
      payload: {
        studentId,
        guardianUserId,
        grantedVia: 'paper',
        documentRef: 'Заявление №12 от 01.09.2025',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      studentId,
      guardianUserId,
      policyVersion: '1.0',
      grantedVia: 'paper',
      documentRef: 'Заявление №12 от 01.09.2025',
      revokedAt: null,
    });
  });

  it('не принимает второе действующее согласие по тому же ученику', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/consents',
      headers: { cookie: adminCookie },
      payload: { studentId, guardianUserId, grantedVia: 'electronic' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('показывает учеников без согласия', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/consents/missing',
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ fullName: string; hasRevokedConsent: boolean }>;
      total: number;
    };

    expect(body.items.map((item) => item.fullName)).toEqual(['Ученик Без Согласия']);
    expect(body.total).toBe(1);
  });

  it('отзывает согласие, сохраняя запись', async () => {
    const list = await testApp.app.inject({
      method: 'GET',
      url: `/api/consents?studentId=${studentId}`,
      headers: { cookie: adminCookie },
    });
    const consentId = (list.json() as { items: Array<{ id: string }> }).items[0]?.id ?? '';

    const revoke = await testApp.app.inject({
      method: 'POST',
      url: `/api/consents/${consentId}/revoke`,
      headers: { cookie: adminCookie },
      payload: { reason: 'Заявление отозвано представителем' },
    });
    expect(revoke.statusCode).toBe(200);

    const after = await testApp.app.inject({
      method: 'GET',
      url: `/api/consents?studentId=${studentId}`,
      headers: { cookie: adminCookie },
    });
    const item = (
      after.json() as { items: Array<{ revokedAt: string | null; revokedReason: string | null }> }
    ).items[0];

    expect(item?.revokedAt).not.toBeNull();
    expect(item?.revokedReason).toBe('Заявление отозвано представителем');

    // Запись осталась в журнале: согласие не удаляется.
    const missing = await testApp.app.inject({
      method: 'GET',
      url: '/api/consents/missing',
      headers: { cookie: adminCookie },
    });
    const students = (
      missing.json() as { items: Array<{ fullName: string; hasRevokedConsent: boolean }> }
    ).items;

    expect(students.find((item) => item.fullName === 'Ученик Согласие')?.hasRevokedConsent).toBe(
      true,
    );
  });

  it('не позволяет родителю читать и регистрировать согласия', async () => {
    const list = await testApp.app.inject({
      method: 'GET',
      url: '/api/consents',
      headers: { cookie: guardianCookie },
    });
    expect(list.statusCode).toBe(403);

    const create = await testApp.app.inject({
      method: 'POST',
      url: '/api/consents',
      headers: { cookie: guardianCookie },
      payload: { studentId, guardianUserId, grantedVia: 'electronic' },
    });
    expect(create.statusCode).toBe(403);
  });
});
