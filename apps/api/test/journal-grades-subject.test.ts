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
 * «Оценки и посещение»: отметки по предметам и по ученикам за текущий период.
 *
 * Раздел не принимает диапазон дат: он всегда работает за текущий учебный период, а если
 * периода нет, отвечает «Период не задан». Это и проверяем вместе со структурой ответа.
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

describeWithDatabase('оценки и посещение', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;
  let groupId: string;
  let subjectId: string;
  let teacherUserId: string;
  let studentId: string;
  let lessonId: string;
  let reasonId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);

    ({ cookie: adminCookie } = await completeSetup(testApp.app, {
      institution: { title: 'Тестовый колледж', shortName: 'ТК', signature: 'Дневник колледжа' },
      academicYear: { title: 'Текущий год', startsOn: shiftDays(-200), endsOn: shiftDays(200) },
      // Период покрывает сегодняшнюю дату: раздел работает только за текущий период.
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

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-ocenki',
      fullName: 'Преподаватель Оценок',
      password: 'kolledzh-ocenki-prepod-2025',
      roles: ['teacher'],
    });
    teacherCookie = teacher.cookie;
    teacherUserId = teacher.id;

    const group = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: admin,
      payload: {
        academicYearId: year?.id ?? '',
        name: 'ОЦ-11',
        startsOn: year?.startsOn ?? shiftDays(-100),
        endsOn: year?.endsOn ?? shiftDays(100),
      },
    });
    groupId = (group.json() as Json).id as string;

    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: admin,
      payload: { name: 'Оценки', shortName: 'ОЦ', kind: 'mandatory' },
    });
    subjectId = (subject.json() as Json).id as string;

    await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: admin,
      payload: { teacherUserId, subjectId, studyGroupId: groupId, startsOn: shiftDays(-180) },
    });

    const student = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: admin,
      payload: {
        fullName: 'Ученик Оценок',
        account: {
          mustChangePassword: false,
          username: 'uchenik-ocenki',
          password: 'kolledzh-ocenki-uchenik-2025',
        },
      },
    });
    studentId = (student.json() as Json).id as string;

    const login = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'uchenik-ocenki', password: 'kolledzh-ocenki-uchenik-2025' },
    });
    studentCookie = (
      login.cookies[0] === undefined ? '' : `${login.cookies[0].name}=${login.cookies[0].value}`
    ) as string;

    await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: admin,
      payload: { studentId, joinedOn: shiftDays(-120) },
    });

    const lesson = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: admin,
      payload: {
        studyGroupId: groupId,
        subjectId,
        teacherUserId,
        lessonDate: shiftDays(-2),
        pairNumber: 1,
        timeStart: '08:30',
        timeEnd: '10:00',
      },
    });
    lessonId = (lesson.json() as Json).id as string;

    const reasons = await testApp.app.inject({
      method: 'GET',
      url: '/api/grade-categories',
      headers: admin,
    });
    reasonId = (reasons.json() as { items: Json[] }).items[0]?.id as string;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('оценки по предметам за текущий период', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '5', categoryId: reasonId },
    });

    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/journal/grades-by-subject?studentId=${studentId}`,
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as {
      period: { title: string };
      subjects: Array<{ subjectName: string; average: number | null; marks: Json[] }>;
    };

    // Период приходит вместе с данными: экрану нужно его название для заголовка.
    expect(body.period.title).toBe('Текущий семестр');
    expect(body.subjects).toHaveLength(1);
    expect(body.subjects[0]?.subjectName).toBe('Оценки');
    expect(body.subjects[0]?.average).toBe(5);
    expect(body.subjects[0]?.marks).toHaveLength(1);
    // Дата занятия нужна подсказке отметки.
    expect(body.subjects[0]?.marks[0]?.lessonDate).toBe(shiftDays(-2));
  });

  it('ученик видит свои отметки без указания ученика', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/journal/grades-by-subject',
      headers: { cookie: studentCookie },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { subjects: Array<{ marks: Json[] }> };
    expect(body.subjects).toHaveLength(1);

    // И не может запросить чужого: остаются только свои строки.
    const foreign = await testApp.app.inject({
      method: 'GET',
      url: '/api/journal/grades-by-subject?studentId=00000000-0000-7000-8000-000000000000',
      headers: { cookie: studentCookie },
    });
    expect(foreign.statusCode, foreign.body).toBe(200);
    expect((foreign.json() as { subjects: Json[] }).subjects).toEqual([]);
  });

  it('посещение: процент пропусков меняется от галочек', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: { studentId, status: 'sick' },
    });

    const base = await testApp.app.inject({
      method: 'GET',
      url: `/api/journal/attendance-by-subject?studentId=${studentId}`,
      headers: { cookie: adminCookie },
    });
    const baseBody = base.json() as {
      subjects: Array<{ absences: number; percent: number; basePercent: number }>;
    };
    // Болезнь без галочки пропуском не считается.
    expect(baseBody.subjects[0]?.absences).toBe(0);
    expect(baseBody.subjects[0]?.percent).toBe(0);
    expect(baseBody.subjects[0]?.basePercent).toBe(0);

    const withSick = await testApp.app.inject({
      method: 'GET',
      url: `/api/journal/attendance-by-subject?studentId=${studentId}&countSick=true`,
      headers: { cookie: adminCookie },
    });
    const body = withSick.json() as {
      subjects: Array<{ absences: number; percent: number; basePercent: number }>;
    };
    // Одно занятие, и на нём болезнь: 100% пропусков при включённой галочке.
    expect(body.subjects[0]?.absences).toBe(1);
    expect(body.subjects[0]?.percent).toBe(100);
    // Без галочек процент остаётся нулевым: с ним и сравнивают.
    expect(body.subjects[0]?.basePercent).toBe(0);
  });

  it('вид преподавателя: строки по ученикам его группы', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/journal/marks-by-student?studyGroupId=${groupId}&subjectId=${subjectId}`,
      headers: { cookie: teacherCookie },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as {
      students: Array<{ studentName: string; average: number | null; marks: Json[] }>;
    };

    expect(body.students).toHaveLength(1);
    expect(body.students[0]?.studentName).toBe('Ученик Оценок');
    expect(body.students[0]?.average).toBe(5);
    expect(body.students[0]?.marks).toHaveLength(1);
  });

  it('вид преподавателя требует группу и предмет', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/journal/marks-by-student',
      headers: { cookie: teacherCookie },
    });

    expect(response.statusCode).toBe(400);
  });
});
