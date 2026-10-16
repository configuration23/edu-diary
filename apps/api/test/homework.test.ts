import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, completeSetup, createTestApp, type TestApp } from './helpers/api';
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
});
