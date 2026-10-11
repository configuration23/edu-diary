import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { completeSetup, createTestApp, createUserAndLogin, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Единый учёт учеников (Блок A правок Этапа 2).
 *
 * Раньше карточка ученика и учётная запись существовали отдельно: учеников,
 * созданных в «Согласиях», не было среди пользователей, и наоборот. Здесь
 * закреплено новое поведение: ученик первичен, учётная запись — его атрибут и
 * создаётся по необходимости.
 */

interface Json {
  [key: string]: unknown;
}

describeWithDatabase('ученик и его учётная запись', () => {
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
      username: 'prepod-ucheniki',
      fullName: 'Преподаватель Учеников',
      password: 'kolledzh-ucheniki-2025',
      roles: ['teacher'],
    });
    teacherCookie = teacher.cookie;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  const createStudent = (payload: Json) =>
    testApp.app.inject({ method: 'POST', url: '/api/students', headers: auth(), payload });

  it('ученик создаётся карточкой без учётной записи', async () => {
    const created = await createStudent({ fullName: 'Иванов Иван Иванович' });

    expect(created.statusCode).toBe(201);
    const student = created.json() as Json;
    expect(student.username).toBeNull();
    expect(student.userId).toBeNull();

    const list = await testApp.app.inject({
      method: 'GET',
      url: '/api/students?search=Иванов',
      headers: auth(),
    });
    const items = (list.json() as { items: Json[] }).items;
    expect(items[0]?.username).toBeNull();
  });

  it('ученик создаётся сразу с учётной записью', async () => {
    const created = await createStudent({
      fullName: 'Петров Пётр Петрович',
      account: { username: 'petrovpp', password: 'kolledzh-petrov-2025' },
    });

    expect(created.statusCode).toBe(201);
    const student = created.json() as Json;
    expect(student.username).toBe('petrovpp');
    expect(student.userId).not.toBeNull();

    // В списке видно, что учётная запись есть.
    const list = await testApp.app.inject({
      method: 'GET',
      url: '/api/students?search=Петров',
      headers: auth(),
    });
    const items = (list.json() as { items: Json[] }).items;
    expect(items[0]?.username).toBe('petrovpp');
  });

  it('созданная учётная запись действительно пускает в систему', async () => {
    const login = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'petrovpp', password: 'kolledzh-petrov-2025' },
    });

    expect(login.statusCode).toBe(200);
    const session = login.json() as { user: { roles: Array<{ code: string }> } };
    expect(session.user.roles.map((role) => role.code)).toContain('student');
  });

  it('повторное создание ученика с тем же логином даёт конфликт', async () => {
    const first = await createStudent({
      fullName: 'Второв Виктор Викторович',
      account: { username: 'vtorovvv', password: 'kolledzh-vtorov-2025' },
    });
    expect(first.statusCode).toBe(201);

    const second = await createStudent({
      fullName: 'Дубль Дубль Дубльевич',
      account: { username: 'vtorovvv', password: 'kolledzh-dubl-2025' },
    });

    expect(second.statusCode).toBe(409);
  });

  it('занятый логин отвергается, ничего не создаётся наполовину', async () => {
    const before = await testApp.app.inject({
      method: 'GET',
      url: '/api/students?search=Сидоров',
      headers: auth(),
    });

    const created = await createStudent({
      fullName: 'Сидоров Сидор Сидорович',
      account: { username: 'petrovpp', password: 'kolledzh-sidorov-2025' },
    });

    expect(created.statusCode).toBe(409);

    // Транзакция откатилась: карточки ученика нет.
    const after = await testApp.app.inject({
      method: 'GET',
      url: '/api/students?search=Сидоров',
      headers: auth(),
    });
    expect((after.json() as { items: Json[] }).items).toHaveLength(
      (before.json() as { items: Json[] }).items.length,
    );
  });

  it('учётную запись можно завести ученику, созданному ранее', async () => {
    const created = await createStudent({ fullName: 'Кузнецова Анна Сергеевна' });
    const studentId = (created.json() as Json).id as string;

    const account = await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${studentId}/account`,
      headers: auth(),
      payload: { username: 'kuznetsovaas', password: 'kolledzh-kuznetsova-2025' },
    });

    expect(account.statusCode).toBe(201);
    const updated = account.json() as Json;
    expect(updated.username).toBe('kuznetsovaas');
    expect(updated.userId).not.toBeNull();

    // Второй раз учётную запись не создать.
    const again = await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${studentId}/account`,
      headers: auth(),
      payload: { username: 'kuznetsovaas2', password: 'kolledzh-kuznetsova-2025' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('логин предлагается транслитерацией и учитывает занятость', async () => {
    const first = await testApp.app.inject({
      method: 'GET',
      url: '/api/users/suggest-username?fullName=Чумаков%20Сергей%20Петрович',
      headers: auth(),
    });

    expect(first.statusCode).toBe(200);
    expect((first.json() as Json).username).toBe('chumakovsp');

    // Занимаем логин и просим снова: должна появиться цифра.
    await createStudent({
      fullName: 'Чумаков Сергей Петрович',
      account: { username: 'chumakovsp', password: 'kolledzh-chumakov-2025' },
    });

    const second = await testApp.app.inject({
      method: 'GET',
      url: '/api/users/suggest-username?fullName=Чумаков%20Сергей%20Петрович',
      headers: auth(),
    });

    expect((second.json() as Json).username).toBe('chumakovsp1');
    expect((second.json() as Json).taken).toContain('chumakovsp');
  });

  it('преподаватель не может создавать учеников и учётные записи', async () => {
    const student = await createStudent({ fullName: 'Никитин Никита Игоревич' });
    const studentId = (student.json() as Json).id as string;

    const createByTeacher = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: { cookie: teacherCookie },
      payload: { fullName: 'Чужой Ученик' },
    });
    expect(createByTeacher.statusCode).toBe(403);

    const accountByTeacher = await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${studentId}/account`,
      headers: { cookie: teacherCookie },
      payload: { username: 'nikitin', password: 'kolledzh-nikitin-2025' },
    });
    expect(accountByTeacher.statusCode).toBe(403);

    const suggestByTeacher = await testApp.app.inject({
      method: 'GET',
      url: '/api/users/suggest-username?fullName=Тестов%20Тест',
      headers: { cookie: teacherCookie },
    });
    expect(suggestByTeacher.statusCode).toBe(403);
  });

  it('ученик видит только свои данные после создания учётной записи', async () => {
    const created = await createStudent({
      fullName: 'Орлова Ольга Ивановна',
      account: { username: 'orlovaoo', password: 'kolledzh-orlova-2025' },
    });
    const ownStudentId = (created.json() as Json).id as string;

    const other = await createStudent({ fullName: 'Белов Белов Белович' });
    const foreignStudentId = (other.json() as Json).id as string;

    const login = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'orlovaoo', password: 'kolledzh-orlova-2025' },
    });
    const cookie = (login.cookies.find((item) => item.name === 'edu_diary_session') ?? {})
      .value as string;
    const studentCookie = { cookie: `edu_diary_session=${cookie}` };

    const own = await testApp.app.inject({
      method: 'GET',
      url: `/api/students/${ownStudentId}`,
      headers: studentCookie,
    });
    expect(own.statusCode).toBe(200);

    // Инвариант приватности (ADR-005) сохраняется: чужой ученик — «не найдено».
    const foreign = await testApp.app.inject({
      method: 'GET',
      url: `/api/students/${foreignStudentId}`,
      headers: studentCookie,
    });
    expect(foreign.statusCode).toBe(404);
  });
});
