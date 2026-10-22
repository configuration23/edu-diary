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
 * Удаление и восстановление отметок (Этап 4, шаг 3).
 *
 * Проверяем то, что нельзя увидеть в интерфейсе: мягкое удаление оставляет строку,
 * удалённое становится видно администратору с причиной и автором, восстановление
 * возвращает отметку и пишет историю, а повторное восстановление не создаёт дублей.
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

describeWithDatabase('удаление и восстановление отметок', () => {
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
  let answerReasonId: string;

  const auth = () => ({ cookie: adminCookie });

  const deletedOf = async (): Promise<{ grades: Json[]; attendance: Json[] }> => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/deleted`,
      headers: auth(),
    });

    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { grades: Json[]; attendance: Json[] };
  };

  const journalOf = async (): Promise<Json> => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });

    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Json;
  };

  const studentRow = (journal: Json): Json => (journal.students as Json[])[0] as Json;

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
      username: 'prepod-udalenie',
      fullName: 'Преподаватель Удаления',
      password: 'kolledzh-udalenie-2025',
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
        name: 'УД-11',
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
      payload: { name: 'Удаление', shortName: 'УД', kind: 'mandatory' },
    });
    expect(subject.statusCode, subject.body).toBe(201);
    subjectId = (subject.json() as Json).id as string;

    const student = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: auth(),
      payload: {
        fullName: 'Ученик Удаления',
        account: {
          mustChangePassword: false,
          username: 'uchenik-udalenie',
          password: 'kolledzh-udalenie-2025',
        },
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
    /** Две разные причины: за урок ставят несколько отметок с разными причинами. */
    homeReasonId = (items.find((item) => item.code === 'Д')?.id as string) ?? '';
    answerReasonId = (items.find((item) => item.code === 'О')?.id as string) ?? '';
    expect(homeReasonId).not.toBe('');
    expect(answerReasonId).not.toBe('');
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('оценка удаляется мягко и попадает в список удалённого с причиной и автором', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '4', categoryId: homeReasonId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const gradeId = (created.json() as Json).id as string;

    // Пока оценка на месте, список удалённого пуст.
    expect((await deletedOf()).grades).toHaveLength(0);

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/grades/${gradeId}`,
      headers: { cookie: teacherCookie },
      payload: { reason: 'Поставлена не тому ученику' },
    });
    expect(removed.statusCode, removed.body).toBe(204);

    // Из журнала отметка ушла, а в списке удалённого видно, что и почему убрали.
    expect(studentRow(await journalOf()).grades).toEqual([]);

    const deleted = await deletedOf();
    expect(deleted.grades).toHaveLength(1);
    expect(deleted.grades[0]?.mark).toBe('4');
    expect(deleted.grades[0]?.deletedReason).toBe('Поставлена не тому ученику');
    expect(deleted.grades[0]?.deletedByName).toBe('Преподаватель Удаления');
    expect(typeof deleted.grades[0]?.deletedAt).toBe('string');
  });

  it('удалённая оценка восстанавливается и возвращается в журнал', async () => {
    const deleted = await deletedOf();
    const gradeId = deleted.grades[0]?.id as string;

    const restored = await testApp.app.inject({
      method: 'POST',
      url: `/api/grades/${gradeId}/restore`,
      headers: auth(),
    });
    expect(restored.statusCode, restored.body).toBe(200);

    expect((await deletedOf()).grades).toHaveLength(0);
    const grades = studentRow(await journalOf()).grades as Json[];
    expect(grades).toHaveLength(1);
    expect(grades[0]?.value).toBe('4');

    // В истории видно и удаление, и восстановление.
    const revisions = await testApp.app.inject({
      method: 'GET',
      url: `/api/grades/${gradeId}/revisions`,
      headers: auth(),
    });
    const actions = ((revisions.json() as { items: Json[] }).items as Json[]).map(
      (item) => item.action,
    );
    expect(actions).toContain('delete');
    expect(actions).toContain('restore');
  });

  it('отметка посещаемости удаляется и восстанавливается, история сохраняется', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: { studentId, status: 'not_present', isExcused: true, reason: 'Справка' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const attendanceId = (created.json() as Json).id as string;

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/attendance/${attendanceId}`,
      headers: { cookie: teacherCookie },
      payload: { reason: 'Ученик был на занятии' },
    });
    expect(removed.statusCode, removed.body).toBe(204);
    expect(studentRow(await journalOf()).attendance).toBeNull();

    const deleted = await deletedOf();
    expect(deleted.attendance).toHaveLength(1);
    expect(deleted.attendance[0]?.status).toBe('not_present');
    expect(deleted.attendance[0]?.isExcused).toBe(true);
    expect(deleted.attendance[0]?.deletedReason).toBe('Ученик был на занятии');

    const restored = await testApp.app.inject({
      method: 'POST',
      url: `/api/attendance/${attendanceId}/restore`,
      headers: auth(),
    });
    expect(restored.statusCode, restored.body).toBe(200);

    const attendance = studentRow(await journalOf()).attendance as Json;
    expect(attendance.status).toBe('not_present');
    expect(attendance.isExcused).toBe(true);

    // История: создание, удаление, восстановление — с подписью буквой журнала.
    const revisions = await testApp.app.inject({
      method: 'GET',
      url: `/api/attendance/${attendanceId}/revisions`,
      headers: auth(),
    });
    const items = (revisions.json() as { items: Json[] }).items;
    expect(items.map((item) => item.action)).toEqual(
      expect.arrayContaining(['create', 'delete', 'restore']),
    );
    expect(items.some((item) => item.before === 'У' || item.after === 'У')).toBe(true);
  });

  it('вторую отметку на того же ученика восстановить нельзя', async () => {
    // Ученик уже отмечен; ставим новую отметку взамен удалённой и пробуем вернуть старую.
    const current = studentRow(await journalOf()).attendance as Json;
    expect(current.status).toBe('not_present');

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/attendance/${current.id as string}`,
      headers: { cookie: teacherCookie },
      payload: { reason: 'Ставим другую отметку' },
    });
    expect(removed.statusCode, removed.body).toBe(204);

    const fresh = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/attendance`,
      headers: { cookie: teacherCookie },
      payload: { studentId, status: 'present' },
    });
    expect(fresh.statusCode, fresh.body).toBe(201);

    const restoreOld = await testApp.app.inject({
      method: 'POST',
      url: `/api/attendance/${current.id as string}/restore`,
      headers: auth(),
    });
    expect(restoreOld.statusCode).toBe(409);
    expect((restoreOld.json() as { error: { details: Json } }).error.details.reason).toBe(
      'attendance_exists',
    );
  });

  it('обычный знак удаляется и восстанавливается', async () => {
    const sign = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, sign: 'plus', categoryId: answerReasonId },
    });
    expect(sign.statusCode, sign.body).toBe(201);
    const signId = (sign.json() as Json).id as string;

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/grades/${signId}`,
      headers: { cookie: teacherCookie },
      payload: { reason: 'Лишний плюс' },
    });
    expect(removed.statusCode, removed.body).toBe(204);

    const restored = await testApp.app.inject({
      method: 'POST',
      url: `/api/grades/${signId}/restore`,
      headers: auth(),
    });
    expect(restored.statusCode, restored.body).toBe(200);
  });

  it('съеденный пересчётом знак восстановить нельзя', async () => {
    /**
     * Знак, превращённый пересчётом в оценку, вернуть нельзя: получился бы и знак, и
     * оценка за него — двойной учёт. Администратор сначала удаляет оценку.
     */
    subjectId = await (async () => {
      const subject = await testApp.app.inject({
        method: 'POST',
        url: '/api/subjects',
        headers: auth(),
        payload: { name: 'Съеденный знак', shortName: 'СЗ', kind: 'mandatory' },
      });
      expect(subject.statusCode, subject.body).toBe(201);
      const id = (subject.json() as Json).id as string;

      await testApp.app.inject({
        method: 'POST',
        url: '/api/assignments',
        headers: auth(),
        payload: { teacherUserId, subjectId: id, studyGroupId: groupId, startsOn: shiftDays(-180) },
      });

      return id;
    })();

    const lesson = await testApp.app.inject({
      method: 'POST',
      url: '/api/lessons',
      headers: auth(),
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
    expect(lesson.statusCode, lesson.body).toBe(201);
    const ownLessonId = (lesson.json() as Json).id as string;

    // Порог 1: одного плюса достаточно, чтобы пересчёт выдал оценку.
    const rule = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/sign-rules/plus',
      headers: auth(),
      payload: { threshold: 1, isActive: true },
    });
    expect(rule.statusCode, rule.body).toBe(200);

    const sign = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${ownLessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, sign: 'plus', categoryId: homeReasonId },
    });
    expect(sign.statusCode, sign.body).toBe(201);
    const signId = (sign.json() as Json).id as string;

    const applied = await testApp.app.inject({
      method: 'POST',
      url: '/api/journal/apply-sign-rules',
      headers: auth(),
      payload: { studyGroupId: groupId, subjectId },
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect((applied.json() as Json).awarded).toBe(1);

    // Пробуем удалить и вернуть съеденный знак.
    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/grades/${signId}`,
      headers: { cookie: teacherCookie },
      payload: { reason: 'Пробуем вернуть съеденный знак' },
    });
    expect(removed.statusCode, removed.body).toBe(204);

    const restored = await testApp.app.inject({
      method: 'POST',
      url: `/api/grades/${signId}/restore`,
      headers: auth(),
    });
    expect(restored.statusCode, restored.body).toBe(409);
    expect((restored.json() as { error: { details: Json } }).error.details.reason).toBe(
      'sign_consumed',
    );
  });

  it('восстанавливать может только администратор', async () => {
    const created = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, value: '3', categoryId: homeReasonId },
    });
    const gradeId = (created.json() as Json).id as string;

    await testApp.app.inject({
      method: 'DELETE',
      url: `/api/grades/${gradeId}`,
      headers: { cookie: teacherCookie },
      payload: { reason: 'Проверка прав' },
    });

    const forbidden = await testApp.app.inject({
      method: 'POST',
      url: `/api/grades/${gradeId}/restore`,
      headers: { cookie: teacherCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    // И удалённое преподавателю не показывают: это список администратора.
    const hidden = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/deleted`,
      headers: { cookie: teacherCookie },
    });
    expect(hidden.statusCode).toBe(403);
  });
});
