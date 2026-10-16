import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, completeSetup, createTestApp, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';
import { createLessonContext, factories, injectClient } from './helpers/factories';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/** Проба: какие запросы к списку заданий проходят, а какие отвечают 400. */

function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

describeWithDatabase('проба: список заданий', () => {
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
      institution: { title: 'Колледж', shortName: 'К', signature: 'Д' },
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
      run: 'СПИСОК',
      yearStartsOn: shiftDays(-200),
      yearEndsOn: shiftDays(200),
      withStudent: true,
      lessonDate: shiftDays(-1),
    });

    lessonId = created.lesson?.id ?? '';
    groupId = created.group.id;
    teacherCookie = created.teacher.cookie;

    const login = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: created.student?.username ?? '',
        password: created.student?.password ?? '',
      },
    });
    const cookie = login.cookies.find((item) => item.name === 'edu_diary_session');
    studentCookie = cookie === undefined ? '' : `${cookie.name}=${cookie.value}`;

    const assignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: { cookie: teacherCookie },
      payload: { lessonId, text: 'Задание для проверки списка' },
    });
    expect(assignment.statusCode, assignment.body).toBe(201);
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('варианты запроса', async () => {
    const urls = [
      '/api/homework',
      '/api/homework?onDate=' + shiftDays(-1),
      '/api/homework?onDate=2026-10-20',
      '/api/homework?onDate=2026-10-20&limit=50',
      '/api/homework?studyGroupId=' + groupId,
      '/api/homework?studyGroupId=',
      '/api/homework?onDate=2026-13-45',
    ];

    for (const url of urls) {
      const response = await testApp.app.inject({
        method: 'GET',
        url,
        headers: { cookie: studentCookie },
      });
      console.log('ПРОБА', response.statusCode, url, response.body.slice(0, 160));
    }

    const asTeacher = await testApp.app.inject({
      method: 'GET',
      url: '/api/homework?onDate=2026-10-20',
      headers: { cookie: teacherCookie },
    });
    console.log('ПРОБА УЧИТЕЛЬ', asTeacher.statusCode, asTeacher.body.slice(0, 160));
  });
});
