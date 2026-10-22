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
 * Пересчёт «плюсы и точки → оценка» (Этап 4, шаг 2).
 *
 * Здесь проверяется механика, которую нельзя увидеть в интерфейсе: сколько знаков
 * съедает одна оценка, какой датой она ставится, что остаётся в журнале, что
 * попадает в аудит и почему повторный пересчёт ничего не меняет.
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

describeWithDatabase('пересчёт знаков в оценки', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let adminCookie: string;
  let teacherCookie: string;
  let groupId: string;
  let subjectId: string;
  let teacherUserId: string;
  let studentId: string;
  /** Причины: домашнее задание, ответ на уроке и самостоятельная работа. */
  let homeReasonId: string;
  let answerReasonId: string;
  let selfReasonId: string;

  const auth = () => ({ cookie: adminCookie });

  /**
   * Уроки на заданные даты: знаки ставятся в уроки, поэтому «01.09», «03.09» и
   * остальные даты из примера владельца должны существовать как занятия.
   */
  const createLessons = async (dates: string[]): Promise<Map<string, string>> => {
    const map = new Map<string, string>();

    for (const [index, date] of dates.entries()) {
      const created = await testApp.app.inject({
        method: 'POST',
        url: '/api/lessons',
        headers: auth(),
        payload: {
          studyGroupId: groupId,
          subjectId,
          teacherUserId,
          lessonDate: date,
          pairNumber: index + 1,
          timeStart: '08:30',
          timeEnd: '10:00',
        },
      });

      expect(created.statusCode, created.body).toBe(201);
      map.set(date, (created.json() as Json).id as string);
    }

    return map;
  };

  /** Идентификатор урока по дате: без него тест молча проверял бы не тот урок. */
  /**
   * Включить пересчёт с нужным порогом.
   *
   * Каждый сценарий задаёт порог сам: иначе он зависит от того, что выставил
   * предыдущий тест, и падает при запуске одного теста или в другом порядке.
   */
  const enableSign = async (sign: 'plus' | 'dot', threshold: number): Promise<void> => {
    const response = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/sign-rules/${sign}`,
      headers: auth(),
      payload: { threshold, isActive: true },
    });

    expect(response.statusCode, response.body).toBe(200);
  };

  const lessonAt = (lessons: Map<string, string>, date: string): string => {
    const id = lessons.get(date);
    if (id === undefined) throw new Error(`урок на ${date} не создан`);
    return id;
  };

  const putSign = async (
    lessonId: string,
    sign: 'plus' | 'dot',
    categoryId: string,
  ): Promise<void> => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: `/api/lessons/${lessonId}/grades`,
      headers: { cookie: teacherCookie },
      payload: { studentId, sign, categoryId },
    });

    expect(response.statusCode, response.body).toBe(201);
  };

  const journalOf = async (lessonId: string): Promise<Json> => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${lessonId}/journal`,
      headers: auth(),
    });

    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Json;
  };

  const gradesOf = (journal: Json): Json[] =>
    ((journal.students as Json[])[0]?.grades as Json[]) ?? [];

  /**
   * Пересчёт по группе.
   *
   * Пересчёт в жизни идёт по всей группе, но в тестах это означает, что в него
   * попадают свободные знаки других сценариев: тогда «выдано 1» превращается в «2»
   * из-за чужого знака. Поэтому по умолчанию ограничиваем пересчёт текущим
   * предметом сценария, а полноту по группе проверяем отдельно.
   */
  const apply = async (): Promise<Json> => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/journal/apply-sign-rules',
      headers: auth(),
      payload: { studyGroupId: groupId, subjectId },
    });

    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Json;
  };

  /**
   * Отдельный предмет на каждый сценарий.
   *
   * Счётчик знаков ведётся по предмету и периоду: на общем предмете знаки одного
   * сценария попадали бы в счётчик другого, и проверки мешали бы друг другу.
   */
  let subjectCounter = 0;
  const freshSubject = async (): Promise<string> => {
    subjectCounter += 1;
    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: {
        name: `Пересчёт ${String(subjectCounter)}`,
        shortName: `П${String(subjectCounter)}`,
        kind: 'mandatory',
      },
    });
    expect(subject.statusCode, subject.body).toBe(201);
    const id = (subject.json() as Json).id as string;

    const assignment = await testApp.app.inject({
      method: 'POST',
      url: '/api/assignments',
      headers: auth(),
      payload: { teacherUserId, subjectId: id, studyGroupId: groupId, startsOn: shiftDays(-180) },
    });
    expect(assignment.statusCode, assignment.body).toBe(201);

    return id;
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
    const yearStartsOn = year?.startsOn ?? shiftDays(-100);
    const yearEndsOn = year?.endsOn ?? shiftDays(100);

    const teacher = await createUserAndLogin(testApp.app, adminCookie, {
      username: 'prepod-pereschet',
      fullName: 'Преподаватель Пересчёта',
      password: 'kolledzh-pereschet-2025',
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
        name: 'ПС-11',
        startsOn: yearStartsOn,
        endsOn: yearEndsOn,
      },
    });
    expect(group.statusCode, group.body).toBe(201);
    groupId = (group.json() as Json).id as string;

    const subject = await testApp.app.inject({
      method: 'POST',
      url: '/api/subjects',
      headers: auth(),
      payload: { name: 'Пересчёт', shortName: 'ПС', kind: 'mandatory' },
    });
    expect(subject.statusCode, subject.body).toBe(201);
    subjectId = (subject.json() as Json).id as string;

    const student = await testApp.app.inject({
      method: 'POST',
      url: '/api/students',
      headers: auth(),
      payload: {
        fullName: 'Ученик Пересчёта',
        account: {
          mustChangePassword: false,
          username: 'uchenik-pereschet',
          password: 'kolledzh-pereschet-2025',
        },
      },
    });
    expect(student.statusCode, student.body).toBe(201);
    studentId = (student.json() as Json).id as string;

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

    const reasons = await testApp.app.inject({
      method: 'GET',
      url: '/api/grade-categories',
      headers: auth(),
    });
    const items = (reasons.json() as { items: Json[] }).items;
    homeReasonId = (items.find((item) => item.code === 'Д')?.id as string) ?? '';
    answerReasonId = (items.find((item) => item.code === 'О')?.id as string) ?? '';
    selfReasonId = (items.find((item) => item.code === 'С')?.id as string) ?? '';
    expect(homeReasonId).not.toBe('');
    expect(answerReasonId).not.toBe('');
    expect(selfReasonId).not.toBe('');
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('накопительные знаки «из коробки»: плюсы и точки с порогом 5 и выключенные', async () => {
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/sign-rules',
      headers: auth(),
    });

    expect(response.statusCode, response.body).toBe(200);
    const items = (response.json() as { items: Json[] }).items;
    expect(items.map((item) => item.sign).sort()).toEqual(['dot', 'plus']);
    expect(items.every((item) => item.threshold === 5)).toBe(true);
    // По умолчанию пересчёт выключен: оценки за знаки не начинаются сами.
    expect(items.every((item) => item.isActive === false)).toBe(true);
  });

  it('включает и настраивает порог', async () => {
    const tooSmall = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/sign-rules/plus',
      headers: auth(),
      payload: { threshold: 0 },
    });
    expect(tooSmall.statusCode).toBe(400);

    const enabled = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/sign-rules/plus',
      headers: auth(),
      payload: { threshold: 3, isActive: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    expect((enabled.json() as Json).threshold).toBe(3);
    expect((enabled.json() as Json).isActive).toBe(true);
  });

  it('журнал показывает, сколько знаков осталось до оценки', async () => {
    /**
     * Ошибка из проверки владельцем: при пороге 3 и двух плюсах журнал писал
     * «до оценки: 2» — то есть сколько уже выставлено, а не сколько осталось.
     */
    subjectId = await freshSubject();
    await enableSign('plus', 3);

    /**
     * Даты — в своей полосе, не пересекающейся с другими сценариями: занятия разных
     * проверок не должны стоять на одних и тех же числах.
     */
    const dates = [shiftDays(-45), shiftDays(-44), shiftDays(-43)];
    const lessons = await createLessons(dates);

    const remainingOn = async (date: string): Promise<number> => {
      const journal = await journalOf(lessonAt(lessons, date));
      const signs = (journal.students as Json[])[0]?.signs as Json;
      return signs.plusRemaining as number;
    };

    await putSign(lessonAt(lessons, dates[0] as string), 'plus', homeReasonId);
    expect(await remainingOn(dates[0] as string)).toBe(2);

    await putSign(lessonAt(lessons, dates[1] as string), 'plus', homeReasonId);
    expect(await remainingOn(dates[1] as string)).toBe(1);

    // Порог набран: до оценки ничего не осталось, её можно выдать.
    await putSign(lessonAt(lessons, dates[2] as string), 'plus', homeReasonId);
    expect(await remainingOn(dates[2] as string)).toBe(0);
  });

  it('пример владельца: три плюса дают «5» датой последнего знака, четвёртый остаётся', async () => {
    // Свой предмет: знаки этого сценария не должны попадать в чужие счётчики.
    subjectId = await freshSubject();

    await enableSign('plus', 3);

    const dates = [shiftDays(-28), shiftDays(-26), shiftDays(-25), shiftDays(-22)];
    const lessons = await createLessons(dates);

    // Четыре плюса с разными причинами: д.з., ответ на уроке, самостоятельная, д.з.
    await putSign(lessons.get(dates[0] as string) as string, 'plus', homeReasonId);
    await putSign(lessons.get(dates[1] as string) as string, 'plus', answerReasonId);
    await putSign(lessons.get(dates[2] as string) as string, 'plus', selfReasonId);
    await putSign(lessons.get(dates[3] as string) as string, 'plus', homeReasonId);

    const before = await journalOf(lessonAt(lessons, dates[3] as string));
    expect(gradesOf(before)).toHaveLength(1);
    expect(gradesOf(before)[0]?.sign).toBe('plus');

    const result = await apply();
    expect(result.awarded).toBe(1);

    /**
     * Оценка стоит датой **последнего** знака, добравшего счётчик, — то есть на
     * уроке от 04.09 в примере владельца — это третий по счёту урок. Оценку ищем по
     * значению: порядок показа отметок в интерфейсе роли не играет.
     */
    const onFilledLesson = await journalOf(lessonAt(lessons, dates[2] as string));
    const created = gradesOf(onFilledLesson).filter((grade) => grade.value === '5');
    expect(created).toHaveLength(1);
    expect(created[0]?.sign).toBeNull();

    // Съеденные знаки ушли, а лишний (четвёртый) остался в журнале.
    const onLastLesson = await journalOf(lessonAt(lessons, dates[3] as string));
    expect(gradesOf(onLastLesson)).toHaveLength(1);
    expect(gradesOf(onLastLesson)[0]?.sign).toBe('plus');
  });

  it('съеденные знаки не показываются в журнале на своих уроках', async () => {
    /**
     * Баг из проверки владельцем: после пересчёта знаки пропали из счётчика, но
     * остались в списке отметок урока. Журнал должен показывать только оценку,
     * которая за них поставлена.
     *
     * Предмет и даты — свои: знаки прошлых сценариев в счётчик не попадают.
     */
    subjectId = await freshSubject();

    await enableSign('plus', 2);

    const dates = [shiftDays(-8), shiftDays(-7)];
    const lessons = await createLessons(dates);
    await putSign(lessonAt(lessons, dates[0] as string), 'plus', homeReasonId);
    await putSign(lessonAt(lessons, dates[1] as string), 'plus', answerReasonId);

    expect((await apply()).awarded).toBe(1);

    // На уроке последнего знака остаётся только оценка, самого знака нет.
    const lastLesson = gradesOf(await journalOf(lessonAt(lessons, dates[1] as string)));
    expect(lastLesson).toHaveLength(1);
    expect(lastLesson[0]?.value).toBe('5');
    expect(lastLesson.some((grade) => grade.sign !== null)).toBe(false);

    // И на уроке первого знака тоже пусто: он съеден.
    const firstLesson = gradesOf(await journalOf(lessonAt(lessons, dates[0] as string)));
    expect(firstLesson).toHaveLength(0);
  });

  it('повторный пересчёт ничего не меняет', async () => {
    const again = await apply();
    expect(again.awarded).toBe(0);

    const once = await apply();
    expect(once.awarded).toBe(0);
  });

  it('точки дают «2», а не «5»', async () => {
    subjectId = await freshSubject();

    const enableDot = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/sign-rules/dot',
      headers: auth(),
      payload: { threshold: 2, isActive: true },
    });
    expect(enableDot.statusCode, enableDot.body).toBe(200);

    await enableSign('dot', 2);

    const dates = [shiftDays(-19), shiftDays(-18)];
    const lessons = await createLessons(dates);
    await putSign(lessonAt(lessons, dates[0] as string), 'dot', homeReasonId);
    await putSign(lessonAt(lessons, dates[1] as string), 'dot', answerReasonId);

    const result = await apply();
    expect(result.awarded).toBe(1);

    const journal = await journalOf(lessonAt(lessons, dates[1] as string));
    const dots = gradesOf(journal).filter((grade) => grade.value === '2');
    expect(dots).toHaveLength(1);
  });

  it('шесть плюсов при пороге 3 дают две оценки, а не одну', async () => {
    // Свой предмет: счётчик начинается с нуля, иначе знаки прошлых сценариев
    // добирали бы лишние оценки.
    subjectId = await freshSubject();

    await enableSign('plus', 3);

    const dates = [
      shiftDays(-15),
      shiftDays(-14),
      shiftDays(-13),
      shiftDays(-12),
      shiftDays(-11),
      shiftDays(-10),
    ];
    const lessons = await createLessons(dates);
    for (const date of dates) {
      await putSign(lessonAt(lessons, date), 'plus', homeReasonId);
    }

    const result = await apply();
    expect(result.awarded).toBe(2);

    /**
     * Оценка ставится на урок последнего знака в наборе, поэтому ищем по всем
     * урокам: первая «5» — на третьем, вторая — на шестом.
     */
    const perLesson: Record<string, unknown[]> = {};
    const fives: Json[] = [];
    for (const date of dates) {
      const journal = await journalOf(lessonAt(lessons, date));
      const grades = gradesOf(journal);
      perLesson[date] = grades.map((grade) => ({ value: grade.value, sign: grade.sign }));
      fives.push(...grades.filter((grade) => grade.value === '5'));
    }

    expect(fives, `оценки по урокам: ${JSON.stringify(perLesson)}`).toHaveLength(2);
  });

  it('выключенный знак не пересчитывается', async () => {
    subjectId = await freshSubject();

    /** Порог задаём, но пересчёт оставляем выключенным: проверяем именно выключатель. */
    const configured = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/sign-rules/plus',
      headers: auth(),
      payload: { threshold: 3, isActive: false },
    });
    expect(configured.statusCode, configured.body).toBe(200);

    const dates = [shiftDays(-6), shiftDays(-5), shiftDays(-4)];
    const lessons = await createLessons(dates);
    for (const date of dates) {
      await putSign(lessonAt(lessons, date), 'plus', homeReasonId);
    }

    const result = await apply();
    expect(result.awarded).toBe(0);

    // Знаки остались на месте: пересчёт выключен. Считаем по всем урокам —
    // каждый знак лежит на своём.
    const remaining: Json[] = [];
    for (const date of dates) {
      const journal = await journalOf(lessonAt(lessons, date));
      remaining.push(...gradesOf(journal).filter((grade) => grade.sign === 'plus'));
    }

    expect(remaining).toHaveLength(3);
  });

  it('выданная оценка — обычная: её можно править и удалить', async () => {
    subjectId = await freshSubject();

    await enableSign('dot', 2);

    const dates = [shiftDays(-2), shiftDays(-1)];
    const lessons = await createLessons(dates);

    const enabled = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/sign-rules/dot',
      headers: auth(),
      payload: { threshold: 2, isActive: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);

    await putSign(lessonAt(lessons, dates[0] as string), 'dot', homeReasonId);
    await putSign(lessonAt(lessons, dates[1] as string), 'dot', answerReasonId);
    await apply();

    const journal = await journalOf(lessonAt(lessons, dates[1] as string));
    const created = gradesOf(journal).find((grade) => grade.value === '2');
    expect(created).toBeDefined();

    const updated = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/grades/${created?.id as string}`,
      headers: { cookie: teacherCookie },
      payload: { value: '3', reason: 'Исправление после пересчёта' },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect((updated.json() as Json).value).toBe('3');

    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/grades/${created?.id as string}`,
      headers: { cookie: teacherCookie },
      payload: { reason: 'Оценка поставлена по ошибке' },
    });
    expect(removed.statusCode, removed.body).toBe(204);
  });

  it('преподавателю пересчёт запрещён', async () => {
    const forbidden = await testApp.app.inject({
      method: 'POST',
      url: '/api/journal/apply-sign-rules',
      headers: { cookie: teacherCookie },
      payload: { studyGroupId: groupId },
    });

    expect(forbidden.statusCode).toBe(403);
  });
});
