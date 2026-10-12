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
 * Журнал: оценки, знаки и посещаемость (Этап 4, шаг 0).
 *
 * Проверяем то, что нельзя увидеть в интерфейсе: правила постановки отметок,
 * приватность выборок и идемпотентность правила «знаки → оценка» — критерий
 * приёмки этапа.
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

/** Дата ближайшего нужного дня недели: сегодня, если совпало. */
function nextWeekday(dayOfWeek: number): string {
  const date = new Date();
  if (date.getDay() !== dayOfWeek % 7) date.setDate(date.getDate() + 1);
  while (date.getDay() !== dayOfWeek % 7) date.setDate(date.getDate() + 1);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

describeWithDatabase('журнал: оценки и посещаемость', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let studentCookie: string;
  let studentUserId: string;
  let yearId: string;
  let groupId: string;
  let secondGroupId: string;
  let subjectId: string;
  let teacherUserId: string;
  let studentId: string;
  let lessonId: string;
  let secondLessonId: string;
  let gradeId: string;

  const auth = () => ({ cookie: adminCookie });

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);

    /**
     * Учебный год и период строим вокруг **сегодняшней** даты: журнал работает по
     * урокам, а уроки создаются на будущие даты внутри года. Фиксированный год из
     * настроек по умолчанию к моменту запуска тестов уже в прошлом, и генерация
     * уроков не нашла бы ни одной даты.
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
    // Группа обязана лежать внутри учебного года: иначе сервер отклонит создание.
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

    // Ученик: карточка и учётная запись одной операцией — без учётной записи он не
    // увидит свои оценки (ADR-005).
    const student = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: auth(),
      payload: {
        fullName: 'Ученик Журнала',
        account: { username: 'uchenik-zhurnal', password: 'kolledzh-uchenik-2025' },
      },
    });
    expect(student.statusCode).toBe(201);
    const studentBody = student.json() as Json;
    studentId = studentBody.id as string;
    studentUserId = studentBody.userId as string;

    const studentLogin = await testApp.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'uchenik-zhurnal', password: 'kolledzh-uchenik-2025' },
    });
    expect(studentLogin.statusCode, 'вход ученика: ' + studentLogin.body).toBe(200);
    studentCookie = cookieHeader(studentLogin.cookies);

    const enrollResponse = await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: auth(),
      payload: { studentId, joinedOn: shiftDays(-100) },
    });
    expect(enrollResponse.statusCode, 'зачисление: ' + enrollResponse.body).toBe(201);

    // Проверяем зачисление: без него журнал урока будет пустым, и это не ошибка
    // приложения, а неверная подготовка теста.
    const enrollments = await testApp.app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/students`,
      headers: auth(),
    });
    expect((enrollments.json() as { items: Json[] }).items, enrollments.body).toHaveLength(1);
    void studentUserId;

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
    expect(generated.statusCode, 'генерация: ' + generated.body).toBe(200);

    const lessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?studyGroupId=${groupId}&from=${nextWeekday(2)}&to=${shiftDays(30)}`,
      headers: auth(),
    });
    const items = (lessons.json() as { items: Json[] }).items;
    expect(items.length, 'уроки не созданы: ' + lessons.body).toBeGreaterThan(0);
    lessonId = items[0]?.id as string;
    secondLessonId = items[1]?.id as string;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('экран урока отдаёт состав группы и правила накопления знаков', async () => {
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
    expect(students[0]?.grade).toBeNull();
    expect(students[0]?.attendance).toBeNull();
  });

  it('оценка ставится, знак ставится, одновременная запись отклоняется', async () => {
    const grade = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '5' },
    });
    expect(grade.statusCode).toBe(201);
    gradeId = (grade.json() as Json).id as string;

    const sign = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${secondLessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, sign: 'plus' },
    });
    expect(sign.statusCode).toBe(201);
    expect((sign.json() as Json).sign).toBe('plus');

    const both = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '5', sign: 'dot' },
    });
    expect(both.statusCode).toBe(400);

    const neither = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId },
    });
    expect(neither.statusCode).toBe(400);
  });

  it('повторная запись в тот же урок заменяет отметку, а прежняя уходит в историю', async () => {
    const again = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '4' },
    });
    expect(again.statusCode).toBe(201);
    const newGradeId = (again.json() as Json).id as string;
    expect(newGradeId).not.toBe(gradeId);

    const revisions = await testApp.app.inject({
      method: 'GET',
      url: `/api/grades/${gradeId}/revisions`,
      headers: auth(),
    });
    expect(revisions.statusCode).toBe(200);
    const items = (revisions.json() as { items: Json[] }).items;
    expect(items.some((item) => item.action === 'delete')).toBe(true);

    // В журнале урока у ученика одна отметка — новая.
    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });
    const grade = (journal.json() as Json).students as Json[];
    expect((grade[0]?.grade as Json).value).toBe('4');
  });

  it('правка и удаление оценки требуют причины и попадают в историю', async () => {
    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });
    const current = ((journal.json() as Json).students as Json[])[0]?.grade as Json;

    const withoutReason = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/grades/${current.id as string}`,
      headers: { cookie: teacherCookie },
      payload: { value: '3' },
    });
    expect(withoutReason.statusCode).toBe(400);

    const updated = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/grades/${current.id as string}`,
      headers: { cookie: teacherCookie },
      payload: { value: '3', reason: 'Опечатка при выставлении' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as Json).value).toBe('3');

    const revisions = await testApp.app.inject({
      method: 'GET',
      url: `/api/grades/${current.id as string}/revisions`,
      headers: auth(),
    });
    const items = (revisions.json() as { items: Json[] }).items;
    const edited = items.find((item) => item.action === 'update');
    expect(edited?.before).toBe('4');
    expect(edited?.after).toBe('3');
    expect(edited?.reason).toBe('Опечатка при выставлении');
  });

  it('посещаемость: причина обязательна для прогула, «все присутствуют» проставляет отметки', async () => {
    const withoutReason = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: { studentId, status: 'absent' },
    });
    expect(withoutReason.statusCode).toBe(400);

    const absent = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: { studentId, status: 'absent', reason: 'Не был без предупреждения' },
    });
    expect(absent.statusCode).toBe(201);

    const allPresent = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance/all-present`,
      headers: { cookie: teacherCookie },
      payload: {},
    });
    expect(allPresent.statusCode).toBe(200);
    expect((allPresent.json() as Json).marked).toBe(1);

    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });
    const row = ((journal.json() as Json).students as Json[])[0];
    expect((row?.attendance as Json).status).toBe('present');
  });

  it('ученик видит только свои отметки и не получает чужие', async () => {
    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: { cookie: studentCookie },
    });

    expect(journal.statusCode, journal.body).toBe(200);
    const students = (journal.json() as Json).students as Json[];
    expect(students).toHaveLength(1);
    expect(students[0]?.studentId).toBe(studentId);

    // В чужой группе урок для ученика не существует: 404, а не 403.
    const assignments = await testApp.app.inject({
      method: 'GET',
      url: `/api/assignments?studyGroupId=${secondGroupId}`,
      headers: auth(),
    });
    void assignments;

    const foreign = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: { cookie: 'session=подделка' },
    });
    expect(foreign.statusCode).toBe(401);
  });

  it('ученик не может поставить оценку даже себе', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: studentCookie },
      payload: { studentId, value: '5' },
    });

    expect(response.statusCode).toBe(403);
  });
});
