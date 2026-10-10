import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { completeSetup, createTestApp, createUserAndLogin, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Брендинг после мастера и аудит изменений (Шаги 5–6 Этапа 2).
 *
 * Проверяется то, что нельзя увидеть в списках: право на правку, частичное
 * сохранение полей, запись в аудит со «до и после» и сообщения об отказах.
 */

interface Json {
  [key: string]: unknown;
}

describeWithDatabase('брендинг и аудит изменений', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let yearId: string;
  let groupId: string;

  const auth = () => ({ cookie: adminCookie });

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-brending',
      fullName: 'Преподаватель Брендинга',
      password: 'kolledzh-brending-2025',
      roles: ['teacher'],
    });
    teacherCookie = teacher.cookie;

    const years = await testApp.app.inject({
      method: 'GET',
      url: '/api/academic-years',
      headers: auth(),
    });
    yearId = (years.json() as { items: Array<{ id: string }> }).items[0]?.id ?? '';

    const group = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: auth(),
      payload: {
        academicYearId: yearId,
        name: 'БР-11',
        startsOn: '2025-09-01',
        endsOn: '2026-06-30',
      },
    });
    groupId = (group.json() as Json).id as string;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('брендинг читается и правится администратором', async () => {
    const before = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings/branding',
      headers: auth(),
    });

    expect(before.statusCode).toBe(200);
    expect((before.json() as Json).title).toBe('Тестовый колледж');

    const updated = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/branding',
      headers: auth(),
      payload: { title: 'Колледж связи № 54', signature: 'Дневник группы' },
    });

    expect(updated.statusCode).toBe(200);
    const branding = updated.json() as Json;
    expect(branding.title).toBe('Колледж связи № 54');
    expect(branding.signature).toBe('Дневник группы');
    // Поле, которое не передавали, не затирается частичной правкой.
    expect(branding.shortName).toBe('ТК');

    // Состояние системы отдаёт тот же брендинг: его читают экран входа и шапка.
    const status = await testApp.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect((status.json() as { branding: Json }).branding.title).toBe('Колледж связи № 54');
  });

  it('правку брендинга может делать только администратор', async () => {
    const forbidden = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/branding',
      headers: { cookie: teacherCookie },
      payload: { title: 'Подмена' },
    });

    expect(forbidden.statusCode).toBe(403);

    // Читать брендинг сотруднику можно: это данные заведения, не персональные.
    const readable = await testApp.app.inject({
      method: 'GET',
      url: '/api/settings/branding',
      headers: { cookie: teacherCookie },
    });
    expect(readable.statusCode).toBe(200);
  });

  it('внешняя ссылка вместо логотипа не принимается', async () => {
    const response = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/branding',
      headers: auth(),
      payload: { logoDataUrl: 'https://cdn.example.ru/logo.png' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('правка брендинга попадает в аудит с прежним состоянием', async () => {
    const audit = await testApp.app.inject({
      method: 'GET',
      url: '/api/audit?entityKind=branding',
      headers: auth(),
    });

    expect(audit.statusCode).toBe(200);
    const items = (audit.json() as { items: Json[] }).items;
    expect(items.length).toBeGreaterThan(0);

    const record = items[0] as { action: string; before: Json; after: Json };
    expect(record.action).toBe('update');
    expect(record.before?.title).toBe('Тестовый колледж');
    expect(record.after?.title).toBe('Колледж связи № 54');
  });

  it('зачисление вне периода существования группы отвергается', async () => {
    const student = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: auth(),
      payload: { fullName: 'Ученик Дат' },
    });
    const studentId = (student.json() as Json).id as string;

    const outside = await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: auth(),
      payload: { studentId, joinedOn: '2027-01-01' },
    });

    expect(outside.statusCode).toBe(400);
    expect((outside.json() as { error: { message: string } }).error.message).toContain(
      'вне периода',
    );

    const inside = await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: auth(),
      payload: { studentId, joinedOn: '2025-09-01' },
    });
    expect(inside.statusCode).toBe(201);

    // Отчисление раньше зачисления — тоже отказ.
    const enrollmentId = (inside.json() as { enrollment: Json }).enrollment.id as string;
    const wrongWithdraw = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/enrollments/${enrollmentId}`,
      headers: auth(),
      payload: { leftOn: '2025-01-01' },
    });
    expect(wrongWithdraw.statusCode).toBe(400);
  });

  it('каждое изменение справочников оставляет запись аудита с before и after', async () => {
    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Астрономия', kind: 'optional' },
    });
    const subjectId = (subject.json() as Json).id as string;

    await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subjects/${subjectId}`,
      headers: auth(),
      payload: { shortName: 'Астро' },
    });

    await testApp.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth(),
      payload: { name: 'Кабинет 202', capacity: 25 },
    });
    await testApp.app.inject({
      method: 'POST',
      url: '/api/grade-categories',
      headers: auth(),
      payload: { code: 'test55', title: 'Проверочная', weight: 2 },
    });

    const audit = await testApp.app.inject({
      method: 'GET',
      url: '/api/audit?limit=100',
      headers: auth(),
    });

    const items = (audit.json() as { items: Array<Json> }).items;
    const kinds = new Set(items.map((item) => item.entityKind));
    expect(kinds.has('subject')).toBe(true);
    expect(kinds.has('room')).toBe(true);
    expect(kinds.has('grade_category')).toBe(true);

    const updated = items.find(
      (item) => item.entityKind === 'subject' && item.action === 'update',
    ) as { before: Json; after: Json } | undefined;
    expect(updated).toBeDefined();
    // `before` — состояние записи целиком, `after` — только изменённые поля:
    // так запись аудита остаётся компактной, а прежнее состояние не теряется.
    expect(updated?.before?.shortName).toBeNull();
    expect(updated?.before?.name).toBe('Астрономия');
    expect(updated?.after?.shortName).toBe('Астро');
    expect(updated?.after?.name).toBeUndefined();
  });

  it('отказ удаления объясняет причину через details.usedBy', async () => {
    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Экология', kind: 'mandatory' },
    });
    const subjectId = (subject.json() as Json).id as string;

    // Назначение связывает предмет с группой: удалить предмет теперь нельзя.
    const assignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: auth(),
      payload: {
        teacherUserId: (
          await createUserAndLogin(testApp.app, adminCookie, {
            username: 'prepod-ekolog',
            fullName: 'Преподаватель Экологии',
            password: 'kolledzh-ekolog-2025',
            roles: ['teacher'],
          })
        ).id,
        subjectId,
        studyGroupId: groupId,
        startsOn: '2025-09-01',
        endsOn: '2026-06-30',
      },
    });
    expect(assignment.statusCode).toBe(201);

    const blocked = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/subjects/${subjectId}`,
      headers: auth(),
    });

    expect(blocked.statusCode).toBe(409);
    const body = blocked.json() as { error: { message: string; details?: { usedBy?: string[] } } };
    expect(body.error.message).toContain('используется');
    expect(body.error.details?.usedBy).toContain('assignments');
  });
});
