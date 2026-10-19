import { sql } from 'drizzle-orm';
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
 * Домашние задания: постановка, права и видимость.
 *
 * Модель **без дат**: у задания есть **урок-срок** — до какого занятия оно задано. Ученик
 * видит задание в уроке-сроке и во всех промежуточных уроках, поэтому «долгая домашка и
 * короткая рядом» не мешают друг другу: у каждой свой срок.
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

/** Собрать тело multipart: проверяем ответ с вложением, значит файл надо приложить. */
function multipartBody(fileName: string, content: Buffer): { body: Buffer; boundary: string } {
  const boundary = '----homework-boundary';
  const head = Buffer.from(
    `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `content-type: application/octet-stream\r\n\r\n`,
  );

  return {
    body: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    boundary,
  };
}
describeWithDatabase('домашние задания', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;
  let lessonId: string;
  let groupId: string;
  let lessonDate: string;
  let dueLessonId: string;
  let dueLessonDate: string;

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
      run: 'ДЗ',
      yearStartsOn: shiftDays(-200),
      yearEndsOn: shiftDays(200),
      withStudent: true,
      lessonDate: shiftDays(-7),
    });

    lessonId = created.lesson?.id ?? '';
    groupId = created.group.id;
    lessonDate = shiftDays(-7);
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

    /** Второй урок того же предмета: он станет уроком-сроком. */
    const second = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: auth(adminCookie),
      payload: {
        studyGroupId: groupId,
        subjectId: created.subject.id,
        teacherUserId: created.teacher.id,
        lessonDate: shiftDays(-1),
        pairNumber: 1,
        timeStart: '08:30',
        timeEnd: '10:00',
      },
    });
    expect(second.statusCode, second.body).toBe(201);
    dueLessonId = (second.json() as Json).id as string;
    dueLessonDate = shiftDays(-1);

    /** Хранилище — временный каталог: пустой путь означал бы корень проекта. */
    await configureTestStorage(testApp.app, adminCookie);
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('учитель даёт список ближайших уроков для выбора срока', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${lessonId}`,
      headers: auth(teacherCookie),
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { dueOptions: Json[] };

    /**
     * Список **вместо полей с датами**: датами оперировать неудобно, и учитель указывает
     * совсем другие числа. В списке — уроки того же предмета и группы после текущего.
     */
    expect(body.dueOptions.length).toBeGreaterThanOrEqual(1);
    expect(body.dueOptions[0]?.lessonDate).toBe(dueLessonDate);
  });

  it('учитель ставит задание; оно видно в своём уроке и в уроке-сроке', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: {
        lessonId,
        dueLessonId,
        text: 'Прочитать главу 3 и ответить на вопросы',
      },
    });

    expect(response.statusCode, response.body).toBe(201);

    /** Учитель видит задание **в своём уроке**: «когда задал». */
    const own = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${lessonId}`,
      headers: auth(teacherCookie),
    });
    const ownBody = own.json() as { assignedHere: Json[]; dueHere: Json[] };
    expect(ownBody.assignedHere).toHaveLength(1);
    expect(ownBody.assignedHere[0]?.text).toContain('главу 3');
    // Учителю сразу видно, сколько учеников должны сдать.
    expect(ownBody.assignedHere[0]?.studentCount).toBe(1);

    /** И **в уроке-сроке**: это то, что он проверяет на занятии сдачи. */
    const due = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${dueLessonId}`,
      headers: auth(teacherCookie),
    });
    const dueBody = due.json() as { assignedHere: Json[]; dueHere: Json[] };
    expect(dueBody.dueHere).toHaveLength(1);
    /** Учитель должен понимать, что это задание **из прошлого** урока. */
    expect(dueBody.dueHere[0]?.lessonDate).toBe(lessonDate);
    // А задано на нём ничего не было.
    expect(dueBody.assignedHere).toHaveLength(0);
  });

  it('на один урок можно задать несколько работ: они не затирают друг друга', async () => {
    /**
     * Долгий проект и короткая задача к тому же занятию — **разные задания** с разными
     * сдачами. Раньше их запрещала уникальность «один урок — одно задание», и это мешало
     * реальной работе.
     */
    const project = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Подготовить доклад к занятию', dueLessonId },
    });

    expect(project.statusCode, project.body).toBe(201);

    const own = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${lessonId}`,
      headers: auth(teacherCookie),
    });
    const body = own.json() as { assignedHere: Json[] };
    expect(body.assignedHere).toHaveLength(2);
  });

  it('пустое задание не принимается', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: '   ' },
    });

    expect(response.statusCode, response.body).toBe(400);
  });

  it('ученик видит задание своей группы и не может его поставить', async () => {
    const list = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework?from=${dueLessonDate}&to=${dueLessonDate}`,
      headers: auth(studentCookie),
    });

    expect(list.statusCode, list.body).toBe(200);
    const items = (list.json() as { items: Json[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(1);

    /**
     * Ученик решение **отправляет** (`homework:write` с областью `own`), но задание не
     * ставит: для постановки нужна область `assigned`.
     */
    const attempt = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(studentCookie),
      payload: { lessonId, text: 'Я тоже хочу задать задание' },
    });

    expect(attempt.statusCode, attempt.body).toBe(403);
  });

  it('чужой урок: задание не ставится, ответ не отличается от «не найдено»', async () => {
    const stranger = await testApp.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(adminCookie),
      payload: {
        mustChangePassword: false,
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
      payload: {
        lessonId: '00000000-0000-7000-8000-000000000000',
        text: 'Нет такого урока',
      },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('без выбора срока подставляется следующий урок по расписанию', async () => {
    const created = await createLessonContext(factories(injectClient(testApp.app), adminCookie), {
      run: 'СЛЕД',
      yearStartsOn: shiftDays(-200),
      yearEndsOn: shiftDays(200),
      lessonDate: shiftDays(-7),
    });

    const second = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: auth(adminCookie),
      payload: {
        studyGroupId: created.group.id,
        subjectId: created.subject.id,
        teacherUserId: created.teacher.id,
        lessonDate: shiftDays(-1),
        pairNumber: 2,
        timeStart: '10:10',
        timeEnd: '11:40',
      },
    });
    expect(second.statusCode, second.body).toBe(201);
    const nextId = (second.json() as Json).id as string;

    const assignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(created.teacher.cookie),
      payload: { lessonId: created.lesson?.id ?? '', text: 'Задание без выбора срока' },
    });
    expect(assignment.statusCode, assignment.body).toBe(201);

    const lesson = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${created.lesson?.id ?? ''}`,
      headers: auth(created.teacher.cookie),
    });
    const body = lesson.json() as { assignedHere: Json[] };

    /** Срок — **следующий урок** того же предмета: домашка задаётся на следующий раз. */
    expect(body.assignedHere[0]?.dueLessonId).toBe(nextId);
  });

  it('срок должен быть уроком того же предмета и группы', async () => {
    const other = await createLessonContext(factories(injectClient(testApp.app), adminCookie), {
      run: 'ЧУЖОЙ',
      yearStartsOn: shiftDays(-200),
      yearEndsOn: shiftDays(200),
      lessonDate: shiftDays(-1),
    });

    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: {
        lessonId,
        dueLessonId: other.lesson?.id ?? '',
        text: 'Задание с чужим сроком',
      },
    });

    // Срок из другой группы или другого предмета — отказ: домашка не может «сдаваться» там.
    expect(response.statusCode, response.body).toBe(400);
  });
  it('задание с файлом отдаётся по контракту: ответ проходит проверку схемы', async () => {
    /**
     * Тест, которого не хватало. На стенде маршрут журнала отвечал `400`: контракт требует у
     * вложения поле `createdAt`, а сервис его не отдавал. Скрылось это потому, что **все
     * прежние проверки создавали задания без файлов** — список вложений был пуст, и
     * расхождение формы не проявлялось.
     *
     * Поэтому здесь файл **прикладывается**, а ответ разбирается схемой клиента.
     */
    const { lessonHomeworkResponseSchema } = await import('@edu-diary/contracts');

    const material = multipartBody('материал.txt', Buffer.from('материалы к заданию'));
    const upload = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework/files',
      headers: {
        cookie: teacherCookie,
        'content-type': `multipart/form-data; boundary=${material.boundary}`,
      },
      payload: material.body,
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const fileId = (upload.json() as Json).id as string;

    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Задание с файлом', fileIds: [fileId] },
    });
    expect(created.statusCode, created.body).toBe(201);

    const lesson = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${lessonId}`,
      headers: auth(teacherCookie),
    });

    expect(lesson.statusCode, lesson.body).toBe(200);

    /** Разбор той же схемой, что у клиента: расхождение формы станет падением, а не `400`. */
    const parsed = lessonHomeworkResponseSchema.safeParse(lesson.json());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('учитель правит задание: изменение записывается в аудит с «до» и «после»', async () => {
    /**
     * Спор «я этого не менял» решается фактами. Поэтому проверяем не только то, что задание
     * изменилось, но и то, что в аудите остались **прежнее и новое** состояния.
     */
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Задание до правки', dueLessonId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const assignmentId = (created.json() as Json).id as string;

    const updated = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/homework/${assignmentId}`,
      headers: auth(teacherCookie),
      payload: { text: 'Задание после правки' },
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const lesson = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${lessonId}`,
      headers: auth(teacherCookie),
    });
    const items = (lesson.json() as { assignedHere: Json[] }).assignedHere;
    expect(items.find((item) => item.id === assignmentId)?.text).toBe('Задание после правки');

    /** Аудит: запись должна содержать и прежнее состояние, и новое. */
    const audit = await testApp.app.inject({
      method: 'GET',
      url: `/api/audit?entityKind=homework_assignment&entityId=${assignmentId}`,
      headers: auth(adminCookie),
    });
    expect(audit.statusCode, audit.body).toBe(200);

    const entries = (audit.json() as { items: Json[] }).items;
    const edit = entries.find((entry) => entry.action === 'update');
    expect(edit, JSON.stringify(entries)).toBeDefined();
    expect(edit?.before).toMatchObject({ dueLessonId });
    expect(edit?.after).toMatchObject({ dueLessonId });
  });

  it('учитель убирает задание: оно скрывается, а запись в аудите остаётся', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Задание под удаление', dueLessonId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const assignmentId = (created.json() as Json).id as string;

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/homework/${assignmentId}`,
      headers: auth(teacherCookie),
    });
    expect(removed.statusCode, removed.body).toBe(200);

    const lesson = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${lessonId}`,
      headers: auth(teacherCookie),
    });
    const items = (lesson.json() as { assignedHere: Json[] }).assignedHere;
    expect(items.some((item) => item.id === assignmentId)).toBe(false);

    /** Удаление **мягкое**: задание скрыто у группы, но запись в аудите осталась. */
    const audit = await testApp.app.inject({
      method: 'GET',
      url: `/api/audit?entityKind=homework_assignment&entityId=${assignmentId}`,
      headers: auth(adminCookie),
    });
    const entries = (audit.json() as { items: Json[] }).items;
    expect(entries.some((entry) => entry.action === 'delete')).toBe(true);
  });

  it('чужое задание не правится и не удаляется', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Задание чужого преподавателя', dueLessonId },
    });
    const assignmentId = (created.json() as Json).id as string;

    const stranger = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'prepod-chuzhoy', password: 'kolledzh-chuzhoy-2025' },
    });
    const cookie = stranger.cookies.find((item) => item.name === 'edu_diary_session');
    const strangerCookie = cookie === undefined ? '' : `${cookie.name}=${cookie.value}`;

    /** Ответ тот же, что на несуществующее задание: чужие задания не выдают себя. */
    const patch = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/homework/${assignmentId}`,
      headers: auth(strangerCookie),
      payload: { text: 'Правка чужого задания' },
    });
    expect(patch.statusCode, patch.body).toBe(404);

    const remove = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/homework/${assignmentId}`,
      headers: auth(strangerCookie),
    });
    expect(remove.statusCode, remove.body).toBe(404);
  });

  it('убрать файл из задания: файл помечается, а не стирается', async () => {
    /**
     * Решение владельца: файлы **не стираем**, ставим пометку — как с отметками в журнале.
     * Поэтому проверяем две вещи: файл исчез из задания и он **остался в базе** помеченным.
     */
    const material = multipartBody('убрать.txt', Buffer.from('файл под удаление'));
    const upload = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework/files',
      headers: {
        cookie: teacherCookie,
        'content-type': `multipart/form-data; boundary=${material.boundary}`,
      },
      payload: material.body,
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const fileId = (upload.json() as Json).id as string;

    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/homework',
      headers: auth(teacherCookie),
      payload: { lessonId, text: 'Задание с файлом под удаление', fileIds: [fileId] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const assignmentId = (created.json() as Json).id as string;

    /** В форме учитель снимает галочку: `keepFileIds` пустой — файл убран. */
    const updated = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/homework/${assignmentId}`,
      headers: auth(teacherCookie),
      payload: { keepFileIds: [] },
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const lesson = await testApp.app.inject({
      method: 'GET',
      url: `/api/homework/lesson/${lessonId}`,
      headers: auth(teacherCookie),
    });
    const items = (lesson.json() as { assignedHere: Json[] }).assignedHere;
    const assignment = items.find((item) => item.id === assignmentId);

    expect(assignment, JSON.stringify(items)).toBeDefined();
    expect(assignment?.files).toEqual([]);

    /** Файл **не стёрт**: он помечен удалённым, и это видно в базе. */
    const rows = await database.db.orm.execute(
      sql`select deleted_at from homework_assignment_file where id = ${fileId}`,
    );
    const row = (rows as unknown as { deleted_at: string | null }[])[0];
    expect(row?.deleted_at).not.toBeNull();
  });
});
