import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ADMIN_PASSWORD,
  completeSetup,
  cookieHeader,
  createTestApp,
  createUserAndLogin,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Журнал: оценки, знаки и посещаемость (Этап 4).
 *
 * Проверяем то, что нельзя увидеть в интерфейсе: правила постановки отметок,
 * несколько оценок за урок, защиту от дубля с заменой и приватность выборок.
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

/** Дата нужного дня недели: начиная с `from`, по умолчанию — с завтрашнего дня. */
function nextWeekday(dayOfWeek: number, from = shiftDays(1)): string {
  const date = new Date(`${from}T00:00:00Z`);
  while (date.getUTCDay() !== dayOfWeek % 7) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

describeWithDatabase('журнал: оценки и посещаемость', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;
  let yearId: string;
  let groupId: string;
  let secondGroupId: string;
  let subjectId: string;
  let teacherUserId: string;
  let studentId: string;
  let lessonId: string;
  let secondLessonId: string;
  let homeReasonId: string;
  let testReasonId: string;
  let gradeId: string;

  const auth = () => ({ cookie: adminCookie });

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);

    /**
     * Учебный год и период строим вокруг **сегодняшней** даты: журнал работает по
     * урокам, а уроки создаются на будущие даты внутри года. Фиксированный год из
     * настроек по умолчанию к моменту запуска тестов уже в прошлом.
     */
    ({ cookie: adminCookie } = await completeSetup(testApp.app, {
      institution: { title: 'Тестовый колледж', shortName: 'ТК', signature: 'Дневник колледжа' },
      academicYear: { title: 'Текущий год', startsOn: shiftDays(-200), endsOn: shiftDays(200) },
      period: {
        title: 'Текущий семестр',
        kind: 'semester',
        startsOn: shiftDays(-100),
        endsOn: shiftDays(100),
      },
      admin: {
        username: 'admin',
        fullName: 'Администратор Системы',
        password: ADMIN_PASSWORD,
      },
    }));

    const years = await testApp.app.inject({
      method: 'GET',
      url: '/api/academic-years',
      headers: auth(),
    });
    const year = (
      years.json() as { items: Array<{ id: string; startsOn: string; endsOn: string }> }
    ).items[0];
    yearId = year?.id ?? '';
    const yearStartsOn = year?.startsOn ?? shiftDays(-100);
    const yearEndsOn = year?.endsOn ?? shiftDays(100);

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-zhurnal',
      fullName: 'Преподаватель Журнала',
      password: 'kolledzh-zhurnal-2025',
      roles: ['teacher'],
    });
    teacherUserId = teacher.id;
    teacherCookie = teacher.cookie;

    const group = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: auth(),
      payload: {
        academicYearId: yearId,
        name: 'ЖР-11',
        startsOn: yearStartsOn,
        endsOn: yearEndsOn,
      },
    });
    expect(group.statusCode, group.body).toBe(201);
    groupId = (group.json() as Json).id as string;

    const second = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: auth(),
      payload: {
        academicYearId: yearId,
        name: 'ЖР-22',
        startsOn: yearStartsOn,
        endsOn: yearEndsOn,
      },
    });
    secondGroupId = (second.json() as Json).id as string;

    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Журналистика', shortName: 'ЖУР', kind: 'mandatory' },
    });
    expect(subject.statusCode, subject.body).toBe(201);
    subjectId = (subject.json() as Json).id as string;

    // Ученик: карточка и учётная запись одной операцией — без неё он не увидит оценки.
    const student = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: auth(),
      payload: {
        fullName: 'Ученик Журнала',
        account: { username: 'uchenik-zhurnal', password: 'kolledzh-uchenik-2025' },
      },
    });
    expect(student.statusCode, student.body).toBe(201);
    studentId = (student.json() as Json).id as string;

    const studentLogin = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'uchenik-zhurnal', password: 'kolledzh-uchenik-2025' },
    });
    expect(studentLogin.statusCode, studentLogin.body).toBe(200);
    studentCookie = cookieHeader(studentLogin.cookies);

    const enroll = await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: auth(),
      payload: { studentId, joinedOn: yearStartsOn },
    });
    expect(enroll.statusCode, enroll.body).toBe(201);

    const assignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: auth(),
      payload: { teacherUserId, subjectId, studyGroupId: groupId, startsOn: shiftDays(-180) },
    });
    expect(assignment.statusCode, assignment.body).toBe(201);

    // Шаблон занятия и генерация уроков: журнал всегда привязан к уроку.
    const entry = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedule',
      headers: auth(),
      payload: {
        assignmentId: (assignment.json() as Json).id,
        dayOfWeek: 2,
        pairNumber: 1,
        timeStart: '08:30',
        timeEnd: '10:00',
        validFrom: shiftDays(-100),
      },
    });
    expect(entry.statusCode, entry.body).toBe(201);

    const generated = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons/generate',
      headers: auth(),
      payload: { studyGroupId: groupId, from: nextWeekday(2), to: shiftDays(30) },
    });
    expect(generated.statusCode, generated.body).toBe(200);

    const lessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?studyGroupId=${groupId}&from=${nextWeekday(2)}&to=${shiftDays(30)}`,
      headers: auth(),
    });
    const items = (lessons.json() as { items: Json[] }).items;
    expect(items.length, 'уроки не созданы: ' + lessons.body).toBeGreaterThan(1);
    lessonId = items[0]?.id as string;
    secondLessonId = items[1]?.id as string;

    // Причины оценок «из коробки» создаются при сборке приложения.
    const reasons = await testApp.app.inject({
      method: 'GET',
      url: '/api/grade-categories',
      headers: auth(),
    });
    const reasonItems = (reasons.json() as { items: Json[] }).items;
    homeReasonId = (reasonItems.find((item) => item.code === 'Д')?.id as string) ?? '';
    testReasonId = (reasonItems.find((item) => item.code === 'К')?.id as string) ?? '';
    expect(homeReasonId).not.toBe('');
    expect(testReasonId).not.toBe('');
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('причины оценок «из коробки» созданы с весом 1', async () => {
    const reasons = await testApp.app.inject({
      method: 'GET',
      url: '/api/grade-categories',
      headers: auth(),
    });

    const items = (reasons.json() as { items: Json[] }).items;
    const codes = items.map((item) => item.code);
    for (const code of ['Д', 'О', 'П', 'К', 'Э', 'С', 'Л', 'Т', 'З', 'Пр']) {
      expect(codes).toContain(code);
    }
    expect(items.every((item) => item.weight === 1)).toBe(true);
  });

  it('вес причины ограничен целым от 1 до 5', async () => {
    const tooBig = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/grade-categories/${homeReasonId}`,
      headers: auth(),
      payload: { weight: 6 },
    });
    expect(tooBig.statusCode).toBe(400);

    const zero = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/grade-categories/${homeReasonId}`,
      headers: auth(),
      payload: { weight: 0 },
    });
    expect(zero.statusCode).toBe(400);

    const ok = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/grade-categories/${homeReasonId}`,
      headers: auth(),
      payload: { weight: 3 },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as Json).weight).toBe(3);

    // Возвращаем вес обратно, чтобы не влиять на другие проверки.
    await testApp.app.inject({
      method: 'PATCH',
      url: `/api/grade-categories/${homeReasonId}`,
      headers: auth(),
      payload: { weight: 1 },
    });
  });

  it('код причины — до двух символов', async () => {
    const tooLong = await testApp.app.inject({
      method: 'POST',
      url: '/api/grade-categories',
      headers: auth(),
      payload: { code: 'ДЗШ', title: 'Слишком длинный код', weight: 1 },
    });
    expect(tooLong.statusCode).toBe(400);

    const ok = await testApp.app.inject({
      method: 'POST',
      url: '/api/grade-categories',
      headers: auth(),
      payload: { code: 'ДЗ', title: 'Домашнее задание (своя причина)', weight: 2 },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((ok.json() as Json).code).toBe('ДЗ');
  });

  it('экран урока отдаёт состав группы, отметки и правила', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });

    expect(response.statusCode, response.body).toBe(200);
    const journal = response.json() as Json;
    expect((journal.lesson as Json).subjectName).toBe('Журналистика');
    const students = journal.students as Json[];
    expect(students).toHaveLength(1);
    expect(students[0]?.fullName).toBe('Ученик Журнала');
    expect(students[0]?.grades).toEqual([]);
    expect(students[0]?.attendance).toBeNull();
  });

  it('причина оценки обязательна', async () => {
    const withoutReason = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '5' },
    });
    expect(withoutReason.statusCode).toBe(400);

    const unknownReason = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '5', categoryId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(unknownReason.statusCode).toBe(400);
  });

  it('оценка и знак ставятся с причиной, одновременно — нельзя', async () => {
    const grade = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '5', categoryId: homeReasonId },
    });
    expect(grade.statusCode, grade.body).toBe(201);
    gradeId = (grade.json() as Json).id as string;
    expect((grade.json() as Json).categoryCode).toBe('Д');

    const sign = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${secondLessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, sign: 'plus', categoryId: testReasonId },
    });
    expect(sign.statusCode, sign.body).toBe(201);
    expect((sign.json() as Json).sign).toBe('plus');

    const both = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '5', sign: 'dot', categoryId: testReasonId },
    });
    expect(both.statusCode).toBe(400);
  });

  it('за урок можно поставить несколько оценок с разными причинами', async () => {
    const second = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '4', categoryId: testReasonId },
    });
    expect(second.statusCode, second.body).toBe(201);

    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });
    const grades = ((journal.json() as Json).students as Json[])[0]?.grades as Json[];
    expect(grades).toHaveLength(2);
    expect(grades.map((grade) => grade.value).sort()).toEqual(['4', '5']);
  });

  it('отметка с той же причиной отклоняется, а с подтверждением заменяет прежнюю', async () => {
    const duplicate = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '3', categoryId: homeReasonId },
    });
    expect(duplicate.statusCode).toBe(409);
    expect((duplicate.json() as { error: { details: Json } }).error.details.reason).toBe(
      'duplicate_grade',
    );

    const replaced = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '3', categoryId: homeReasonId, replace: true },
    });
    expect(replaced.statusCode, replaced.body).toBe(201);

    // Прежняя отметка ушла в историю, а в журнале остались две: «3» и «4».
    const revisions = await testApp.app.inject({
      method: 'GET',
      url: `/api/grades/${gradeId}/revisions`,
      headers: auth(),
    });
    const items = (revisions.json() as { items: Json[] }).items;
    expect(items.some((item) => item.action === 'delete')).toBe(true);

    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });
    const grades = ((journal.json() as Json).students as Json[])[0]?.grades as Json[];
    expect(grades).toHaveLength(2);
    expect(grades.some((grade) => grade.value === '3')).toBe(true);
    expect(grades.some((grade) => grade.value === '5')).toBe(false);
  });

  it('правка оценки требует причины и попадает в историю', async () => {
    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });
    const current = ((journal.json() as Json).students as Json[])[0]?.grades as Json[];
    const target = current[0];

    const withoutReason = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/grades/${target?.id as string}`,
      headers: { cookie: teacherCookie },
      payload: { value: '3' },
    });
    expect(withoutReason.statusCode).toBe(400);

    const updated = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/grades/${target?.id as string}`,
      headers: { cookie: teacherCookie },
      payload: { value: '3', reason: 'Опечатка при выставлении' },
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const revisions = await testApp.app.inject({
      method: 'GET',
      url: `/api/grades/${target?.id as string}/revisions`,
      headers: auth(),
    });
    const items = (revisions.json() as { items: Json[] }).items;
    const edited = items.find((item) => item.action === 'update');
    expect(edited?.after).toBe('3');
    expect(edited?.reason).toBe('Опечатка при выставлении');
  });

  it('посещаемость: «Н» без причины, «У» требует причину, ставится одна отметка', async () => {
    // Уважительная без текста причины — отказ.
    const excusedWithoutReason = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: { studentId, status: 'not_present', isExcused: true },
    });
    expect(excusedWithoutReason.statusCode).toBe(400);

    // «Н» без причины — сохраняется и ничего не требует.
    const absent = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: { studentId, status: 'not_present' },
    });
    expect(absent.statusCode, absent.body).toBe(201);
    expect((absent.json() as Json).isExcused).toBe(false);

    // Повторная отметка заменяет прежнюю: она одна на урок.
    const excused = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: {
        studentId,
        status: 'not_present',
        isExcused: true,
        reason: 'Справка из поликлиники',
      },
    });
    expect(excused.statusCode, excused.body).toBe(201);
    expect((excused.json() as Json).isExcused).toBe(true);

    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });
    const row = ((journal.json() as Json).students as Json[])[0];
    expect((row?.attendance as Json).status).toBe('not_present');
    expect((row?.attendance as Json).isExcused).toBe(true);
  });

  it('ученик видит только свои отметки и не может ставить оценки', async () => {
    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: { cookie: studentCookie },
    });

    expect(journal.statusCode, journal.body).toBe(200);
    const students = (journal.json() as Json).students as Json[];
    expect(students).toHaveLength(1);
    expect(students[0]?.studentId).toBe(studentId);

    const forbidden = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: studentCookie },
      payload: { studentId, value: '5', categoryId: homeReasonId },
    });
    expect(forbidden.statusCode).toBe(403);

    const anonymous = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: { cookie: 'session=подделка' },
    });
    expect(anonymous.statusCode).toBe(401);

    void secondGroupId;
    void yearId;
  });
});
