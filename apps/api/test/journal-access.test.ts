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
 * Доступ преподавателя к журналу урока (ADR-005, область `assigned`).
 *
 * Дефект, из-за которого появилась эта проверка: любой преподаватель открывал журнал
 * **любого** урока и мог ставить и удалять там оценки. Право `grades:write` с областью
 * `assigned` означает «уроки этого преподавателя», а не «все уроки».
 *
 * Проверяем границу: чужой урок для преподавателя не существует (404), свой — работает,
 * администратор по-прежнему может всё.
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

describeWithDatabase('доступ преподавателя к журналу', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let secondTeacherCookie: string;
  let subjectId: string;
  let ownLessonId: string;
  let foreignLessonId: string;
  let studentId: string;
  let reasonId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);

    ({ cookie: adminCookie } = await completeSetup(testApp.app, {
      institution: { title: 'Тестовый колледж', shortName: 'ТК', signature: 'Дневник колледжа' },
      academicYear: { title: 'Текущий год', startsOn: shiftDays(-200), endsOn: shiftDays(200) },
      period: {
        title: 'Текущий семестр',
        kind: 'semester',
        startsOn: shiftDays(-100),
        endsOn: shiftDays(100),
      },
      admin: { username: 'admin', fullName: 'Администратор Системы', password: ADMIN_PASSWORD },
    }));

    const admin = { cookie: adminCookie };

    const years = await testApp.app.inject({
      method: 'GET',
      url: '/api/academic-years',
      headers: admin,
    });
    const year = (
      years.json() as { items: Array<{ id: string; startsOn: string; endsOn: string }> }
    ).items[0];

    const first = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-pervyy',
      fullName: 'Первый Преподаватель',
      password: 'kolledzh-pervyy-2025',
      roles: ['teacher'],
    });
    teacherCookie = first.cookie;

    const second = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-vtoroy',
      fullName: 'Второй Преподаватель',
      password: 'kolledzh-vtoroy-2025',
      roles: ['teacher'],
    });
    secondTeacherCookie = second.cookie;

    const group = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: admin,
      payload: {
        academicYearId: year?.id ?? '',
        name: 'ДП-11',
        startsOn: year?.startsOn ?? shiftDays(-100),
        endsOn: year?.endsOn ?? shiftDays(100),
      },
    });
    const groupId = (group.json() as Json).id as string;

    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: admin,
      payload: { name: 'Русский язык', shortName: 'РУС', kind: 'mandatory' },
    });
    subjectId = (subject.json() as Json).id as string;

    const student = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: admin,
      payload: {
        fullName: 'Ученик Доступа',
        account: { username: 'uchenik-dostupa', password: 'kolledzh-dostupa-2025' },
      },
    });
    studentId = (student.json() as Json).id as string;

    await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: admin,
      payload: { studentId, joinedOn: shiftDays(-120) },
    });

    // Назначение только у первого преподавателя.
    await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: admin,
      payload: {
        teacherUserId: first.id,
        subjectId,
        studyGroupId: groupId,
        startsOn: shiftDays(-180),
      },
    });

    const own = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: admin,
      payload: {
        studyGroupId: groupId,
        subjectId,
        teacherUserId: first.id,
        lessonDate: shiftDays(-2),
        pairNumber: 1,
        timeStart: '08:30',
        timeEnd: '10:00',
      },
    });
    ownLessonId = (own.json() as Json).id as string;

    // Урок второго преподавателя: он видит свой, первый — нет.
    const foreign = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: admin,
      payload: {
        studyGroupId: groupId,
        subjectId,
        teacherUserId: second.id,
        lessonDate: shiftDays(-1),
        pairNumber: 2,
        timeStart: '10:10',
        timeEnd: '11:40',
      },
    });
    foreignLessonId = (foreign.json() as Json).id as string;

    const reasons = await testApp.app.inject({
      method: 'GET',
      url: '/api/grade-categories',
      headers: admin,
    });
    const items = (reasons.json() as { items: Json[] }).items;
    reasonId = items[0]?.id as string;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('свой урок преподаватель открывает', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${ownLessonId}/journal`,
      headers: { cookie: teacherCookie },
    });

    expect(response.statusCode, response.body).toBe(200);
  });

  it('чужой урок преподавателю не виден', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${foreignLessonId}/journal`,
      headers: { cookie: teacherCookie },
    });

    // 404, а не 403: чужой урок не должен подтверждать своё существование.
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('Русский язык');
  });

  it('оценку на чужом уроке поставить нельзя', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${foreignLessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '5', categoryId: reasonId },
    });

    expect(response.statusCode).toBe(404);
  });

  it('посещаемость на чужом уроке отметить нельзя', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${foreignLessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: { studentId, status: 'present' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('свой урок чужой преподаватель тоже не видит', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${ownLessonId}/journal`,
      headers: { cookie: secondTeacherCookie },
    });

    expect(response.statusCode).toBe(404);
  });

  it('администратор видит и правит любой урок', async () => {
    const view = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${foreignLessonId}/journal`,
      headers: { cookie: adminCookie },
    });
    expect(view.statusCode, view.body).toBe(200);

    const write = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${foreignLessonId}/grades`,
      headers: { cookie: adminCookie },
      payload: { studentId, value: '4', categoryId: reasonId },
    });
    expect(write.statusCode, write.body).toBe(201);
  });

  /**
   * Пересчёт знаков — действие администратора: он меняет отметки сразу у всей группы и
   * требует права с областью `all`. Владелец наткнулся на обратное: кнопка пересчёта
   * показывалась преподавателю и его запрос отвечал `403`. Проверка держит маршрут и
   * право согласованными — интерфейс кнопку преподавателю больше не показывает.
   */
  it('пересчёт знаков преподавателю недоступен', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/journal/apply-sign-rules',
      headers: { cookie: teacherCookie },
      payload: { studyGroupId: ownLessonId },
    });

    expect(response.statusCode).toBe(403);
  });
});
