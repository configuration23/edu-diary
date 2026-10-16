import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, completeSetup, createTestApp, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';
import { createLessonContext, factories, injectClient } from './helpers/factories';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Сдача решения учеником.
 *
 * Правила владельца: одна попытка, черновика нет, после срока сдавать можно с пометкой
 * опоздания, факт сдачи оценку **не** ставит.
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

/** Собрать тело multipart: приём файлов проверяется отдельно, здесь нужен один файл. */
function multipartBody(fileName: string, content: Buffer): { body: Buffer; boundary: string } {
  const boundary = '----edu-diary-submit-boundary';
  const head = Buffer.from(
    `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `content-type: application/octet-stream\r\n\r\n`,
  );

  return {
    body: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    boundary,
  };
}

describeWithDatabase('сдача решения', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;
  let lessonId: string;
  let assignmentId: string;

  const auth = (cookie: string) => ({ cookie });

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
      run: 'СДАЧА',
      yearStartsOn: shiftDays(-200),
      yearEndsOn: shiftDays(200),
      withStudent: true,
      lessonDate: shiftDays(-2),
    });

    lessonId = created.lesson?.id ?? '';
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

    // Срок уже прошёл: это и позволяет проверить пометку опоздания.
    const assignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Прочитать главу 3', dueOn: shiftDays(-1) },
    });
    expect(assignment.statusCode, assignment.body).toBe(201);
    assignmentId = (assignment.json() as Json).id as string;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('ученик видит задание своего урока и может сдавать', async () => {
    const state = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/${assignmentId}/submission`,
      headers: auth(studentCookie),
    });

    expect(state.statusCode, state.body).toBe(200);
    const body = state.json() as Json;
    expect(body.canSubmit).toBe(true);
    expect(body.own).toBeNull();
    // Срок отдаётся ученику: без него непонятно, «сдать до» — это когда.
    expect(body.dueOn).toBe(shiftDays(-1));
  });

  it('пустое решение не принимается', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: `/api/homework/${assignmentId}/submission`,
      headers: auth(studentCookie),
      payload: { text: '   ', fileIds: [] },
    });

    expect(response.statusCode, response.body).toBe(400);
  });

  it('ученик сдаёт решение позже срока — это разрешено и помечено', async () => {
    const { body, boundary } = multipartBody('решение.txt', Buffer.from('Мой ответ на главу 3'));

    const file = await testApp.app.inject({
      method: 'POST',
      /** kind=submission: файл решения — это не материал задания, и таблицы у них разные. */
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
      payload: { text: 'Ответ во вложении', fileIds: [fileId] },
    });
    expect(submitted.statusCode, submitted.body).toBe(201);

    const state = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/${assignmentId}/submission`,
      headers: auth(studentCookie),
    });
    const own = (state.json() as Json).own as Json;

    /** Сдача после срока **разрешена**, но помечена: не наказываем, но показываем факт. */
    expect(own.isLate).toBe(true);
    expect(own.text).toBe('Ответ во вложении');
    /**
     * Вложение решения привязано к сдаче: файл загружается **до** отправки, поэтому
     * проверяем, что он не потерялся.
     */
    expect((own.files as Json[]).length).toBe(1);
  });

  it('вторая попытка не принимается: попытка одна', async () => {
    const second = await testApp.app.inject({
      method: 'POST',
      url: `/api/homework/${assignmentId}/submission`,
      headers: auth(studentCookie),
      payload: { text: 'Ещё один вариант' },
    });

    // Проверка на сервере, а не в интерфейсе: повторное нажатие не создаёт второе решение.
    expect(second.statusCode, second.body).toBe(409);
    expect(second.body).toContain('уже отправлено');
  });

  it('учитель видит сдавшего, а чужой ученик — нет', async () => {
    const list = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/${assignmentId}/submissions`,
      headers: auth(teacherCookie),
    });

    console.log('СПИСОК СДАВШИХ:', list.statusCode, list.body.slice(0, 200));
    expect(list.statusCode, list.body).toBe(200);
    const items = (list.json() as { items: Json[] }).items;
    expect(items.length).toBe(1);
    expect(items[0]?.studentName).toContain('СДАЧА');

    // Ученик список сдавших не получает: это чужие работы.
    const asStudent = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/${assignmentId}/submissions`,
      headers: auth(studentCookie),
    });
    expect([403, 404]).toContain(asStudent.statusCode);
  });
});
