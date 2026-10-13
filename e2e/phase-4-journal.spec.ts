import { expect, test, type Page } from '@playwright/test';

/**
 * Этап 4: журнал урока — оценки и посещаемость.
 *
 * Сквозной сценарий повторяет работу на уроке: администратор готовит данные,
 * преподаватель открывает журнал, ставит оценки с причинами, отмечает
 * посещаемость («Н» с необязательной уважительной причиной) и правит оценку.
 * Ученик видит только свои отметки.
 *
 * Учебный год и период строятся вокруг **сегодняшней** даты: журнал работает по
 * урокам, а уроки создаются на будущие даты внутри года.
 */

const RUN = String(Date.now()).slice(-6);
const SUBJECT = `Информатика (E2E ${RUN})`;
const GROUP = `ИВТ-${RUN}`;
const TEACHER_NAME = `Преподаватель Журнала ${RUN}`;
const STUDENT_NAME = `Ученик Журнала ${RUN}`;
const ADMIN = { username: 'admin', password: 'e2e-rukovoditel-2025' };
const TEACHER = {
  username: `e2e-prepod-zhurnal-${RUN}`,
  fullName: TEACHER_NAME,
  password: 'kolledzh-zhurnal-prepod-2025',
};
const STUDENT = {
  username: `e2e-uchenik-zhurnal-${RUN}`,
  fullName: STUDENT_NAME,
  password: 'kolledzh-zhurnal-uchenik-2025',
};

function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Дата нужного дня недели: сегодня, если совпало, иначе ближайший такой день. */
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

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('Логин').fill(username);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
}

/** Тело ответа с проверкой: тест не должен молча продолжать после ошибки. */
async function bodyOf<T>(
  response: { ok(): boolean; status(): number; text(): Promise<string>; json(): Promise<unknown> },
  what: string,
): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${what}: ${response.status()} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

