import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, completeSetup, createTestApp, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';
import { createLessonContext, factories, injectClient } from './helpers/factories';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * «Сданные работы»: видит ли преподаватель работу ученика.
 *
 * Тест вырос из дефекта, найденного владельцем: ученик прикладывал задание, а преподаватель
 * работу не видел и ошибок в консоли не было. Причин оказалось две, и обе закреплены здесь:
 * у преподавателя нет «своих» групп в ученическом смысле (группа выбирается явно), и строка
 * ответа имеет **свою** форму без ssignmentId — он есть у карточки задания.
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

function multipartBody(fileName: string, content: Buffer): { body: Buffer; boundary: string } {
  const boundary = '----probe-submitted-boundary';
  const head = Buffer.from(
    `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `content-type: application/octet-stream\r\n\r\n`,
  );

  return {
    body: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    boundary,
  };
}

describeWithDatabase('сданные работы', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;
  let lessonId: string;
  let dueLessonDate: string;
  let groupId: string;

  const auth = (cookie: string) => ({ cookie });

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
      run: 'СДАННЫЕ',
      yearStartsOn: shiftDays(-200),
      yearEndsOn: shiftDays(200),
      withStudent: true,
      lessonDate: shiftDays(-2),
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

    /** Срок — **вчера**: именно на эту дату преподаватель будет смотреть работы. */
    dueLessonDate = shiftDays(-1);

    const second = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: auth(adminCookie),
      payload: {
        studyGroupId: created.group.id,
        subjectId: created.subject.id,
        teacherUserId: created.teacher.id,
        lessonDate: dueLessonDate,
        pairNumber: 1,
        timeStart: '08:30',
        timeEnd: '10:00',
      },
    });
    expect(second.statusCode, second.body).toBe(201);
    const dueLessonId = (second.json() as Json).id as string;

    const assignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, dueLessonId, text: 'Задание на вчера' },
    });
    expect(assignment.statusCode, assignment.body).toBe(201);
    const assignmentId = (assignment.json() as Json).id as string;

    const { body, boundary } = multipartBody('ответ.txt', Buffer.from('моё решение'));
    const file = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework/submission-files',
      headers: {
        cookie: studentCookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(file.statusCode, file.body).toBe(201);
    const fileId = (file.json() as Json).id as string;

    const submitted = await testApp.app.inject({
      method: 'POST',
      url: `/api/homework/${assignmentId}/submission`,
      headers: auth(studentCookie),
      payload: { text: 'Мой ответ', fileIds: [fileId] },
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('преподаватель видит работу в разделе «Сданные работы»', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      /**
       * Группа указывается явно — как и в интерфейсе: без неё преподавателю взять её неоткуда,
       * у него нет «своих» групп в ученическом смысле.
       */
      url: `/api/homework/submissions?studyGroupId=${groupId}&from=${dueLessonDate}&to=${dueLessonDate}`,
      headers: auth(teacherCookie),
    });

    expect(response.statusCode, response.body).toBe(200);

    const items = (response.json() as { items: Json[] }).items;
    expect(items.length, response.body.slice(0, 700)).toBeGreaterThanOrEqual(1);

    const rows = items[0]?.rows as Json[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.submission).not.toBeNull();
  });
});
