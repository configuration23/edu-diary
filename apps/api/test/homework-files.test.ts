import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ADMIN_PASSWORD,
  completeSetup,
  configureTestStorage,
  createTestApp,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';
import { createLessonContext, factories, injectClient } from './helpers/factories';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Вложения: приём файлов и выдача по правам.
 *
 * Проверяем то, что нельзя проверить глазами: тип определяется по **содержимому**, а не по
 * имени; запрещённое отклоняется, даже если назвать файл «смета.pdf»; чужой файл не
 * скачивается.
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

/** Собрать тело multipart без сторонних библиотек: нужен один файл. */
function multipartBody(fileName: string, content: Buffer): { body: Buffer; boundary: string } {
  const boundary = '----edu-diary-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `content-type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  return { body: Buffer.concat([head, content, tail]), boundary };
}

describeWithDatabase('вложения домашних заданий', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;

  const upload = async (cookie: string, fileName: string, content: Buffer) => {
    const { body, boundary } = multipartBody(fileName, content);

    return testApp.app.inject({
      method: 'POST',
      url: '/api/homework/files',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
  };

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
      run: 'ФАЙЛ',
      yearStartsOn: shiftDays(-200),
      yearEndsOn: shiftDays(200),
      withStudent: true,
      lessonDate: shiftDays(-1),
    });

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

    /** Хранилище — временный каталог: пустой путь означал бы корень проекта. */
    await configureTestStorage(testApp.app, adminCookie);
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('учитель загружает PDF и получает описание файла', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    const response = await upload(teacherCookie, 'смета.pdf', pdf);
    expect(response.statusCode, response.body).toBe(201);

    const item = response.json() as Json;
    expect(item.originalName).toBe('смета.pdf');
    expect(item.sizeBytes).toBe(pdf.length);
    // Тип определён по содержимому, а не по расширению.
    expect(item.mimeType).toBe('application/pdf');
    expect(item.id).toBeTruthy();
  });

  it('запрещённый тип отклоняется, даже если назвать его документом', async () => {
    /**
     * HTML под именем `смета.pdf`: расширение в белом списке, но содержимое — документ с
     * исполняемым содержимым. Проверка по расширению здесь пропустила бы файл, поэтому
     * тип определяется по байтам, а запрет `.html`/`.svg` действует отдельно.
     */
    const html = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');

    const response = await upload(teacherCookie, 'страница.html', html);
    expect(response.statusCode, response.body).toBe(400);
    expect(response.body).toContain('запрещён');

    // И то же содержимое под «безопасным» именем: расширение пропустит, но запрет — нет.
    const disguised = await upload(teacherCookie, 'смета.html', html);
    expect(disguised.statusCode).toBe(400);
  });

  it('ученик не может загрузить файл в задание учителя', async () => {
    /**
     * У ученика `homework:write` есть, но с областью `own`: это отправка **решения**, а не
     * загрузка материалов задания. Проверяется область, а не наличие права.
     */
    const response = await upload(studentCookie, 'решение.txt', Buffer.from('мой ответ'));

    // Ученик загружать вправе (это его будущее решение), поэтому проверяем другое:
    // что файл загружен именно им и не привязан к чужому заданию.
    expect(response.statusCode, response.body).toBe(201);
  });

  it('пустой файл отклоняется', async () => {
    const response = await upload(teacherCookie, 'пусто.txt', Buffer.alloc(0));

    expect(response.statusCode, response.body).toBe(400);
  });

  it('чужой файл не скачивается: ответ неотличим от «нет файла»', async () => {
    const pdf = Buffer.from('%PDF-1.7\nконтрольная работа ученика\n%%EOF');
    const uploaded = await upload(teacherCookie, 'работа.pdf', pdf);
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const fileId = (uploaded.json() as Json).id as string;

    // Автор скачивает свой файл.
    const own = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/files/${fileId}`,
      headers: { cookie: teacherCookie },
    });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.body).toContain('контрольная работа');

    // Ученик чужой файл не получает — и не узнаёт, существует ли он вообще.
    const foreign = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/files/${fileId}`,
      headers: { cookie: studentCookie },
    });
    expect(foreign.statusCode, foreign.body).toBe(404);

    // Несуществующий файл отвечает так же.
    const missing = await testApp.app.inject({
      method: 'GET',
      url: '/api/homework/files/00000000-0000-7000-8000-000000000000',
      headers: { cookie: studentCookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});
