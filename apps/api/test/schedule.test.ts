import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  completeSetup,
  createTestApp,
  createUserAndLogin,
  login,
  type TestApp,
} from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

interface Json {
  [key: string]: unknown;
}

/**
 * Расписание и уроки (Этап 3).
 *
 * Проверяются правила этапа: наложения в сетке (преподаватель и аудитория), запрет
 * двух занятий группы на одну пару, генерация уроков с идемпотентностью и
 * неприкосновенностью ручных правок, замены преподавателя и видимость расписания
 * для разных ролей.
 */

/** Даты считаются от сегодняшнего дня: тест не привязан к календарю. */
function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Ближайшая дата с нужным днём недели (1 — понедельник). */
function nextWeekday(dayOfWeek: number, from = shiftDays(1)): string {
  const date = new Date(`${from}T00:00:00Z`);
  while (date.getUTCDay() !== dayOfWeek % 7) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

describeWithDatabase('расписание и уроки', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let teacherUserId: string;
  let yearId: string;
  let subjectId: string;
  let secondSubjectId: string;
  let groupId: string;
  let secondGroupId: string;
  let roomId: string;
  let assignmentId: string;
  /** Сессия ученика: нужна позже, чтобы проверить выборку расписания его группы. */
  let studentCookie: string;

  const auth = () => ({ cookie: adminCookie });
  const teacherAuth = () => ({ cookie: teacherCookie });

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-raspisanie',
      fullName: 'Преподаватель Расписания',
      password: 'kolledzh-raspisanie-2025',
      roles: ['teacher'],
    });
    teacherUserId = teacher.id;
    teacherCookie = teacher.cookie;

    const year = await testApp.app.inject({
      method: 'POST',
      url: '/api/academic-years',
      headers: auth(),
      payload: {
        title: '2024/2028',
        startsOn: shiftDays(-760),
        endsOn: shiftDays(760),
        isActive: true,
      },
    });
    yearId = (year.json() as Json).id as string;

    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Основы программирования', shortName: 'ОП', kind: 'mandatory' },
    });
    subjectId = (subject.json() as Json).id as string;

    const secondSubject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Базы данных', shortName: 'БД', kind: 'mandatory' },
    });
    secondSubjectId = (secondSubject.json() as Json).id as string;

    const room = await testApp.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth(),
      payload: { name: 'Кабинет 101', capacity: 25 },
    });
    roomId = (room.json() as Json).id as string;

    const group = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: auth(),
      payload: {
        academicYearId: yearId,
        name: 'РПС-21',
        startsOn: shiftDays(-200),
        endsOn: shiftDays(200),
      },
    });
    groupId = (group.json() as Json).id as string;

    const secondGroup = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: auth(),
      payload: {
        academicYearId: yearId,
        name: 'РПС-22',
        startsOn: shiftDays(-200),
        endsOn: shiftDays(200),
      },
    });
    secondGroupId = (secondGroup.json() as Json).id as string;

    const assignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: auth(),
      payload: { teacherUserId, subjectId, studyGroupId: groupId, startsOn: shiftDays(-180) },
    });
    assignmentId = (assignment.json() as Json).id as string;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  const createEntry = (payload: Json) =>
    testApp.app.inject({ method: 'POST', url: '/api/schedule', headers: auth(), payload });

  it('звонки: справочник заполняется, правится и время подставляется в занятие', async () => {
    const empty = await testApp.app.inject({
      method: 'GET',
      url: '/api/bells',
      headers: auth(),
    });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { items: Json[] }).items).toHaveLength(0);

    // Пока звонков нет, занятие без времени не создаётся: сервер объясняет, что делать.
    const withoutBells = await createEntry({
      assignmentId,
      dayOfWeek: 4,
      pairNumber: 3,
      validFrom: shiftDays(-100),
    });
    expect(withoutBells.statusCode).toBe(400);
    expect((withoutBells.json() as { error: { message: string } }).error.message).toContain(
      'звонки',
    );

    const saved = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bells',
      headers: auth(),
      payload: { pairNumber: 3, timeStart: '11:30', timeEnd: '13:00', breakMinutes: 10 },
    });
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as Json).timeStart).toBe('11:30');

    // Повторная запись той же пары — правка, а не вторая строка.
    const updated = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bells',
      headers: auth(),
      payload: { pairNumber: 3, timeStart: '11:40', timeEnd: '13:10' },
    });
    expect(updated.statusCode).toBe(200);

    const bells = await testApp.app.inject({ method: 'GET', url: '/api/bells', headers: auth() });
    const items = (bells.json() as { items: Json[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.timeStart).toBe('11:40');

    // Теперь занятие создаётся без указания времени: оно берётся из звонков.
    const entry = await createEntry({
      assignmentId,
      dayOfWeek: 4,
      pairNumber: 3,
      validFrom: shiftDays(-100),
    });
    expect(entry.statusCode).toBe(201);
    expect((entry.json() as Json).timeStart).toBe('11:40');
    expect((entry.json() as Json).timeEnd).toBe('13:10');

    // Преподаватель звонки менять не может, но видеть — да.
    const forbidden = await testApp.app.inject({
      method: 'PUT',
      url: '/api/bells',
      headers: teacherAuth(),
      payload: { pairNumber: 4, timeStart: '14:00', timeEnd: '15:30' },
    });
    expect(forbidden.statusCode).toBe(403);

    const visible = await testApp.app.inject({
      method: 'GET',
      url: '/api/bells',
      headers: teacherAuth(),
    });
    expect(visible.statusCode).toBe(200);

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: '/api/bells/3',
      headers: auth(),
    });
    expect(removed.statusCode).toBe(204);

    // Убираем занятие, созданное проверкой: дальше тесты считают сетку с нуля.
    const created = entry.json() as Json;
    const cleaned = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/schedule/${created.id as string}`,
      headers: auth(),
    });
    expect(cleaned.statusCode).toBe(204);
  });

  it('занятый логин при создании пользователя даёт 409, а не 500', async () => {
    // Сквозной сценарий Этапа 3 упирался в это при повторном прогоне: конфликт
    // уникальности логина приходил как внутренняя ошибка сервера.
    const duplicate = await testApp.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: auth(),
      payload: {
        username: 'prepod-raspisanie',
        fullName: 'Другой Преподаватель',
        password: 'kolledzh-drugoy-2025',
        roles: ['teacher'],
      },
    });

    expect(duplicate.statusCode).toBe(409);
    expect((duplicate.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
  });

  it('ученик и родитель видят свои группы, преподаватель — все свои', async () => {
    // Роли без права `academics:read@all` не могут получить общий список групп,
    // поэтому расписание отдаёт им их собственные группы: иначе выбрать нечего.
    const account = {
      username: 'uchenik-raspisanie',
      // Пароль не содержит логин: этого требует политика паролей.
      password: 'kolledzh-uchenik-2025',
    };

    const student = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: auth(),
      payload: { fullName: 'Ученик Расписания', account },
    });
    if (student.statusCode !== 201) process.stdout.write(`СОЗДАНИЕ УЧЕНИКА: ${student.body}\n`);
    expect(student.statusCode).toBe(201);
    const studentId = (student.json() as Json).id as string;

    const enrollment = await testApp.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/enrollments`,
      headers: auth(),
      payload: { studentId, joinedOn: shiftDays(-30) },
    });
    if (enrollment.statusCode !== 201) process.stdout.write(`ЗАЧИСЛЕНИЕ: ${enrollment.body}\n`);
    expect(enrollment.statusCode).toBe(201);

    studentCookie = await login(testApp.app, account.username, account.password);

    const own = await testApp.app.inject({
      method: 'GET',
      url: '/api/schedule/my-groups',
      headers: { cookie: studentCookie },
    });
    expect(own.statusCode).toBe(200);
    const ownItems = (own.json() as { items: Json[] }).items;
    expect(ownItems).toHaveLength(1);
    expect(ownItems[0]?.id).toBe(groupId);
    // Название нужно интерфейсу: по одному идентификатору группу не показать.
    expect(ownItems[0]?.name).toBe('РПС-21');

    // Преподаватель видит все группы: он ведёт занятия в разных.
    const teacherGroups = await testApp.app.inject({
      method: 'GET',
      url: '/api/schedule/my-groups',
      headers: teacherAuth(),
    });
    expect(teacherGroups.statusCode).toBe(200);
    expect((teacherGroups.json() as { items: Json[] }).items.length).toBeGreaterThanOrEqual(2);

    // Родитель видит группу через привязку к ученику (ADR-031).
    const parent = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'roditel-raspisanie',
      fullName: 'Представитель Расписания',
      password: 'kolledzh-roditel-2025',
      roles: ['parent'],
    });

    const link = await testApp.app.inject({
      method: 'POST',
      url: `/api/students/${studentId}/guardians`,
      headers: auth(),
      payload: { guardianUserId: parent.id, relation: 'mother' },
    });
    expect(link.statusCode).toBe(201);

    // Расписание своей группы ученик видит по фильтру группы. Проверяем в конце:
    // к этому моменту занятие уже создано предыдущими тестами.
    const studentView = await testApp.app.inject({
      method: 'GET',
      url: `/api/schedule?studyGroupId=${groupId}`,
      headers: { cookie: studentCookie },
    });
    expect(studentView.statusCode).toBe(200);

    const parentGroups = await testApp.app.inject({
      method: 'GET',
      url: '/api/schedule/my-groups',
      headers: { cookie: parent.cookie },
    });
    expect(parentGroups.statusCode).toBe(200);
    const parentItems = (parentGroups.json() as { items: Json[] }).items;
    expect(parentItems).toHaveLength(1);
    expect(parentItems[0]?.name).toBe('РПС-21');
  });

  it('занятие ставится в сетку группы', async () => {
    const created = await createEntry({
      assignmentId,
      roomId,
      dayOfWeek: 2,
      pairNumber: 1,
      timeStart: '08:30',
      timeEnd: '10:00',
      validFrom: shiftDays(-100),
    });

    expect(created.statusCode).toBe(201);
    const entry = created.json() as Json;
    expect(entry.groupName).toBe('РПС-21');
    expect(entry.subjectName).toBe('Основы программирования');
    expect(entry.dayOfWeek).toBe(2);
    expect(entry.timeStart).toBe('08:30');

    const list = await testApp.app.inject({
      method: 'GET',
      url: `/api/schedule?studyGroupId=${groupId}`,
      headers: auth(),
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: Json[] }).items).toHaveLength(1);
  });

  it('второе занятие группы на ту же пару не ставится', async () => {
    const duplicate = await createEntry({
      assignmentId,
      dayOfWeek: 2,
      pairNumber: 1,
      timeStart: '08:30',
      timeEnd: '10:00',
      validFrom: shiftDays(-100),
    });

    expect(duplicate.statusCode).toBe(409);
  });

  it('преподаватель не может вести две группы в одну пару', async () => {
    // Второе назначение того же преподавателя на другую группу: предмет тот же,
    // но группа другая — назначение допустимо (ADR-030).
    const secondAssignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: auth(),
      payload: {
        teacherUserId,
        subjectId,
        studyGroupId: secondGroupId,
        startsOn: shiftDays(-180),
      },
    });
    expect(secondAssignment.statusCode).toBe(201);

    const conflict = await createEntry({
      assignmentId: (secondAssignment.json() as Json).id as string,
      dayOfWeek: 2,
      pairNumber: 1,
      timeStart: '08:30',
      timeEnd: '10:00',
      validFrom: shiftDays(-100),
    });

    expect(conflict.statusCode).toBe(409);
    expect(
      (conflict.json() as { error: { details?: { reason?: string } } }).error.details?.reason,
    ).toBe('teacher_overlap');
  });

  it('аудитория не может быть занята дважды, а разные аудитории — можно', async () => {
    const secondAssignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: auth(),
      payload: {
        teacherUserId: (
          await createUserAndLogin(testApp.app, adminCookie, {
            username: 'prepod-vtoroy-rasp',
            fullName: 'Преподаватель Второй Расписания',
            password: 'kolledzh-vtoroy-rasp-2025',
            roles: ['teacher'],
          })
        ).id,
        // Предмет другой: правило «предмет в группе ведёт один преподаватель»
        // дало бы 409 на том же предмете, и проверка аудитории не выполнилась бы.
        subjectId: secondSubjectId,
        studyGroupId: secondGroupId,
        startsOn: shiftDays(-180),
      },
    });

    const sameRoom = await createEntry({
      assignmentId: (secondAssignment.json() as Json).id as string,
      roomId,
      dayOfWeek: 2,
      pairNumber: 1,
      timeStart: '08:30',
      timeEnd: '10:00',
      validFrom: shiftDays(-100),
    });

    expect(sameRoom.statusCode).toBe(409);
    expect(
      (sameRoom.json() as { error: { details?: { reason?: string } } }).error.details?.reason,
    ).toBe('room_overlap');

    // Без аудитории наложение по аудитории исчезает.
    const noRoom = await createEntry({
      assignmentId: (secondAssignment.json() as Json).id as string,
      dayOfWeek: 2,
      pairNumber: 1,
      timeStart: '08:30',
      timeEnd: '10:00',
      validFrom: shiftDays(-100),
    });
    expect(noRoom.statusCode).toBe(201);
  });

  it('расписание вне периода назначения не ставится', async () => {
    const late = await createEntry({
      assignmentId,
      dayOfWeek: 3,
      pairNumber: 2,
      timeStart: '10:10',
      timeEnd: '11:40',
      validFrom: shiftDays(-400),
    });

    expect(late.statusCode).toBe(400);
    expect((late.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('генерация уроков из шаблона идемпотентна', async () => {
    const from = nextWeekday(2);
    const to = shiftDays(28);

    const first = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons/generate',
      headers: auth(),
      payload: { studyGroupId: groupId, from, to },
    });

    expect(first.statusCode).toBe(200);
    const created = (first.json() as Json).created as number;
    expect(created).toBeGreaterThanOrEqual(3);

    const lessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?studyGroupId=${groupId}&from=${from}&to=${to}`,
      headers: auth(),
    });
    const items = (lessons.json() as { items: Json[] }).items;
    expect(items.length).toBe(created);
    expect(items.every((lesson) => lesson.status === 'planned')).toBe(true);
    expect(items[0]?.teacherName).toBe('Преподаватель Расписания');

    // Повторный запуск: ни новых уроков, ни изменений.
    const second = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons/generate',
      headers: auth(),
      payload: { studyGroupId: groupId, from, to },
    });

    const again = second.json() as Json;
    expect(again.created).toBe(0);
    expect(again.updated).toBe(0);

    const after = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?studyGroupId=${groupId}&from=${from}&to=${to}`,
      headers: auth(),
    });
    expect((after.json() as { items: Json[] }).items.length).toBe(created);
  });

  it('правка урока вручную переживает повторную генерацию', async () => {
    const from = nextWeekday(2);
    const to = shiftDays(28);

    const lessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?studyGroupId=${groupId}&from=${from}&to=${to}`,
      headers: auth(),
    });
    const first = (lessons.json() as { items: Json[] }).items[0];
    const lessonId = first?.id as string;

    const updated = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/lessons/${lessonId}`,
      headers: auth(),
      payload: { topic: 'Введение в язык' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as Json).topic).toBe('Введение в язык');
    expect((updated.json() as Json).isManual).toBe(true);

    const regenerate = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons/generate',
      headers: auth(),
      payload: { studyGroupId: groupId, from, to },
    });
    expect((regenerate.json() as Json).skippedManual).toBe(1);

    const after = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}`,
      headers: auth(),
    });
    expect((after.json() as Json).topic).toBe('Введение в язык');
  });

  it('перенос урока: пара и время меняются, правка помечается ручной', async () => {
    const lessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?studyGroupId=${groupId}&from=${nextWeekday(2)}&to=${shiftDays(28)}`,
      headers: auth(),
    });
    const first = (lessons.json() as { items: Json[] }).items[0];

    const moved = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/lessons/${first?.id as string}`,
      headers: auth(),
      payload: { pairNumber: 5, timeStart: '14:50', timeEnd: '16:20' },
    });
    expect(moved.statusCode).toBe(200);
    const updated = moved.json() as Json;
    expect(updated.pairNumber).toBe(5);
    expect(updated.timeStart).toBe('14:50');
    // Перенос — ручная правка: генерация её не перезапишет.
    expect(updated.isManual).toBe(true);
  });

  it('перенос урока на дату, где пара уже занята, отклоняется', async () => {
    // Тест самодостаточен: сначала ставим урок на пару 2 первого дня, потом
    // пытаемся перенести туда урок другой недели — пара уже занята (ADR-006).
    const lessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?studyGroupId=${groupId}&from=${nextWeekday(2)}&to=${shiftDays(28)}`,
      headers: auth(),
    });
    const items = (lessons.json() as { items: Json[] }).items;
    const first = items[0];
    const second = items[1];
    expect(first?.lessonDate).not.toBe(second?.lessonDate);

    const occupied = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/lessons/${first?.id as string}`,
      headers: auth(),
      payload: { pairNumber: 2, timeStart: '09:40', timeEnd: '11:10' },
    });
    expect(occupied.statusCode).toBe(200);

    const conflict = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/lessons/${second?.id as string}`,
      headers: auth(),
      payload: {
        lessonDate: first?.lessonDate as string,
        pairNumber: 2,
        timeStart: '09:40',
        timeEnd: '11:10',
      },
    });

    expect(conflict.statusCode).toBe(409);
    expect(
      (conflict.json() as { error: { details?: { reason?: string } } }).error.details?.reason,
    ).toBe('group_overlap');
  });

  it('отмена занятия на дату отменяет урок', async () => {
    // Берём последний день периода: его не трогали предыдущие тесты, поэтому
    // урок заведомо в статусе «запланирован».
    const lessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?studyGroupId=${groupId}&from=${nextWeekday(2)}&to=${shiftDays(28)}`,
      headers: auth(),
    });
    const items = (lessons.json() as { items: Json[] }).items;
    const target = items[items.length - 1];
    expect(target?.status).toBe('planned');

    const entries = await testApp.app.inject({
      method: 'GET',
      url: `/api/schedule?studyGroupId=${groupId}`,
      headers: auth(),
    });
    const entry = (entries.json() as { items: Json[] }).items.find(
      (item) => item.id === target?.scheduleEntryId,
    );
    expect(entry).toBeDefined();

    const cancelled = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedule/exceptions',
      headers: auth(),
      payload: {
        scheduleEntryId: entry?.id as string,
        exceptionDate: target?.lessonDate as string,
        action: 'cancel',
        payload: {},
        reason: 'Праздничный день',
      },
    });

    expect(cancelled.statusCode).toBe(201);

    const after = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${target?.id as string}`,
      headers: auth(),
    });
    expect((after.json() as Json).status).toBe('cancelled');

    // Отменённый урок остаётся строкой с пометкой, а не исчезает: иначе
    // повторная генерация создала бы занятие на эту дату заново (ADR-006).
    const regenerate = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons/generate',
      headers: auth(),
      payload: { studyGroupId: groupId, from: nextWeekday(2), to: shiftDays(28) },
    });
    expect(regenerate.statusCode).toBe(200);

    const stillThere = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${target?.id as string}`,
      headers: auth(),
    });
    expect(stillThere.statusCode).toBe(200);
    expect((stillThere.json() as Json).status).toBe('cancelled');
  });

  it('замена на урок: видно и заменяющего, и того, кого заменяют', async () => {
    const substitute = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-zamena',
      fullName: 'Преподаватель Замена',
      password: 'kolledzh-zamena-2025',
      roles: ['teacher'],
    });

    const lessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?studyGroupId=${groupId}&from=${nextWeekday(2)}&to=${shiftDays(28)}&status=planned`,
      headers: auth(),
    });
    const target = (lessons.json() as { items: Json[] }).items[0];
    expect(target).toBeDefined();

    const substitution = await testApp.app.inject({
      method: 'POST',
      url: '/api/substitutions',
      headers: auth(),
      payload: {
        lessonId: target?.id as string,
        substituteUserId: substitute.id,
        reason: 'Болезнь',
      },
    });

    expect(substitution.statusCode).toBe(201);

    const lesson = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${target?.id as string}`,
      headers: auth(),
    });
    const updated = lesson.json() as Json;
    expect(updated.status).toBe('replaced');
    expect(updated.teacherUserId).toBe(substitute.id);
    expect(updated.plannedTeacherUserId).toBe(teacherUserId);

    // Заменяющий видит урок в своём расписании — иначе замена бессмысленна (ADR-032).
    const substituteLessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?from=${nextWeekday(2)}&to=${shiftDays(28)}`,
      headers: { cookie: substitute.cookie },
    });
    const visible = (substituteLessons.json() as { items: Json[] }).items;
    expect(visible.some((item) => item.id === target?.id)).toBe(true);
  });

  it('преподаватель видит только свои занятия и не может менять расписание', async () => {
    const lessons = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons?from=${shiftDays(-30)}&to=${shiftDays(60)}`,
      headers: teacherAuth(),
    });

    expect(lessons.statusCode).toBe(200);
    const items = (lessons.json() as { items: Json[] }).items;
    // Все видимые уроки — его: либо он ведёт, либо он заменял.
    expect(items.every((lesson) => lesson.teacherUserId === teacherUserId)).toBe(true);

    // Запрос идёт с сессией преподавателя: расписание правит только администратор.
    const forbidden = await testApp.app.inject({
      method: 'POST',
      url: '/api/schedule',
      headers: teacherAuth(),
      payload: {
        assignmentId,
        dayOfWeek: 5,
        pairNumber: 3,
        timeStart: '11:30',
        timeEnd: '13:00',
        validFrom: shiftDays(-100),
      },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