test('Этап 4: журнал урока — оценки с причинами, посещаемость с уважительной', async ({ page }) => {
  await page.goto('/');
  await login(page, ADMIN.username, ADMIN.password);
  // Ждём, пока сессия установлена: иначе запросы к API уйдут без cookie.
  await expect(page.getByRole('link', { name: 'Учебный год' })).toBeVisible();

  // --- Данные учебного процесса через API ---
  const year = await bodyOf<{ id: string }>(
    await page.request.post('/api/academic-years', {
      data: {
        title: `Год ${RUN}`,
        startsOn: shiftDays(-200),
        endsOn: shiftDays(500),
        isActive: true,
      },
    }),
    'учебный год',
  );

  const group = await bodyOf<{ id: string }>(
    await page.request.post('/api/groups', {
      data: {
        academicYearId: year.id,
        name: GROUP,
        startsOn: shiftDays(-150),
        endsOn: shiftDays(400),
      },
    }),
    'группа',
  );

  const subject = await bodyOf<{ id: string }>(
    await page.request.post('/api/subjects', {
      data: { name: SUBJECT, shortName: 'ИНФ', kind: 'mandatory' },
    }),
    'предмет',
  );

  const teacher = await bodyOf<{ id: string }>(
    await page.request.post('/api/users', {
      data: {
        username: TEACHER.username,
        fullName: TEACHER.fullName,
        password: TEACHER.password,
        roles: ['teacher'],
      },
    }),
    'преподаватель',
  );

  const assignment = await bodyOf<{ id: string }>(
    await page.request.post('/api/assignments', {
      data: {
        teacherUserId: teacher.id,
        subjectId: subject.id,
        studyGroupId: group.id,
        startsOn: shiftDays(-140),
      },
    }),
    'назначение',
  );

  const student = await bodyOf<{ id: string }>(
    await page.request.post('/api/students', {
      data: {
        fullName: STUDENT.fullName,
        account: { username: STUDENT.username, password: STUDENT.password },
      },
    }),
    'ученик',
  );

  await page.request.post(`/api/groups/${group.id}/enrollments`, {
    data: { studentId: student.id, joinedOn: shiftDays(-100) },
  });

  // Шаблон занятия и генерация уроков: журнал всегда привязан к уроку.
  await page.request.post('/api/schedule', {
    data: {
      assignmentId: assignment.id,
      dayOfWeek: 2,
      pairNumber: 1,
      timeStart: '08:30',
      timeEnd: '10:00',
      validFrom: shiftDays(-30),
    },
  });

  const generated = await bodyOf<{ created: number }>(
    await page.request.post('/api/lessons/generate', {
      data: { studyGroupId: group.id, from: nextWeekday(2), to: shiftDays(20) },
    }),
    'генерация уроков',
  );
  expect(generated.created).toBeGreaterThan(0);

  const lessons = await bodyOf<{ items: Array<{ id: string }> }>(
    await page.request.get(
      `/api/lessons?studyGroupId=${group.id}&from=${nextWeekday(2)}&to=${shiftDays(20)}`,
    ),
    'уроки',
  );
  const lessonId = lessons.items[0]?.id ?? '';
  expect(lessonId).not.toBe('');

  // --- Преподаватель ведёт журнал ---
  await page.getByRole('button', { name: 'Выйти' }).click();
  await login(page, TEACHER.username, TEACHER.password);
  await expect(page.getByRole('link', { name: 'Уроки' })).toBeVisible();

  // Сначала проверяем API: интерфейс покажет то же, но по API сразу видно,
  // в правах дело или в вёрстке.
  const journalApi = await page.request.get(`/api/lessons/${lessonId}/journal`);
  expect(journalApi.status(), await journalApi.text()).toBe(200);

  await page.goto(`/lessons/${lessonId}`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Журнал урока', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(SUBJECT).first()).toBeVisible();

  /**
   * Ученика ищем по ячейке таблицы: рядом с ФИО в той же строке стоят кнопки
   * выставления оценки, поэтому точное совпадение по тексту не срабатывает.
   */
  const studentRow = page.getByRole('row', { name: new RegExp(STUDENT_NAME) });
  await expect(studentRow).toBeVisible();

  // Оценка ставится в два шага: цифра, затем причина (она обязательна).
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByLabel('Причина').selectOption({ label: 'Д — Домашнее задание' });
  await page.getByRole('button', { name: 'Поставить' }).click();
  // Оценка читается как «5д»: вес 1 не показывается, код причины — надстрочно.
  // Доступное имя кнопки даёт расшифровку: «5, Домашнее задание».
  await expect(page.getByRole('button', { name: '5, Домашнее задание' })).toBeVisible();

  // Вторая оценка за тот же урок с другой причиной: их может быть несколько.
  await page.getByRole('button', { name: '4', exact: true }).click();
  await page.getByLabel('Причина').selectOption({ label: 'К — Контрольная работа' });
  await page.getByRole('button', { name: 'Поставить' }).click();
  await expect(page.getByRole('button', { name: '4, Контрольная работа' })).toBeVisible();

  // Добираем отметки до шести: проверяем, что в строку помещается не больше пяти.
  for (const [value, reason] of [
    ['4', 'О — Ответ на уроке'],
    ['3', 'П — Поведение'],
    ['5', 'С — Самостоятельная работа'],
    ['2', 'Т — Тест'],
  ] as const) {
    await page.getByRole('button', { name: value, exact: true }).click();
    await page.getByLabel('Причина').selectOption({ label: reason });
    await page.getByRole('button', { name: 'Поставить' }).click();
  }

  /**
   * Проверяем перенос по порядку отметок в ряду, а не по подписям: отметки
   * добавлялись в разном порядке, и «шестая» по счёту — не то же самое, что
   * шестая по подписи. Берём только кнопки отметок: в тех же ячейках живут
   * кнопки выбора причины и панель правки.
   */
  const marks = studentRow.locator('ul.marks-row > li > button[aria-label]');
  await expect(marks).toHaveCount(6);

  const boxes = await marks.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
  );

  // В первой строке ровно пять отметок, шестая ушла на следующую.
  const firstLine = boxes.filter((top) => top === boxes[0]).length;
  expect(firstLine).toBe(5);
  expect(boxes[5]).toBeGreaterThan(boxes[0] ?? 0);

  // Дубль с той же причиной: сервер отказывает, интерфейс предлагает замену.
  await page.getByRole('button', { name: '3', exact: true }).click();
  await page.getByLabel('Причина').selectOption({ label: 'Д — Домашнее задание' });
  await page.getByRole('button', { name: 'Поставить' }).click();
  await expect(
    page.getByText('Уже есть отметка с этой причиной за урок — заменить её новой?'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Заменить' }).click();
  /**
   * После замены в журнале две отметки: «4» за контрольную и «3» за домашнее
   * задание вместо прежней «5». Исчезновение «5» — самое важное здесь: замена не
   * должна оставлять старую отметку рядом с новой.
   */
  await expect(page.getByRole('button', { name: '3, Домашнее задание' })).toBeVisible();
  await expect(page.getByRole('button', { name: '5, Домашнее задание' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '4, Контрольная работа' })).toBeVisible();

  // Посещаемость: «Н» открывает окно с необязательной уважительной причиной.
  await page.getByRole('button', { name: 'Н', exact: true }).first().click();
  await expect(
    page.getByText('«Н» — не был. Отметьте уважительную причину, если она есть.'),
  ).toBeVisible();
  // Точное имя: без него «Ок» совпадает и с кнопками подтверждения в других окнах.
  await page.getByRole('button', { name: 'Ок', exact: true }).click();
  // Проставленная посещаемость обозначена только буквой, расшифровка — в подсказке.
  await expect(page.getByTitle('Не был')).toBeVisible();

  // Правка оценки: нажатие на саму оценку, причина правки обязательна.
  await page.getByRole('button', { name: '3, Домашнее задание' }).click();
  const saveEdit = page.getByRole('button', { name: 'Сохранить правку' });
  await expect(saveEdit).toBeDisabled();

  /**
   * Панель правки — отдельная строка под строкой ученика во всю ширину таблицы.
   * Раньше она попадала между отметками и посещаемостью и выглядела лишним
   * столбцом, поэтому проверяем положение, а не только наличие панели.
   */
  const panelRow = page.locator('tr', { has: saveEdit });
  const studentRowBox = await studentRow.boundingBox();
  const panelBox = await panelRow.boundingBox();
  const tableBox = await page.locator('table').boundingBox();

  expect(panelBox).not.toBeNull();
  expect(studentRowBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
  expect(panelBox?.y).toBeGreaterThan(studentRowBox?.y ?? 0);
  expect(panelBox?.width).toBe(tableBox?.width);

  await page.getByLabel('Новая оценка').selectOption('2');
  await page.getByLabel('Причина правки').fill('Опечатка при выставлении');
  await saveEdit.click();
  await expect(page.getByRole('button', { name: '2, Домашнее задание' })).toBeVisible();

  // --- Ученик видит только свои отметки ---
  await page.getByRole('button', { name: 'Выйти' }).click();
  await login(page, STUDENT.username, STUDENT.password);
  await expect(page.getByRole('link', { name: 'Расписание' })).toBeVisible();

  await page.goto(`/lessons/${lessonId}`);
  await expect(page.getByRole('row', { name: new RegExp(STUDENT_NAME) })).toBeVisible();
  // Ставить оценки ученик не может: кнопок выставления нет.
  await expect(page.getByRole('button', { name: '5', exact: true })).toHaveCount(0);
});
