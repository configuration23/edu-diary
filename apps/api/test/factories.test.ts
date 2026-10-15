import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, completeSetup, createTestApp, type TestApp } from './helpers/api';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/database';
import { createLessonContext, factories, injectClient } from './helpers/factories';

const describeWithDatabase = describe.skipIf(!hasTestDatabase);

/**
 * Фабрики тестовых данных: проверяем, что они создают рабочий набор.
 *
 * Смысл фабрик — в том, что тест не собирает год, группу, предмет, назначение и урок
 * вручную. Здесь проверяется именно это: после `createLessonContext` можно сразу работать с
 * занятием, а данные согласованы между собой (группа внутри года, ученик зачислен, урок
 * создан по назначению).
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

describeWithDatabase('фабрики тестовых данных', () => {
  let database: TestDatabase;
  let testApp: TestApp;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database.db);
  });

  afterAll(async () => {
    await testApp.close();
    await database.dispose();
  });

  it('создаёт рабочий учебный контекст одним вызовом', async () => {
    const { cookie } = await completeSetup(testApp.app, {
      institution: { title: 'Тестовый колледж', shortName: 'ТК', signature: 'Дневник колледжа' },
      academicYear: { title: 'Текущий год', startsOn: shiftDays(-200), endsOn: shiftDays(200) },
      period: {
        title: 'Текущий семестр',
        kind: 'semester',
        startsOn: shiftDays(-100),
        endsOn: shiftDays(100),
      },
      admin: { username: 'admin', fullName: 'Администратор Системы', password: ADMIN_PASSWORD },
    });

    const run = String(Date.now()).slice(-6);
    const context = factories(injectClient(testApp.app), cookie);

    const created = await createLessonContext(context, {
      run,
      yearStartsOn: shiftDays(-180),
      yearEndsOn: shiftDays(180),
      withStudent: true,
      lessonDate: shiftDays(-1),
    });

    // Всё, что нужно для работы с занятием, получено одним вызовом.
    expect(created.group.id).toBeTruthy();
    expect(created.teacher.cookie).not.toBe('');
    expect(created.student?.id).toBeTruthy();
    expect(created.lesson?.id).toBeTruthy();

    // Данные согласованы: журнал занятия открывается и в нём есть зачисленный ученик.
    const journal = await testApp.app.inject({
      method: 'GET',
      url: `/api/lessons/${created.lesson?.id ?? ''}/journal`,
      headers: { cookie: created.teacher.cookie },
    });

    expect(journal.statusCode, journal.body).toBe(200);
    const students = (journal.json() as { students: Json[] }).students;
    expect(students.map((student) => student.studentId)).toContain(created.student?.id);
  });
});
