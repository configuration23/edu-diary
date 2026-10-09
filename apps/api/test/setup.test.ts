import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DEFAULT_SETUP_PAYLOAD,
  completeSetup,
  createTestApp,
  login,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

describeWithDatabase('мастер первого запуска', () => {
  let database: TestDatabase;
  let testApp: TestApp;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('до настройки закрывает API, кроме health и мастера', async () => {
    const health = await testApp.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);

    const status = await testApp.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ initialized: false });

    for (const url of ['/api/auth/me', '/api/users', '/api/roles', '/api/audit', '/api/students']) {
      const response = await testApp.app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'SETUP_REQUIRED' } });
    }
  });

  it('не создаёт учётных записей по умолчанию', async () => {
    const rows = await database.db.sql<{ count: number }[]>`
      select count(*)::int as count from app_user
    `;

    expect(rows[0]?.count).toBe(0);
  });

  it('требует пароль администратора по политике', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/setup/complete',
      payload: {
        ...DEFAULT_SETUP_PAYLOAD,
        admin: { ...DEFAULT_SETUP_PAYLOAD.admin, password: 'korotkiy' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('создаёт администратора, учебный год, период и брендинг', async () => {
    const { cookie, userId } = await completeSetup(testApp.app);

    const status = await testApp.app.inject({ method: 'GET', url: '/api/setup/status' });
    const statusBody = status.json() as {
      initialized: boolean;
      branding: { title: string | null; shortName: string | null };
    };

    expect(statusBody.initialized).toBe(true);
    expect(statusBody.branding.title).toBe('Тестовый колледж');
    expect(statusBody.branding.shortName).toBe('ТК');

    const years = await testApp.app.inject({
      method: 'GET',
      url: '/api/academic-years',
      headers: { cookie },
    });
    expect(years.json()).toMatchObject({
      items: [{ title: '2025/2026', isActive: true }],
    });

    const periods = await testApp.app.inject({
      method: 'GET',
      url: '/api/periods',
      headers: { cookie },
    });
    expect(periods.json()).toMatchObject({ items: [{ title: '1 семестр', kind: 'semester' }] });

    const me = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(me.json()).toMatchObject({
      user: { id: userId, username: 'admin', roles: [{ code: 'admin' }] },
    });
  });

  it('после настройки пускает API и вход по паролю', async () => {
    const cookie = await login(testApp.app, 'admin', DEFAULT_SETUP_PAYLOAD.admin.password);

    const users = await testApp.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie },
    });
    expect(users.statusCode).toBe(200);
    expect(users.json()).toMatchObject({ total: 1, items: [{ username: 'admin' }] });
  });

  it('закрывается навсегда: повторный вызов мастера отклоняется', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/setup/complete',
      payload: DEFAULT_SETUP_PAYLOAD,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('синхронизирует каталог прав и роли из коробки', async () => {
    const rows = await database.db.sql<{ code: string }[]>`
      select code from role order by code
    `;
    expect(rows.map((row) => row.code)).toEqual(['admin', 'parent', 'student', 'teacher']);

    const adminPermissions = await database.db.sql<{ count: number }[]>`
      select count(*)::int as count
      from role_permission rp
      join role r on r.id = rp.role_id
      where r.code = 'admin'
    `;
    expect(adminPermissions[0]?.count ?? 0).toBeGreaterThan(20);
  });
});
