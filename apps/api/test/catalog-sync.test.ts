import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAuditService } from '../src/modules/audit';
import { createRolesRepository, createRolesService } from '../src/modules/iam';
import { completeSetup, createTestApp, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Синхронизация каталога прав на уже настроенной установке.
 *
 * Дефект, который здесь закреплён: `syncCatalog` добавлял новое право в каталог,
 * но не выдавал его существующим ролям. На чистой базе роли создаются сразу с
 * полным набором, поэтому разносторонние тесты этого не видели — отказ `403`
 * вылез только на базе, где система уже была настроена (нашёл сквозной сценарий).
 *
 * В приложении синхронизацию выполняет точка входа (`main.ts`) при старте,
 * поэтому в тесте она вызывается явно тем же сервисом.
 */
describeWithDatabase('синхронизация каталога прав', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;

  const rolesService = () =>
    createRolesService({
      db: database.db,
      roles: createRolesRepository(database.db),
      audit: buildAuditService(database.db),
    });

  const permissionsOf = async (): Promise<Array<{ permission: string; scope: string }>> => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: adminCookie },
    });

    return (response.json() as { permissions: Array<{ permission: string; scope: string }> })
      .permissions;
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

  it('выдаёт существующей роли право, добавленное в каталог', async () => {
    // Имитируем установку «до обновления»: у ролей нет прав назначений.
    await database.db.sql.unsafe(
      `delete from role_permission where permission_code like 'assignments%'`,
    );

    const before = await permissionsOf();
    expect(before.some((grant) => grant.permission === 'assignments:write')).toBe(false);

    // Синхронизация при старте приложения — как после обновления на сервере.
    const result = await rolesService().syncCatalog();
    expect(result.grantsAdded).toBeGreaterThan(0);

    const after = await permissionsOf();
    expect(after).toContainEqual({ permission: 'assignments:read', scope: 'all' });
    expect(after).toContainEqual({ permission: 'assignments:write', scope: 'all' });
  });

  it('после выдачи прав администратор работает с назначениями', async () => {
    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: { cookie: adminCookie },
      payload: { name: 'Проверка права', kind: 'mandatory' },
    });

    expect(subject.statusCode).toBe(201);
  });

  it('повторная синхронизация ничего не дублирует', async () => {
    const second = await rolesService().syncCatalog();

    expect(second.rolesCreated).toBe(0);
    expect(second.grantsAdded).toBe(0);

    const rows = await database.db.sql.unsafe(
      `select count(*)::int as count from role_permission rp
         join role r on r.id = rp.role_id
        where r.code = 'admin' and rp.permission_code = 'assignments:write'`,
    );
    expect((rows[0] as { count: number } | undefined)?.count).toBe(1);
  });

  it('права назначаются только ролям, объявленным в каталоге', async () => {
    const rows = await database.db.sql.unsafe(
      `select distinct r.code
         from role r
         join role_permission rp on rp.role_id = r.id
        where rp.permission_code like 'assignments%'
        order by r.code`,
    );

    const codes = (rows as unknown as Array<{ code: string }>).map((row) => row.code);
    // Ученику и родителю назначения не выдаются: в каталоге для них их нет.
    expect(codes).toEqual(['admin', 'teacher']);
  });

  it('чтение новостей выдаётся всем ролям, публикация — только администратору', async () => {
    /**
     * Дефект, найденный владельцем: у всех, **кроме администратора**, `/api/news` отвечал `403`.
     *
     * Причина: право `news:read` я добавил в **наборы** ролей, но не в `grantedOnSync` —
     * синхронизация выдаёт только права из этого списка, чтобы не перезаписывать ручные правки
     * администратора. На **чистой** базе роли создаются сразу с полным набором, поэтому обычные
     * тесты этого не видели: отказ вылез только на уже настроенной установке.
     *
     * Здесь это и проверяется: убираем право у всех ролей, как на установке «до обновления», и
     * синхронизация должна его вернуть.
     */
    await database.db.sql.unsafe(`delete from role_permission where permission_code = 'news:read'`);

    const before = await database.db.sql.unsafe(
      `select count(*)::int as count from role_permission where permission_code = 'news:read'`,
    );
    expect((before[0] as { count: number } | undefined)?.count).toBe(0);

    const result = await rolesService().syncCatalog();
    expect(result.grantsAdded).toBeGreaterThan(0);

    const rows = await database.db.sql.unsafe(
      `select distinct r.code
         from role r
         join role_permission rp on rp.role_id = r.id
        where rp.permission_code = 'news:read'
        order by r.code`,
    );

    const codes = (rows as unknown as Array<{ code: string }>).map((row) => row.code);
    expect(codes).toEqual(['admin', 'parent', 'student', 'teacher']);

    /** Публикация — право администратора: остальным оно не выдаётся. */
    const writers = await database.db.sql.unsafe(
      `select distinct r.code
         from role r
         join role_permission rp on rp.role_id = r.id
        where rp.permission_code = 'news:write'
        order by r.code`,
    );
    expect((writers as unknown as Array<{ code: string }>).map((row) => row.code)).toEqual([
      'admin',
    ]);
  });
});
