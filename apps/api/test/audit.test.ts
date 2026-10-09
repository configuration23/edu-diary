import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ADMIN_PASSWORD,
  completeSetup,
  createStudent,
  createTestApp,
  createUserAndLogin,
  login,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

interface AuditItem {
  action: string;
  entityKind: string;
  entityId: string | null;
  isAccess?: boolean;
  actorName: string | null;
}

describeWithDatabase('аудит изменений и доступа', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;

  const auditItems = async (query = ''): Promise<AuditItem[]> => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/audit?limit=200${query}`,
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    return (response.json() as { items: AuditItem[] }).items;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('записывает вход и выход', async () => {
    const cookie = await login(testApp.app, 'admin', ADMIN_PASSWORD);

    await testApp.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });

    const items = await auditItems();
    const actions = items.map((item) => item.action);

    expect(actions).toContain('login');
    expect(actions).toContain('logout');
  });

  it('записывает изменение ролей и создаёт событие безопасности', async () => {
    const user = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'roli',
      fullName: 'Пользователь Роли',
      password: 'polzovatel-2025-secret',
      roles: ['teacher'],
    });

    const changed = await testApp.app.inject({
      method: 'POST',
      url: `/api/users/${user.id}/roles`,
      headers: { cookie: adminCookie },
      payload: { roles: ['teacher', 'parent'] },
    });
    expect(changed.statusCode).toBe(200);

    const items = await auditItems(`&entityKind=user_roles&entityId=${user.id}`);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: 'update', actorName: 'Администратор Системы' });

    const events = await testApp.app.inject({
      method: 'GET',
      url: '/api/security/events',
      headers: { cookie: adminCookie },
    });
    const kinds = (events.json() as { items: Array<{ kind: string }> }).items.map(
      (item) => item.kind,
    );
    expect(kinds).toContain('role_changed');
  });

  it('отмечает настройку системы и создание ученика', async () => {
    const student = await createStudent(testApp.app, adminCookie, { fullName: 'Ученик Аудит' });

    const items = await auditItems(`&entityKind=student&entityId=${student.id}`);
    expect(items.some((item) => item.action === 'create')).toBe(true);

    const setup = await auditItems('&entityKind=system');
    expect(setup.some((item) => item.action === 'setup_completed')).toBe(true);
  });

  it('пишет доступ к карточке ученика и выгрузку списка', async () => {
    const student = await createStudent(testApp.app, adminCookie, { fullName: 'Ученик Доступ' });

    await testApp.app.inject({
      method: 'GET',
      url: `/api/students/${student.id}`,
      headers: { cookie: adminCookie },
    });

    const access = await auditItems(`&entityKind=student&entityId=${student.id}`);
    expect(access.some((item) => item.action === 'access' && item.isAccess === true)).toBe(true);

    const exported = await testApp.app.inject({
      method: 'GET',
      url: '/api/students/export.csv',
      headers: { cookie: adminCookie },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.body).toContain('Ученик Доступ');

    const exportRecords = await auditItems('&accessOnly=true');
    expect(exportRecords.some((item) => item.action === 'export')).toBe(true);
  });

  it('не позволяет изменить или удалить записи аудита и согласия через API', async () => {
    const items = await auditItems();
    const first = items[0];
    expect(first).toBeDefined();

    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const response = await testApp.app.inject({
        method,
        url: `/api/audit/${first?.entityId ?? 'x'}`,
        headers: { cookie: adminCookie },
        payload: { action: 'poddelka' },
      });
      expect(response.statusCode, `${method} /api/audit/:id`).toBe(404);
    }

    const consentMethods = ['PATCH', 'PUT', 'DELETE'] as const;
    for (const method of consentMethods) {
      const response = await testApp.app.inject({
        method,
        url: '/api/consents/00000000-0000-7000-8000-000000000000',
        headers: { cookie: adminCookie },
        payload: { policyVersion: 'poddelka' },
      });
      expect(response.statusCode, `${method} /api/consents/:id`).toBe(404);
    }
  });

  it('требует права на чтение журнала', async () => {
    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-audit',
      fullName: 'Преподаватель Аудит',
      password: 'prepod-2025-secret',
      roles: ['teacher'],
    });

    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { cookie: teacher.cookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it('не принимает неизвестный идентификатор в фильтре', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/audit?entityId=ne-uuid',
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
