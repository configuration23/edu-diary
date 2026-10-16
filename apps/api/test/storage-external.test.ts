import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, completeSetup, createTestApp, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Проверка **полного пути** через приложение на внешнем хранилище.
 *
 * Тест адаптера проверяет адаптер. Здесь проверяется другое: что заданные в настройках
 * параметры (включая регион) действительно приводят к записи файла — то есть тот же путь,
 * которым пойдёт вложение домашнего задания.
 */

const s3 = {
  endpoint: process.env.S3_TEST_ENDPOINT ?? '',
  bucket: process.env.S3_TEST_BUCKET ?? '',
  accessKey: process.env.S3_TEST_ACCESS_KEY ?? '',
  secretKey: process.env.S3_TEST_SECRET_KEY ?? '',
  region: process.env.S3_TEST_REGION ?? 'us-east-1',
};

const hasS3 = Object.values(s3).every((value) => value !== '');

function multipartBody(fileName: string, content: Buffer): { body: Buffer; boundary: string } {
  const boundary = '----seaweed-boundary';
  const head = Buffer.from(
    `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `content-type: application/octet-stream\r\n\r\n`,
  );

  return {
    body: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    boundary,
  };
}

describe.skipIf(!hasTestDatabase || !hasS3)('внешнее хранилище через приложение', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);

    ({ cookie: adminCookie } = await completeSetup(testApp.app, {
      institution: { title: 'Колледж', shortName: 'К', signature: 'Д' },
      academicYear: { title: 'Год', startsOn: '2026-09-01', endsOn: '2027-06-30' },
      period: { title: 'Семестр', kind: 'semester', startsOn: '2026-09-01', endsOn: '2026-12-31' },
      admin: { username: 'admin', fullName: 'Администратор', password: ADMIN_PASSWORD },
    }));

    /** Настройки как их задаст администратор в форме: тип, адрес, bucket, регион, ключи. */
    const saved = await testApp.app.inject({
      method: 'PUT',
      url: '/api/settings/storage',
      headers: { cookie: adminCookie },
      payload: {
        provider: 's3',
        endpoint: s3.endpoint,
        bucket: s3.bucket,
        region: s3.region,
        accessKey: s3.accessKey,
        secretKey: s3.secretKey,
        maxFileMb: 10,
      },
    });

    console.log('СОХРАНЕНИЕ:', saved.statusCode, saved.body.slice(0, 300));
    expect(saved.statusCode, saved.body).toBe(200);
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('проверка подключения из формы проходит', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/settings/storage/test',
      headers: { cookie: adminCookie },
      payload: {},
    });

    console.log('ПРОВЕРКА:', response.statusCode, response.body.slice(0, 300));
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json() as { ok: boolean; message: string; checked: string };

    expect(result.ok, result.message).toBe(true);
    expect(result.checked).toContain('S3');
  });

  it('файл загружается в внешнее хранилище и читается обратно', async () => {
    const { body, boundary } = multipartBody('решение.txt', Buffer.from('файл в SeaweedFS'));

    const upload = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework/files',
      headers: {
        cookie: adminCookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(upload.statusCode, upload.body).toBe(201);
    const fileId = (upload.json() as { id: string }).id;

    const read = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/files/${fileId}`,
      headers: { cookie: adminCookie },
    });

    expect(read.statusCode, read.body).toBe(200);
    expect(read.body).toContain('файл в SeaweedFS');
  });
});
