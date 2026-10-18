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

describeWithDatabase('удаление ученика', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let cookie: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie } = await completeSetup(testApp.app));
  });

  afterAll(async () => {
    await database.dispose();
  });

  const remove = (id: string) =>
    testApp.app.inject({
      method: 'DELETE',
      url: `/api/students/${id}`,
      headers: { cookie },
    });

  it('ученик без учётной записи, согласия и зачислений удаляется', async () => {
    const student = await createStudent(testApp.app, cookie, { fullName: 'Ученик Пустой' });

    const response = await remove(student.id);
    expect(response.statusCode).toBe(204);

    /** Проверяем не только код ответа: запись должна исчезнуть из списка. */
    const list = await testApp.app.inject({
      method: 'GET',
      url: '/api/students',
      headers: { cookie },
    });
    const items = (list.json() as { items: Array<{ id: string }> }).items;
    expect(items.some((item) => item.id === student.id)).toBe(false);
  });

  it('ученика с учётной записью удалить нельзя: только отключить', async () => {
    const student = await createStudent(testApp.app, cookie, { fullName: 'Ученик С УЗ' });

    const account = await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${student.id}/account`,
      headers: { cookie },
      payload: { username: 'uchenik-s-uz', password: 'parol-uchenika-2025' },
    });
    expect(account.statusCode).toBe(201);

    const response = await remove(student.id);
    expect(response.statusCode).toBe(409);
    expect((response.json() as { error: { message: string } }).error.message).toContain(
      'учётная запись',
    );
  });

  it('ученика с согласием удалить нельзя: запись о согласии должна сохраниться', async () => {
    await publishPolicy(testApp.app, cookie);

    const guardian = await createUserAndLogin(testApp.app, cookie, {
      username: 'roditel-udalenie',
      fullName: 'Родитель Удаление',
      password: 'roditel-2025-secret',
      roles: ['parent'],
    });

    const student = await createStudent(testApp.app, cookie, { fullName: 'Ученик Согласие' });

    await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${student.id}/guardians`,
      headers: { cookie },
      payload: { guardianUserId: guardian.id, relation: 'mother' },
    });

    const consent = await testApp.app.inject({
      method: 'POST',
      url: '/api/consents',
      headers: { cookie },
      payload: { studentId: student.id, guardianUserId: guardian.id, grantedVia: 'paper' },
    });
    expect(consent.statusCode).toBe(201);

    const response = await remove(student.id);
    expect(response.statusCode).toBe(409);
    expect((response.json() as { error: { message: string } }).error.message).toContain('согласие');
  });

  it('ученика с зачислением удалить нельзя: сначала отчисление', async () => {
    const year = await testApp.app.inject({
      method: 'GET',
      url: '/api/academic-years',
      headers: { cookie },
    });
    const yearId = (year.json() as { items: Array<{ id: string }> }).items[0]?.id ?? '';

    const group = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie },
      payload: {
        academicYearId: yearId,
        name: 'УД-1',
        specialty: 'Тест',
        course: 1,
        startsOn: '2025-09-01',
        endsOn: '2026-06-30',
      },
    });
    expect(group.statusCode).toBe(201);
    const groupId = (group.json() as { id: string }).id;

    const student = await createStudent(testApp.app, cookie, { fullName: 'Ученик В Группе' });

    const enrolled = await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: { cookie },
      payload: { studentId: student.id, joinedOn: '2025-09-01' },
    });
    expect(enrolled.statusCode).toBe(201);

    const response = await remove(student.id);
    expect(response.statusCode).toBe(409);
    expect((response.json() as { error: { message: string } }).error.message).toContain('зачислен');
  });
});
