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
 * Аналитика: средний балл с весами и посещаемость (Этап 4, шаг 4).
 *
 * Проверяем то, что нельзя увидеть в интерфейсе: отчёт строится по составу группы,
 * средний балл учитывает веса причин и не учитывает знаки, а ученик видит только
 * свою строку.
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

describeWithDatabase('аналитика журнала', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let groupId: string;
  let subjectId: string;
  let teacherUserId: string;
  let studentId: string;
  let lessonId: string;
  let homeReasonId: string;
  let heavyReasonId: string;

  const auth = () => ({ cookie: adminCookie });

  const statsOf = async (query: string, cookie = adminCookie): Promise<Json> => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/journal/stats?${query}`,
      headers: { cookie },
    });

    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Json;
  };

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

    const years = await testApp.app.inject({
      method: 'GET',
      url: '/api/academic-years',
      headers: auth(),
    });
    const year = (
      years.json() as { items: Array<{ id: string; startsOn: string; endsOn: string }> }
    ).items[0];

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-analitika',
      fullName: 'Преподаватель Аналитики',
      password: 'kolledzh-analitika-2025',
      roles: ['teacher'],
    });
    teacherUserId = teacher.id;
    teacherCookie = teacher.cookie;

    const group = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: auth(),
      payload: {
        academicYearId: year?.id ?? '',
        name: 'АН-11',
        startsOn: year?.startsOn ?? shiftDays(-100),
        endsOn: year?.endsOn ?? shiftDays(100),
      },
    });
    expect(group.statusCode, group.body).toBe(201);
    groupId = (group.json() as Json).id as string;

    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Аналитика', shortName: 'АН', kind: 'mandatory' },
    });
    expect(subject.statusCode, subject.body).toBe(201);
    subjectId = (subject.json() as Json).id as string;

    const student = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: auth(),
      payload: {
        fullName: 'Ученик Аналитики',
        account: { username: 'uchenik-analitika', password: 'kolledzh-analitika-2025' },
      },
    });
    expect(student.statusCode, student.body).toBe(201);
    studentId = (student.json() as Json).id as string;

    await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: auth(),
      payload: { studentId, joinedOn: shiftDays(-120) },
    });

    const assignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: auth(),
      payload: { teacherUserId, subjectId, studyGroupId: groupId, startsOn: shiftDays(-180) },
    });
    expect(assignment.statusCode, assignment.body).toBe(201);

    const lesson = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: auth(),
      payload: {
        studyGroupId: groupId,
        subjectId,
        teacherUserId,
        lessonDate: shiftDays(-1),
        pairNumber: 1,
        timeStart: '08:30',
        timeEnd: '10:00',
      },
    });
    expect(lesson.statusCode, lesson.body).toBe(201);
    lessonId = (lesson.json() as Json).id as string;

    const reasons = await testApp.app.inject({
      method: 'GET',
      url: '/api/grade-categories',
      headers: auth(),
    });
    const items = (reasons.json() as { items: Json[] }).items;
    homeReasonId = (items.find((item) => item.code === 'Д')?.id as string) ?? '';

    // Своя причина с большим весом: на ней проверяем, что вес учитывается.
    const heavy = await testApp.app.inject({
      method: 'POST',
      url: '/api/grade-categories',
      headers: auth(),
      payload: { code: 'В3', title: 'Весомое задание', weight: 5 },
    });
    expect(heavy.statusCode, heavy.body).toBe(201);
    heavyReasonId = (heavy.json() as Json).id as string;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('отчёт по группе строится без указания ученика', async () => {
    const report = await statsOf(`studyGroupId=${groupId}`);

    const items = report.items as Json[];
    expect(items).toHaveLength(1);
    // Имя нужно: без него строка отчёта нечитаема.
    expect(items[0]?.studentName).toBe('Ученик Аналитики');
  });

  it('средний балл учитывает вес причины, а знаки в него не входят', async () => {
    // «4» с весом 1 и «5» с весом 5 → (4·1 + 5·5) / 6 = 4.83.
    await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '4', categoryId: homeReasonId },
    });
    await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '5', categoryId: heavyReasonId },
    });
    // Знак в средний балл не идёт, но и не мешает.
    await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, sign: 'plus', categoryId: homeReasonId },
    });

    const report = await statsOf(`studyGroupId=${groupId}`);
    const row = (report.items as Json[])[0] as Json;

    expect(row.average).toBe(4.83);
    expect(row.gradesCount).toBe(2);
  });

  it('посещаемость: процент и разбивка по статусам', async () => {
    await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: { studentId, status: 'not_present', isExcused: true, reason: 'Справка' },
    });

    const report = await statsOf(`studyGroupId=${groupId}`);
    const attendance = ((report.items as Json[])[0] as Json).attendance as Json;
    const byStatus = attendance.byStatus as Json;

    expect(attendance.total).toBe(1);
    // Отмечено одно занятие, и на нём ученик отсутствовал: процент присутствия ноль.
    expect(attendance.percent).toBe(0);
    expect(attendance.excused).toBe(1);
    expect((byStatus.not_present as Json).count).toBe(1);
  });

  it('без группы у администратора отчёт не строится', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/journal/stats',
      headers: auth(),
    });

    expect(response.statusCode).toBe(400);
  });
});
