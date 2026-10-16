import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ADMIN_PASSWORD,
  completeSetup,
  createTestApp,
  createUserAndLogin,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Новости заведения (Этап 6).
 *
 * Решения владельца: публикует **администратор** (и будущая роль директора), видны **всем
 * вошедшим**, править и убирать можно. Здесь проверяются именно эти правила — и то, что чужая
 * роль не может публиковать.
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

describeWithDatabase('новости заведения', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;

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

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-news',
      fullName: 'Преподаватель Новостей',
      password: 'kollegiya-vesna-2025',
      roles: ['teacher'],
    });
    teacherCookie = teacher.cookie;

    const student = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'uchenik-news',
      fullName: 'Ученик Новостей',
      password: 'kollegiya-osen-2025',
      roles: ['student'],
    });
    studentCookie = student.cookie;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('администратор публикует новость, её видит и ученик', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/news',
      headers: auth(adminCookie),
      payload: { title: 'Первое сентября', body: 'Торжественная линейка в 9:00.' },
    });
    expect(created.statusCode, created.body).toBe(201);

    const forAdmin = await testApp.app.inject({
      method: 'GET',
      url: '/api/news',
      headers: auth(adminCookie),
    });
    expect(forAdmin.statusCode, forAdmin.body).toBe(200);
    expect((forAdmin.json() as { items: Json[] }).items[0]?.title).toBe('Первое сентября');

    /** Новости видны **всем вошедшим** — ученику тоже. */
    const forStudent = await testApp.app.inject({
      method: 'GET',
      url: '/api/news',
      headers: auth(studentCookie),
    });
    expect(forStudent.statusCode, forStudent.body).toBe(200);
    expect((forStudent.json() as { items: Json[] }).items).toHaveLength(1);
  });

  it('преподаватель и ученик читают новости, но не публикуют', async () => {
    for (const cookie of [teacherCookie, studentCookie]) {
      const list = await testApp.app.inject({
        method: 'GET',
        url: '/api/news',
        headers: auth(cookie),
      });
      expect(list.statusCode, list.body).toBe(200);

      /** Публикация — отдельное право `news:write`: у роли его нет. */
      const attempt = await testApp.app.inject({
        method: 'POST',
        url: '/api/news',
        headers: auth(cookie),
        payload: { title: 'Не моя новость', body: 'Я не должен это публиковать' },
      });
      expect(attempt.statusCode, attempt.body).toBe(403);
    }
  });

  it('будущая новость не показывается, но видна на странице настроек', async () => {
    /**
     * Новость можно подготовить заранее. В показе её быть не должно, а в правке — обязана быть,
     * иначе подготовленную новость нельзя будет найти и поправить.
     */
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/news',
      headers: auth(adminCookie),
      payload: {
        title: 'Заготовка на будущее',
        body: 'Эта новость появится позже.',
        publishedOn: shiftDays(30),
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    const shown = await testApp.app.inject({
      method: 'GET',
      url: '/api/news',
      headers: auth(adminCookie),
    });
    const titles = (shown.json() as { items: Json[] }).items.map((item) => item.title);
    expect(titles).not.toContain('Заготовка на будущее');

    const editing = await testApp.app.inject({
      method: 'GET',
      url: '/api/news?forEditing=true',
      headers: auth(adminCookie),
    });
    const editingTitles = (editing.json() as { items: Json[] }).items.map((item) => item.title);
    expect(editingTitles).toContain('Заготовка на будущее');

    /** Ученику список правки закрыт: он показывает и просроченное, и подготовленное. */
    const studentEditing = await testApp.app.inject({
      method: 'GET',
      url: '/api/news?forEditing=true',
      headers: auth(studentCookie),
    });
    expect(studentEditing.statusCode, studentEditing.body).toBe(403);
  });

  it('новость с истёкшим сроком показа не показывается', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/news',
      headers: auth(adminCookie),
      payload: {
        title: 'Объявление на один день',
        body: 'Действовало вчера.',
        publishedOn: shiftDays(-3),
        visibleUntil: shiftDays(-1),
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    const shown = await testApp.app.inject({
      method: 'GET',
      url: '/api/news',
      headers: auth(adminCookie),
    });
    const titles = (shown.json() as { items: Json[] }).items.map((item) => item.title);
    expect(titles).not.toContain('Объявление на один день');
  });

  it('новость правится и убирается, изменения попадают в аудит', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/news',
      headers: auth(adminCookie),
      payload: { title: 'Черновик', body: 'Текст до правки.' },
    });
    const newsId = (created.json() as Json).id as string;

    const patched = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/news/${newsId}`,
      headers: auth(adminCookie),
      payload: { title: 'Готово', body: 'Текст после правки.' },
    });
    expect(patched.statusCode, patched.body).toBe(200);

    const list = await testApp.app.inject({
      method: 'GET',
      url: '/api/news',
      headers: auth(adminCookie),
    });
    const found = (list.json() as { items: Json[] }).items.find((item) => item.id === newsId);
    expect(found?.title).toBe('Готово');

    /** В аудите должны остаться **прежнее и новое** состояния: спор решается фактами. */
    const audit = await testApp.app.inject({
      method: 'GET',
      url: `/api/audit?entityKind=news_item&entityId=${newsId}`,
      headers: auth(adminCookie),
    });
    expect(audit.statusCode, audit.body).toBe(200);
    const entries = (audit.json() as { items: Json[] }).items;
    expect(entries.some((entry) => entry.action === 'update')).toBe(true);

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/news/${newsId}`,
      headers: auth(adminCookie),
    });
    expect(removed.statusCode, removed.body).toBe(200);

    const afterRemove = await testApp.app.inject({
      method: 'GET',
      url: '/api/news',
      headers: auth(adminCookie),
    });
    const remaining = (afterRemove.json() as { items: Json[] }).items.map((item) => item.id);
    expect(remaining).not.toContain(newsId);
  });

  it('чужой не может править и удалять новость', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/news',
      headers: auth(adminCookie),
      payload: { title: 'Новость администратора', body: 'Текст.' },
    });
    const newsId = (created.json() as Json).id as string;

    const patch = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/news/${newsId}`,
      headers: auth(teacherCookie),
      payload: { title: 'Правка чужой новости' },
    });
    expect(patch.statusCode, patch.body).toBe(403);

    const remove = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/news/${newsId}`,
      headers: auth(studentCookie),
    });
    expect(remove.statusCode, remove.body).toBe(403);
  });

  it('пустой заголовок не принимается', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/news',
      headers: auth(adminCookie),
      payload: { title: '   ', body: 'Текст есть, заголовка нет.' },
    });
    expect(created.statusCode, created.body).toBe(400);
  });
});
