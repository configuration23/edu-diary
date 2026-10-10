import { describe, expect, it, afterAll, beforeAll } from 'vitest';

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
 * Учебный процесс Этапа 2: группы, зачисления, справочники.
 *
 * Проверяются правила, обещанные в ROADMAP: админ ведёт справочники без
 * разработчика, удаление используемого справочника запрещено с понятным
 * сообщением, каждое изменение попадает в аудит, а данные не выходят за
 * границы учебного года.
 */

interface Json {
  [key: string]: unknown;
}

describeWithDatabase('группы, зачисления и справочники', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let yearId: string;
  let teacherCookie: string;
  let teacherUserId: string;
  let studentId: string;

  const auth = () => ({ cookie: adminCookie });

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));

    const years = await testApp.app.inject({
      method: 'GET',
      url: '/api/academic-years',
      headers: auth(),
    });
    const items = (years.json() as { items: Array<{ id: string }> }).items;
    yearId = items[0]?.id ?? '';

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-gruppy',
      fullName: 'Преподаватель Групповой',
      // Пароль не должен содержать логин: политика паролей это проверяет.
      password: 'kolledzh-2025-secret',
      roles: ['teacher'],
    });
    teacherUserId = teacher.id;
    teacherCookie = teacher.cookie;

    studentId = (await createStudent(testApp.app, adminCookie, { fullName: 'Ученик Первый' })).id;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  const createGroup = async (body: Json) =>
    testApp.app.inject({ method: 'POST', url: '/api/groups', headers: auth(), payload: body });

  const groupPayload = (name: string): Json => ({
    academicYearId: yearId,
    name,
    course: 2,
    specialty: 'Программирование в компьютерных системах',
    curatorUserId: teacherUserId,
    startsOn: '2025-09-01',
    endsOn: '2026-06-30',
  });

  it('админ создаёт группу с куратором, группа видна в списке', async () => {
    const created = await createGroup(groupPayload('ПКС-21'));

    expect(created.statusCode).toBe(201);
    const group = created.json() as Json;
    expect(group.name).toBe('ПКС-21');
    expect(group.curatorUserId).toBe(teacherUserId);
    expect(group.studentsCount).toBe(0);

    const list = await testApp.app.inject({
      method: 'GET',
      url: `/api/groups?academicYearId=${yearId}`,
      headers: auth(),
    });

    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: Json[] }).items.map((item) => item.name)).toContain('ПКС-21');
  });

  it('куратор должен быть действующим пользователем', async () => {
    const created = await createGroup({
      ...groupPayload('ПКС-22'),
      curatorUserId: '00000000-0000-4000-8000-000000000000',
    });

    expect(created.statusCode).toBe(400);
    expect((created.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('группа не выходит за границы учебного года', async () => {
    const outside = await createGroup({
      ...groupPayload('ПКС-23'),
      startedOn: undefined,
      startsOn: '2027-09-01',
      endsOn: '2028-06-30',
    });

    expect(outside.statusCode).toBe(400);
    expect((outside.json() as { error: { message: string } }).error.message).toContain(
      'границы учебного года',
    );
  });

  it('повтор имени группы в году отвергается понятной ошибкой', async () => {
    const duplicate = await createGroup(groupPayload('ПКС-21'));

    expect(duplicate.statusCode).toBe(409);
    expect((duplicate.json() as { error: { message: string } }).error.message).toContain(
      'уже есть',
    );
  });

  it('зачисление ученика попадает в состав группы, второй раз — конфликт', async () => {
    const groups = await testApp.app.inject({
      method: 'GET',
      url: `/api/groups?search=ПКС-21`,
      headers: auth(),
    });
    const groupId = (groups.json() as { items: Array<{ id: string }> }).items[0]?.id ?? '';

    const enrolled = await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: auth(),
      payload: { studentId, joinedOn: '2025-09-01' },
    });

    expect(enrolled.statusCode).toBe(201);

    const composition = await testApp.app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/students`,
      headers: auth(),
    });

    const items = (composition.json() as { items: Json[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.studentId).toBe(studentId);
    expect(items[0]?.leftOn).toBeNull();

    const again = await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: auth(),
      payload: { studentId, joinedOn: '2025-10-01' },
    });

    expect(again.statusCode).toBe(409);
  });

  it('учитель видит состав группы, но не может её менять', async () => {
    const groups = await testApp.app.inject({
      method: 'GET',
      url: `/api/groups?search=ПКС-21`,
      headers: auth(),
    });
    const groupId = (groups.json() as { items: Array<{ id: string }> }).items[0]?.id ?? '';

    const composition = await testApp.app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/students`,
      headers: { cookie: teacherCookie },
    });
    expect(composition.statusCode).toBe(200);

    const forbidden = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: teacherCookie },
      payload: groupPayload('ПКС-24'),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('перевод закрывает прежнее зачисление и открывает новое', async () => {
    const target = await createGroup(groupPayload('ПКС-25'));
    expect(target.statusCode).toBe(201);
    const targetId = (target.json() as Json).id as string;

    const transferred = await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${studentId}/transfer`,
      headers: auth(),
      payload: { studyGroupId: targetId, transferOn: '2026-02-01' },
    });

    expect(transferred.statusCode).toBe(201);
    const enrollment = (transferred.json() as { enrollment: Json }).enrollment;
    expect(enrollment.leftOn).toBeNull();
    expect(enrollment.joinedOn).toBe('2026-02-01');

    // В прежней группе ученик больше не числится, но история осталась.
    const groups = await testApp.app.inject({
      method: 'GET',
      url: '/api/groups?search=ПКС-21',
      headers: auth(),
    });
    const oldGroupId = (groups.json() as { items: Array<{ id: string }> }).items[0]?.id ?? '';

    const oldComposition = await testApp.app.inject({
      method: 'GET',
      url: `/api/groups/${oldGroupId}/students`,
      headers: auth(),
    });
    const oldItems = (oldComposition.json() as { items: Json[] }).items;
    expect(oldItems).toHaveLength(1);
    expect(oldItems[0]?.leftOn).toBe('2026-02-01');
  });

  it('перевод в ту же группу отвергается', async () => {
    const groups = await testApp.app.inject({
      method: 'GET',
      url: '/api/groups?search=ПКС-25',
      headers: auth(),
    });
    const currentGroupId = (groups.json() as { items: Array<{ id: string }> }).items[0]?.id ?? '';

    const same = await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${studentId}/transfer`,
      headers: auth(),
      payload: { studyGroupId: currentGroupId, transferOn: '2026-03-01' },
    });

    expect(same.statusCode).toBe(409);
  });

  it('справочники: предмет, аудитория и категория создаются и правятся', async () => {
    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Информатика', shortName: 'Инф', kind: 'mandatory', color: '#2563eb' },
    });
    expect(subject.statusCode).toBe(201);

    const duplicate = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Информатика', kind: 'mandatory' },
    });
    expect(duplicate.statusCode).toBe(409);

    const room = await testApp.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth(),
      payload: { name: 'Кабинет 101', capacity: 30 },
    });
    expect(room.statusCode).toBe(201);

    const category = await testApp.app.inject({
      method: 'POST',
      url: '/api/grade-categories',
      headers: auth(),
      payload: { code: 'project', title: 'Проект', weight: 3 },
    });
    expect(category.statusCode).toBe(201);

    const subjectId = (subject.json() as Json).id as string;
    const updated = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/subjects/${subjectId}`,
      headers: auth(),
      payload: { shortName: 'Информатика' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as Json).shortName).toBe('Информатика');
  });

  it('удаление предмета без истории разрешено, а занятой группы — запрещено', async () => {
    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Временный предмет', kind: 'optional' },
    });
    const subjectId = (subject.json() as Json).id as string;

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/subjects/${subjectId}`,
      headers: auth(),
    });
    expect(removed.statusCode).toBe(204);

    const groups = await testApp.app.inject({
      method: 'GET',
      url: '/api/groups?search=ПКС-21',
      headers: auth(),
    });
    const occupiedGroupId = (groups.json() as { items: Array<{ id: string }> }).items[0]?.id ?? '';

    const blocked = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/groups/${occupiedGroupId}`,
      headers: auth(),
    });

    expect(blocked.statusCode).toBe(409);
    const body = blocked.json() as { error: { message: string; details?: { usedBy?: string[] } } };
    expect(body.error.message).toContain('используется');
    expect(body.error.details?.usedBy).toContain('enrollments');
  });

  it('период обязан помещаться в год и не пересекаться с соседями', async () => {
    const outside = await testApp.app.inject({
      method: 'POST',
      url: '/api/periods',
      headers: auth(),
      payload: {
        academicYearId: yearId,
        title: 'Летний семестр',
        kind: 'semester',
        startsOn: '2025-09-01',
        endsOn: '2026-08-31',
      },
    });
    expect(outside.statusCode).toBe(400);

    const overlapping = await testApp.app.inject({
      method: 'POST',
      url: '/api/periods',
      headers: auth(),
      payload: {
        academicYearId: yearId,
        title: 'Второй семестр',
        kind: 'semester',
        startsOn: '2025-12-01',
        endsOn: '2026-06-30',
      },
    });
    expect(overlapping.statusCode).toBe(409);
    expect((overlapping.json() as { error: { message: string } }).error.message).toContain(
      'пересекается',
    );

    const next = await testApp.app.inject({
      method: 'POST',
      url: '/api/periods',
      headers: auth(),
      payload: {
        academicYearId: yearId,
        title: 'Второй семестр',
        kind: 'semester',
        startsOn: '2026-02-01',
        endsOn: '2026-06-30',
      },
    });
    expect([201, 409]).toContain(next.statusCode);
  });

  it('активный год ровно один, и он не удаляется', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/academic-years',
      headers: auth(),
      payload: { title: '2026/2027', startsOn: '2026-09-01', endsOn: '2027-06-30' },
    });
    expect(created.statusCode).toBe(201);
    const newYear = created.json() as Json;
    expect(newYear.isActive).toBe(true);

    const years = await testApp.app.inject({
      method: 'GET',
      url: '/api/academic-years',
      headers: auth(),
    });
    const items = (years.json() as { items: Array<{ id: string; isActive: boolean }> }).items;
    expect(items.filter((item) => item.isActive)).toHaveLength(1);

    const blocked = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/academic-years/${newYear.id as string}`,
      headers: auth(),
    });
    expect(blocked.statusCode).toBe(409);

    // Возвращаем активность прежнему году: дальше на него опираются тесты.
    const activated = await testApp.app.inject({
      method: 'POST',
      url: `/api/academic-years/${yearId}/activate`,
      headers: auth(),
    });
    expect(activated.statusCode).toBe(200);
    expect((activated.json() as Json).isActive).toBe(true);
  });

  it('изменения справочников видны в журнале аудита', async () => {
    const audit = await testApp.app.inject({
      method: 'GET',
      url: '/api/audit?entityKind=study_group',
      headers: auth(),
    });

    expect(audit.statusCode).toBe(200);
    const items = (audit.json() as { items: Json[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.action === 'create')).toBe(true);
  });
});
