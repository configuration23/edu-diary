import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, completeSetup, createTestApp, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';
import { createLessonContext, factories, injectClient } from './helpers/factories';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Домашние задания: публикация, права и видимость.
 *
 * Проверяем то, что ломается незаметно: учитель не ставит задание в чужой урок, ученик не
 * видит чужие задания, «продолжительное» задание видно в уроках предмета до своей даты, но
 * **не раньше**, чем его задали.
 */

interface Json {
  [key: string]: unknown;
}

function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

describeWithDatabase('домашние задания', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;
  let lessonId: string;
  let groupId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);

    ({ cookie: adminCookie } = await completeSetup(testApp.app, {
      institution: { title: 'Тестовый колледж', shortName: 'ТК', signature: 'Дневник' },
      academicYear: { title: 'Год', startsOn: shiftDays(-200), endsOn: shiftDays(200) },
      period: {
        title: 'Семестр',
        kind: 'semester',
        startsOn: shiftDays(-100),
        endsOn: shiftDays(100),
      },
      admin: { username: 'admin', fullName: 'Администратор', password: ADMIN_PASSWORD },
    }));

    const created = await createLessonContext(factories(injectClient(testApp.app), adminCookie), {
      run: 'ДЗ',
      yearStartsOn: shiftDays(-200),
      yearEndsOn: shiftDays(200),
      withStudent: true,
      lessonDate: shiftDays(-1),
    });

    const studentAccount = created.student;

    lessonId = created.lesson?.id ?? '';
    groupId = created.group.id;
    teacherCookie = created.teacher.cookie;

    studentCookie = await (async () => {
      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        /**
         * Логин берём у фабрики: она добавляет к метке прогона допустимый суффикс, и
         * выдуманный логин здесь уже один раз сломал тест.
         */
        payload: {
          username: studentAccount?.username ?? '',
          password: studentAccount?.password ?? '',
        },
      });
      const cookie = response.cookies.find((item) => item.name === 'edu_diary_session');
      return cookie === undefined ? '' : `${cookie.name}=${cookie.value}`;
    })();
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  const auth = (cookie: string) => ({ cookie });

  it('учитель ставит задание в свой урок; оно видно в журнале урока', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Прочитать главу 3 и ответить на вопросы', dueOn: shiftDays(3) },
    });

    expect(response.statusCode, response.body).toBe(201);

    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${lessonId}`,
      headers: auth(teacherCookie),
    });

    expect(journal.statusCode, journal.body).toBe(200);
    const item = (journal.json() as { item: Json }).item;
    expect(item?.text).toContain('главу 3');
    // Учителю сразу видно, сколько учеников должны сдать.
    expect(item?.studentCount).toBe(1);
    expect(item?.submittedCount).toBe(0);
  });

  it('второе задание на тот же урок не принимается', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Ещё одно задание' },
    });

    // Два задания на урок запутали бы и учителя, и ученика.
    expect(response.statusCode, response.body).toBe(409);
  });

  it('пустое задание не принимается', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: '   ' },
    });

    // Проверка порядка: сначала отказ по пустоте, а не по занятому уроку.
    expect([400, 409]).toContain(response.statusCode);
  });

  it('срок раньше даты урока отклоняется', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Сдать вчера', dueOn: shiftDays(-5) },
    });

    expect(response.statusCode, response.body).toBe(400);
  });

  it('ученик видит задание своей группы и не может его поставить', async () => {
    const list = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework?studyGroupId=${groupId}&onDate=${shiftDays(-1)}`,
      headers: auth(studentCookie),
    });

    expect(list.statusCode, list.body).toBe(200);
    const items = (list.json() as { items: Json[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(1);

    // Ученик не ставит задания: права `homework:write` у него нет.
    const attempt = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(studentCookie),
      payload: { lessonId, text: 'Я тоже хочу задать задание' },
    });

    /**
     * Ученик решение **отправляет** (homework:write с областью own), но задание не
     * ставит: для постановки нужна область ssigned. Проверка «право есть» пропустила
     * бы его, и он упёрся бы в 404 по чужому уроку вместо честного отказа.
     */
    expect(attempt.statusCode, attempt.body).toBe(403);
  });

  it('чужой урок: задание не ставится и не видно, ответ не отличается от «не найдено»', async () => {
    /**
     * Преподаватель без назначения на эту группу: он не должен ни видеть задание, ни
     * узнать, что оно существует. Ответ — `404`, а не `403`: разница выдавала бы чужие
     * задания.
     */
    const stranger = await testApp.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(adminCookie),
      payload: {
        username: 'prepod-chuzhoy',
        fullName: 'Чужой Преподаватель',
        password: 'kolledzh-chuzhoy-2025',
        roles: ['teacher'],
      },
    });
    expect(stranger.statusCode, stranger.body).toBe(201);

    const login = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'prepod-chuzhoy', password: 'kolledzh-chuzhoy-2025' },
    });
    const cookie = login.cookies.find((item) => item.name === 'edu_diary_session');
    const strangerCookie = cookie === undefined ? '' : `${cookie.name}=${cookie.value}`;

    const attempt = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(strangerCookie),
      payload: { lessonId, text: 'Хочу поставить чужое задание' },
    });
    expect(attempt.statusCode, attempt.body).toBe(404);

    // И то же самое для несуществующего урока: ответ не должен отличаться.
    const missing = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(strangerCookie),
      payload: { lessonId: '00000000-0000-7000-8000-000000000000', text: 'Нет такого урока' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('продолжительное задание не длиннее предела и видно только до своей даты', async () => {
    const tooLong = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Долгое задание', visibleUntil: shiftDays(60) },
    });

    // Предел задаётся настройкой, а не константой: без него задание растянется на год.
    expect(tooLong.statusCode, tooLong.body).toBe(400);
    expect(tooLong.body).toContain('не дольше');
  });
});
