import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  completeSetup,
  createStudent,
  createTestApp,
  createUserAndLogin,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Инварианты приватности (ADR-005, SECURITY.md §5): ученик и родитель не видят
 * чужих данных, преподаватель видит учеников, администратор — всё.
 */

describeWithDatabase('права и приватность', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;

  let studentCookie: string;
  let parentCookie: string;
  let teacherCookie: string;
  let ownStudentId: string;
  let ownStudentUserId: string;
  let foreignStudentId: string;
  let parentUserId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));

    const studentUser = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'uchenik1',
      fullName: 'Ученик Первый',
      password: 'uchenik-pervyy-2025',
      roles: ['student'],
    });
    ownStudentUserId = studentUser.id;
    studentCookie = studentUser.cookie;

    const parent = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'roditel1',
      fullName: 'Родитель Первый',
      password: 'roditel-pervyy-2025',
      roles: ['parent'],
    });
    parentUserId = parent.id;
    parentCookie = parent.cookie;

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod1',
      fullName: 'Преподаватель Первый',
      password: 'prepod-pervyy-2025',
      roles: ['teacher'],
    });
    teacherCookie = teacher.cookie;

    ownStudentId = (
      await createStudent(testApp.app, adminCookie, {
        fullName: 'Ученик Первый',
        userId: ownStudentUserId,
      })
    ).id;

    foreignStudentId = (
      await createStudent(testApp.app, adminCookie, { fullName: 'Ученик Второй' })
    ).id;

    await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${ownStudentId}/guardians`,
      headers: { cookie: adminCookie },
      payload: { guardianUserId: parentUserId, relation: 'mother' },
    });
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('ученик не получает список учеников и чужие данные', async () => {
    const list = await testApp.app.inject({
      method: 'GET',
      url: '/api/students',
      headers: { cookie: studentCookie },
    });
    expect(list.statusCode).toBe(403);

    const own = await testApp.app.inject({
      method: 'GET',
      url: `/api/students/${ownStudentId}`,
      headers: { cookie: studentCookie },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ id: ownStudentId, fullName: 'Ученик Первый' });

    const foreign = await testApp.app.inject({
      method: 'GET',
      url: `/api/students/${foreignStudentId}`,
      headers: { cookie: studentCookie },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('родитель видит только своих детей', async () => {
    const own = await testApp.app.inject({
      method: 'GET',
      url: `/api/students/${ownStudentId}`,
      headers: { cookie: parentCookie },
    });
    expect(own.statusCode).toBe(200);

    const foreign = await testApp.app.inject({
      method: 'GET',
      url: `/api/students/${foreignStudentId}`,
      headers: { cookie: parentCookie },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('ученик и родитель не видят пользователей и журналы', async () => {
    for (const cookie of [studentCookie, parentCookie]) {
      for (const url of ['/api/users', '/api/roles', '/api/audit', '/api/security/events']) {
        const response = await testApp.app.inject({ method: 'GET', url, headers: { cookie } });
        expect(response.statusCode, `${url} для ${cookie.slice(0, 12)}`).toBe(403);
      }
    }
  });

  it('преподаватель видит карточку ученика', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/students/${foreignStudentId}`,
      headers: { cookie: teacherCookie },
    });

    expect(response.statusCode).toBe(200);
  });

  it('преподаватель не может создавать пользователей и менять роли', async () => {
    const create = await testApp.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: teacherCookie },
      payload: {
        username: 'novek',
        fullName: 'Новый Пользователь',
        password: 'parol-dlya-novogo-2025',
        roles: ['teacher'],
      },
    });
    expect(create.statusCode).toBe(403);

    const roles = await testApp.app.inject({
      method: 'GET',
      url: '/api/roles',
      headers: { cookie: teacherCookie },
    });
    expect(roles.statusCode).toBe(403);
  });

  it('администратор не может изменить собственные роли и деактивировать себя', async () => {
    const me = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: adminCookie },
    });
    const adminId = (me.json() as { user: { id: string } }).user.id;

    const roles = await testApp.app.inject({
      method: 'POST',
      url: `/api/users/${adminId}/roles`,
      headers: { cookie: adminCookie },
      payload: { roles: ['teacher'] },
    });
    expect(roles.statusCode).toBe(409);

    const deactivate = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/users/${adminId}`,
      headers: { cookie: adminCookie },
      payload: { isActive: false },
    });
    expect(deactivate.statusCode).toBe(409);
  });

  it('не подтверждает существование чужого ученика и пишет событие безопасности', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/students/${foreignStudentId}`,
      headers: { cookie: parentCookie },
    });
    expect(response.statusCode).toBe(404);

    const events = await testApp.app.inject({
      method: 'GET',
      url: '/api/security/events',
      headers: { cookie: adminCookie },
    });
    const details = (events.json() as { items: Array<{ kind: string; details: unknown }> }).items;

    expect(details.some((item) => item.kind === 'access_out_of_scope')).toBe(true);
  });
});
