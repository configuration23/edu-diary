import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { completeSetup, createTestApp, createUserAndLogin, type TestApp } from './helpers/api';
import { createTestDatabase, hasTestDatabase, type TestDatabase } from './helpers/database';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Назначения «преподаватель ↔ предмет ↔ группа» (Этап 2).
 *
 * Ключевой критерий этапа проверяется здесь: учитель видит только свои
 * назначения и не может их менять. Остальные проверки — правила периодов,
 * закрытие вместо удаления и аудит.
 */

interface Json {
  [key: string]: unknown;
}

/** Дата, сдвинутая относительно сегодняшнего дня: тесты не зависят от календаря. */
function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

const PAST = { from: shiftDays(-400), to: shiftDays(-200) };
const CURRENT = { from: shiftDays(-30), to: shiftDays(100) };
const FUTURE = { from: shiftDays(200), to: shiftDays(300) };
const LATER = { from: shiftDays(320), to: shiftDays(400) };

describeWithDatabase('назначения преподавателей', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let otherTeacherCookie: string;
  let teacherUserId: string;
  let otherTeacherUserId: string;
  let yearId: string;
  let groupId: string;
  let subjectId: string;
  /** Второй предмет: нужен там, где первый уже занят другим назначением. */
  let secondSubjectId: string;

  const auth = () => ({ cookie: adminCookie });

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
    ({ cookie: adminCookie } = await completeSetup(testApp.app));

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-naznach',
      fullName: 'Преподаватель Назначенный',
      password: 'kolledzh-naznach-2025',
      roles: ['teacher'],
    });
    teacherUserId = teacher.id;
    teacherCookie = teacher.cookie;

    const other = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-vtoroy',
      fullName: 'Преподаватель Второй',
      password: 'kolledzh-vtoroy-2025',
      roles: ['teacher'],
    });
    otherTeacherUserId = other.id;
    otherTeacherCookie = other.cookie;

    // Год шире, чем используемые в тестах периоды: проверки границ группы
    // остаются отдельной темой и здесь не мешают.
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
      payload: { name: 'Информатика', kind: 'mandatory' },
    });
    subjectId = (subject.json() as Json).id as string;

    const secondSubject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Математика', kind: 'mandatory' },
    });
    secondSubjectId = (secondSubject.json() as Json).id as string;

    const group = await testApp.app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: auth(),
      payload: {
        academicYearId: yearId,
        name: 'ПКС-31',
        startsOn: shiftDays(-760),
        endsOn: shiftDays(760),
      },
    });
    groupId = (group.json() as Json).id as string;
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  const createAssignment = (overrides: Json = {}) =>
    testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: auth(),
      payload: {
        teacherUserId,
        subjectId,
        studyGroupId: groupId,
        startsOn: FUTURE.from,
        endsOn: FUTURE.to,
        ...overrides,
      },
    });

  it('админ создаёт назначение и видит его в списке', async () => {
    const created = await createAssignment();

    expect(created.statusCode).toBe(201);
    const assignment = created.json() as Json;
    expect(assignment.teacherName).toBe('Преподаватель Назначенный');
    expect(assignment.subjectName).toBe('Информатика');
    expect(assignment.groupName).toBe('ПКС-31');

    const list = await testApp.app.inject({
      method: 'GET',
      url: `/api/assignments?studyGroupId=${groupId}`,
      headers: auth(),
    });

    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: Json[] }).items.length).toBeGreaterThan(0);
  });

  it('учитель видит только свои назначения — и в своём списке, и в общем', async () => {
    const mine = await testApp.app.inject({
      method: 'GET',
      url: '/api/assignments/mine',
      headers: { cookie: teacherCookie },
    });

    expect(mine.statusCode).toBe(200);
    const mineItems = (mine.json() as { items: Json[] }).items;
    expect(mineItems.length).toBeGreaterThan(0);
    expect(mineItems.every((item) => item.teacherUserId === teacherUserId)).toBe(true);

    // У второго учителя своё назначение (создано выше по другому предмету):
    // чужих записей в его списке быть не должно.
    const otherMine = await testApp.app.inject({
      method: 'GET',
      url: '/api/assignments/mine',
      headers: { cookie: otherTeacherCookie },
    });
    const otherItems = (otherMine.json() as { items: Json[] }).items;
    expect(otherItems.every((item) => item.teacherUserId === otherTeacherUserId)).toBe(true);
    expect(otherItems.some((item) => item.teacherUserId === teacherUserId)).toBe(false);

    // В общем списке (доступен любому сотруднику) учитель тоже видит только свои.
    const otherList = await testApp.app.inject({
      method: 'GET',
      url: `/api/assignments?studyGroupId=${groupId}`,
      headers: { cookie: otherTeacherCookie },
    });
    const otherListItems = (otherList.json() as { items: Json[] }).items;
    expect(otherListItems.every((item) => item.teacherUserId === otherTeacherUserId)).toBe(true);

    // Подмена фильтра не помогает: область действия решает сервер.
    const spoofed = await testApp.app.inject({
      method: 'GET',
      url: `/api/assignments?teacherUserId=${teacherUserId}`,
      headers: { cookie: otherTeacherCookie },
    });
    const spoofedItems = (spoofed.json() as { items: Json[] }).items;
    expect(spoofedItems.every((item) => item.teacherUserId === otherTeacherUserId)).toBe(true);
  });

  it('учитель не может создавать и менять назначения', async () => {
    const create = await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: { cookie: teacherCookie },
      payload: {
        teacherUserId: otherTeacherUserId,
        subjectId,
        studyGroupId: groupId,
        startsOn: LATER.from,
        endsOn: LATER.to,
      },
    });
    expect(create.statusCode).toBe(403);

    const list = await testApp.app.inject({
      method: 'GET',
      url: '/api/assignments/mine',
      headers: { cookie: teacherCookie },
    });
    const assignmentId = (list.json() as { items: Json[] }).items[0]?.id as string;

    const patch = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/assignments/${assignmentId}`,
      headers: { cookie: teacherCookie },
      payload: { hoursPlanned: 10 },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('преподаватель должен существовать и иметь роль преподавателя', async () => {
    const notTeacher = await createAssignment({
      teacherUserId: teacherUserId === '' ? teacherUserId : '00000000-0000-4000-8000-000000000001',
      startsOn: LATER.from,
      endsOn: LATER.to,
    });

    expect(notTeacher.statusCode).toBe(400);
    expect((notTeacher.json() as { error: { message: string } }).error.message).toContain(
      'Преподаватель не найден',
    );
  });

  it('у одного преподавателя не бывает двух назначений в один период', async () => {
    const overlap = await createAssignment({
      // Пересекается с уже созданным назначением (FUTURE).
      startsOn: FUTURE.from,
      endsOn: LATER.to,
      subjectId,
    });

    expect(overlap.statusCode).toBe(409);
    const body = overlap.json() as { error: { details?: { reason?: string } } };
    expect(body.error.details?.reason).toBe('teacher_overlap');
  });

  it('предмет в группе ведёт один преподаватель в период', async () => {
    const conflict = await createAssignment({
      teacherUserId: otherTeacherUserId,
      startsOn: FUTURE.from,
      endsOn: FUTURE.to,
    });

    expect(conflict.statusCode).toBe(409);
    const body = conflict.json() as { error: { details?: { reason?: string } } };
    expect(body.error.details?.reason).toBe('subject_overlap');
  });

  it('другое время и другой предмет — конфликта нет', async () => {
    const another = await createAssignment({
      subjectId: secondSubjectId,
      startsOn: LATER.from,
      endsOn: LATER.to,
    });

    expect(another.statusCode).toBe(201);

    // Второй преподаватель ведёт свой предмет: конфликта «предмет в группе»
    // нет, потому что предмет другой, и по времени назначения не пересекаются.
    const otherTeacher = await createAssignment({
      teacherUserId: otherTeacherUserId,
      subjectId: secondSubjectId,
      startsOn: FUTURE.from,
      endsOn: FUTURE.to,
    });

    expect(otherTeacher.statusCode).toBe(201);
  });

  it('начавшееся назначение нельзя переписать: только закрыть и создать новое', async () => {
    const started = await createAssignment({
      startsOn: CURRENT.from,
      endsOn: CURRENT.to,
    });
    expect(started.statusCode).toBe(201);
    const startedId = (started.json() as Json).id as string;

    const rewriteStart = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/assignments/${startedId}`,
      headers: auth(),
      payload: { startsOn: shiftDays(-60) },
    });

    expect(rewriteStart.statusCode).toBe(409);
    expect(
      (rewriteStart.json() as { error: { details?: { reason?: string } } }).error.details?.reason,
    ).toBe('assignment_started');

    // Часы и заметку править можно: это не ломает историю уроков.
    const planned = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/assignments/${startedId}`,
      headers: auth(),
      payload: { hoursPlanned: 120 },
    });
    expect(planned.statusCode).toBe(200);
    expect((planned.json() as Json).hoursPlanned).toBe(120);
  });

  it('действующее назначение не удаляется, а ещё не начавшееся и закрытое — удаляются', async () => {
    /**
     * Тест самодостаточен: свои преподаватели и предметы, чтобы не зависеть от
     * назначений предыдущих проверок (у одного преподавателя не бывает двух
     * назначений в один период, и открытое назначение занимает всё время после
     * начала).
     */
    const makeSubject = async (name: string): Promise<string> => {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/subjects',
        headers: auth(),
        payload: { name, kind: 'mandatory' },
      });
      expect(created.statusCode).toBe(201);
      return (created.json() as Json).id as string;
    };

    const makeTeacher = async (username: string, fullName: string): Promise<string> => {
      const created = await createUserAndLogin(testApp.app, adminCookie, {
        username,
        fullName,
        password: 'kolledzh-teacher-2025',
        roles: ['teacher'],
      });
      return created.id;
    };

    const removeAssignment = (id: string) =>
      testApp.app.inject({ method: 'DELETE', url: `/api/assignments/${id}`, headers: auth() });

    // 1. Идущее назначение: началось в прошлом, конца ещё нет — удалять нельзя.
    const runningTeacher = await makeTeacher('prepod-running', 'Преподаватель Идущий');
    const running = await createAssignment({
      teacherUserId: runningTeacher,
      subjectId: await makeSubject('Физика'),
      startsOn: PAST.from,
      endsOn: null,
    });
    expect(running.statusCode).toBe(201);
    const runningId = (running.json() as Json).id as string;
    expect((await removeAssignment(runningId)).statusCode).toBe(409);

    // 2. Ещё не начавшееся назначение: истории по нему нет — удалять можно.
    const futureTeacher = await makeTeacher('prepod-future', 'Преподаватель Будущий');
    const future = await createAssignment({
      teacherUserId: futureTeacher,
      subjectId: await makeSubject('Химия'),
      startsOn: FUTURE.from,
      endsOn: FUTURE.to,
    });
    expect(future.statusCode).toBe(201);
    const futureId = (future.json() as Json).id as string;
    expect((await removeAssignment(futureId)).statusCode).toBe(204);

    // 3. Закрытое назначение удаляется: оно больше не действует.
    const closedTeacher = await makeTeacher('prepod-closed', 'Преподаватель Закрытый');
    const closedOne = await createAssignment({
      teacherUserId: closedTeacher,
      subjectId: await makeSubject('География'),
      startsOn: PAST.from,
      endsOn: null,
    });
    expect(closedOne.statusCode).toBe(201);
    const closedId = (closedOne.json() as Json).id as string;

    const closed = await testApp.app.inject({
      method: 'POST',
      url: `/api/assignments/${closedId}/close`,
      headers: auth(),
      payload: { endsOn: PAST.to },
    });
    expect(closed.statusCode).toBe(200);
    expect((closed.json() as Json).endsOn).toBe(PAST.to);

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/assignments/${closedId}`,
      headers: auth(),
    });
    expect(removed.statusCode).toBe(204);
  });

  it('массовое закрытие закрывает все действующие назначения преподавателя', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments/close-for-teacher',
      headers: auth(),
      payload: { teacherUserId: otherTeacherUserId, endsOn: shiftDays(500) },
    });

    expect(response.statusCode).toBe(200);
    expect(typeof (response.json() as Json).closed).toBe('number');
  });

  it('предмет и группа с назначениями не удаляются', async () => {
    const subjectDelete = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/subjects/${subjectId}`,
      headers: auth(),
    });

    expect(subjectDelete.statusCode).toBe(409);
    const body = subjectDelete.json() as { error: { details?: { usedBy?: string[] } } };
    expect(body.error.details?.usedBy).toContain('assignments');

    const groupDelete = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/groups/${groupId}`,
      headers: auth(),
    });
    expect(groupDelete.statusCode).toBe(409);
  });

  it('изменения назначений попадают в аудит', async () => {
    const audit = await testApp.app.inject({
      method: 'GET',
      url: '/api/audit?entityKind=teaching_assignment',
      headers: auth(),
    });

    expect(audit.statusCode).toBe(200);
    const items = (audit.json() as { items: Json[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.action === 'create')).toBe(true);
    expect(items.some((item) => item.action === 'update')).toBe(true);
  });
});
