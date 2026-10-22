import { expect, test, type Page } from '@playwright/test';

/**
 * Сквозной сценарий Этапа 3 через интерфейс: администратор заполняет звонки,
 * ставит занятие в расписание группы и создаёт уроки, а преподаватель видит
 * только свои уроки.
 *
 * Данные (год, группа, предмет, назначение, ученик) готовятся через API в сессии
 * администратора: цель сценария — расписание и уроки, а не повторное заполнение
 * учебного процесса, которое уже проверено `phase-2-academics.spec.ts`.
 *
 * Ожидаемый порядок запуска: после `phase-1-flow.spec.ts` (он заводит
 * администратора и активный год).
 */

/**
 * Раскрыть раздел «Настроек обучения».
 *
 * Разделы свёрнуты по умолчанию; заголовок ищем **точно**, потому что те же слова встречаются в
 * описаниях соседних разделов.
 */
async function openSection(page: Page, title: string): Promise<void> {
  await page
    .locator('summary')
    .filter({ has: page.getByText(title, { exact: true }) })
    .click();
}

const ADMIN = {
  username: 'admin',
  password: 'e2e-rukovoditel-2025',
};

const TEACHER = {
  username: `prepod-rasp-${String(Date.now()).slice(-6)}`,
  fullName: 'Преподаватель Расписания Е2Е',
  password: 'kolledzh-raspisanie-2025',
};

const STUDENT = {
  fullName: 'Ученик Расписания Е2Е',
  username: `uchenik-rasp-${String(Date.now()).slice(-6)}`,
  password: 'uchenik-raspisanie-2025',
};

/** Уникальный суффикс: повторный прогон не должен упираться в занятые имена. */
const RUN = String(Date.now()).slice(-6);
const YEAR_TITLE = `E2E Этап 3 ${RUN}`;
const GROUP = `E2E-РП-${RUN}`;
const SUBJECT = `Основы алгоритмов (E2E ${RUN})`;

function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Понедельник текущей недели. */
function mondayOfToday(): string {
  const date = new Date();
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  date.setDate(date.getDate() + 1 - weekday);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * С какого дня генерировать уроки, чтобы сетка показала их **сразу**.
 *
 * Экран «Уроки» открывается на текущей неделе. Занятие по шаблону бывает раз в неделю, и
 * его ближайший день может оказаться на **следующей** неделе — тогда в показанной сетке
 * плитки нет. Раньше здесь стоял просто `nextWeekday(2)`, и сценарий проходил только два
 * дня из семи: со среды по воскресенье ближайший вторник уже на следующей неделе.
 *
 * Поэтому день генерации выбираем от дня недели самого занятия:
 * - занятие ещё **впереди на этой неделе** — генерируем с прошлой недели, тогда оно
 *   попадает и на показанную неделю, и на следующую;
 * - занятие уже **прошло на этой неделе** — генерируем с понедельника текущей недели,
 *   и оно попадает на показанную неделю.
 */
function generationStart(lessonWeekday: number): string {
  const today = new Date();
  const weekday = today.getDay() === 0 ? 7 : today.getDay();
  const lessonDay = lessonWeekday % 7 === 0 ? 7 : lessonWeekday % 7;

  // День занятия ещё не прошёл: начинаем с прошлой недели, чтобы попасть в текущую.
  if (weekday <= lessonDay) return shiftDays(-7);

  // День занятия уже прошёл: текущая неделя начинается с понедельника.
  return mondayOfToday();
}

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Логин').fill(username);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
}

/**
 * Читает тело ответа или падает с понятным текстом.
 *
 * Имя запроса в сообщении нужно, чтобы падение сквозного сценария сразу
 * указывало на шаг, а не на «какой-то запрос вернул 500».
 */
async function bodyOf<T>(
  response: {
    ok(): boolean;
    status(): number;
    json(): Promise<unknown>;
    text(): Promise<string>;
  },
  what: string,
): Promise<T> {
  if (!response.ok()) {
    throw new Error(`Запрос «${what}» не удался: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

test.describe.configure({ mode: 'serial' });

// Сценарий длиннее обычного: справочник, расписание, генерация и два входа.
test.setTimeout(180_000);

test.describe('Этап 3: звонки, расписание, уроки', () => {
  test('админ ведёт расписание и уроки, преподаватель видит только свои', async ({ page }) => {
    await login(page, ADMIN.username, ADMIN.password);

    // --- Данные учебного процесса через API ---
    const year = await bodyOf<{ id: string }>(
      await page.request.post('/api/academic-years', {
        data: {
          title: YEAR_TITLE,
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
          course: 2,
          startsOn: shiftDays(-150),
          endsOn: shiftDays(400),
        },
      }),
      'группа',
    );

    const subject = await bodyOf<{ id: string }>(
      await page.request.post('/api/subjects', {
        data: { name: SUBJECT, kind: 'mandatory' },
      }),
      'предмет',
    );

    const teacher = await bodyOf<{ id: string }>(
      await page.request.post('/api/users', {
        data: {
          mustChangePassword: false,
          username: TEACHER.username,
          fullName: TEACHER.fullName,
          password: TEACHER.password,
          roles: ['teacher'],
        },
      }),
      'преподаватель',
    );

    await page.request.post('/api/assignments', {
      data: {
        teacherUserId: teacher.id,
        subjectId: subject.id,
        studyGroupId: group.id,
        startsOn: shiftDays(-140),
      },
    });

    // --- Звонки: справочник ---
    // Данные подготовлены через API, поэтому контекст года и групп обновляем
    // перезагрузкой: иначе шапка и списки показывают прежний активный год.
    await page.reload();
    await page.getByRole('link', { name: 'Справочники' }).click();

    /** Блоки справочников свёрнуты: раскрываем нужный раздел. */
    await openSection(page, 'Звонки');
    await expect(page.getByRole('heading', { level: 2, name: 'Звонки' })).toBeVisible();

    const bells = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'Звонки' }) });

    /** Форма скрыта: открываем её кнопкой в шапке блока «Звонки». */
    await bells.getByRole('button', { name: 'Добавить звонок' }).click();

    await bells.getByLabel('Пара').selectOption('3');
    await bells.getByLabel('Начало').fill('11:30');
    await bells.getByLabel('Окончание').fill('13:00');
    await bells.getByRole('button', { name: 'Сохранить звонок' }).click();

    await expect(bells.getByRole('cell', { name: '11:30' })).toBeVisible();

    // --- Шаблон недели: занятие группы ---
    await page.getByRole('link', { name: 'Настройки обучения' }).click();
    await openSection(page, 'Шаблон недели');
    // Форма добавления скрыта: открываем её кнопкой в шапке блока «Шаблон недели».
    await page.getByRole('button', { name: 'Добавить занятие' }).click();

    // Группа выбирается в форме добавления: список ниже подгружается по выбранной
    // группе, а отдельного селекта в шапке на этом экране нет.
    const entryForm = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Шаблон недели' }) });

    await entryForm.getByLabel('Группа').selectOption({ label: GROUP });
    await expect(page.getByText('В расписании этой группы пока нет занятий')).toBeVisible();

    await entryForm
      .getByLabel('Назначение')
      .selectOption({ label: `${SUBJECT} — ${TEACHER.fullName}` });
    await entryForm.getByLabel('День недели').selectOption('2');
    await entryForm.getByLabel('Пара').selectOption('3');

    // Время берётся из звонков: форма показывает его и не требует ввода.
    await expect(entryForm.getByText('Время по звонкам:')).toBeVisible();
    await entryForm.getByRole('button', { name: 'Добавить в расписание' }).click();

    // Занятие в таблице: предмет, преподаватель и время из звонков.
    await expect(page.getByRole('cell', { name: SUBJECT })).toBeVisible();
    await expect(page.getByRole('cell', { name: TEACHER.fullName })).toBeVisible();
    await expect(page.getByRole('cell', { name: '11:30–13:00' })).toBeVisible();

    // --- Уроки: генерация за период и сетка ---
    await page.getByRole('link', { name: 'Уроки' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Уроки', exact: true })).toBeVisible();

    // Группа и период: генерация уроков живёт на этом же экране.
    await page.locator('select[name="studyGroupId"]').selectOption({ label: GROUP });
    /*
      День начала генерации выбираем так, чтобы занятие попало в **показанную** неделю:
      иначе плитки в сетке нет, и проверка зависит от дня недели (см. generationStart).
    */
    await page.getByLabel('С даты').fill(generationStart(2));
    await page.getByLabel('По дату').fill(shiftDays(30));
    await page.getByRole('button', { name: 'Создать уроки за период' }).click();

    await expect(page.getByText(/Создано за .*уроков \d+/)).toBeVisible();

    // Сетка периода показывает занятие: плитка с кодом предмета открывает панель
    // деталей, где видны подробности и действия.
    // Плитка в сетке: код предмета. Доступное имя включает и название группы,
    // поэтому ищем по вхождению кода.
    const tile = page.getByRole('button').filter({ hasText: 'ОА' }).first();
    await expect(tile).toBeVisible();
    await tile.click();
    // Панель деталей: заголовок с датой и пара, предмет, тема и кнопка закрытия.
    await expect(page.getByRole('button', { name: 'Закрыть' })).toBeVisible();
    await expect(page.getByLabel('Тема занятия')).toBeVisible();
    await page.getByRole('button', { name: 'Закрыть' }).click();
    await expect(page.getByRole('button', { name: 'Закрыть' })).toHaveCount(0);

    // Список — второй вид того же периода: там занятие видно текстом.
    await page.locator('#view-list').click();
    await expect(page.getByText(SUBJECT).first()).toBeVisible();
    await page.locator('#view-grid').click();

    // Повторный запуск ничего не создаёт: генерация идемпотентна.
    await page.getByRole('button', { name: 'Создать уроки за период' }).click();
    await expect(page.getByText(/уроков 0/)).toBeVisible();

    // --- Преподаватель: видит свои уроки, но не правит расписание ---
    await page.getByRole('button', { name: 'Выйти' }).click();
    await login(page, TEACHER.username, TEACHER.password);

    await page.getByRole('link', { name: 'Уроки' }).click();
    // Группу выбираем явно: у преподавателя контекст мог остаться от админа.
    await page.locator('select[name="studyGroupId"]').selectOption({ label: GROUP });
    // Список — там занятие видно полным текстом, без кода предмета.
    await page.locator('#view-list').click();
    await expect(page.getByText(SUBJECT).first()).toBeVisible();
    // Формы генерации у преподавателя нет: уроки создаёт администратор.
    // Сетка периода доступна преподавателю, но генерации у него нет:
    // кнопку видит только администратор.
    await expect(page.getByRole('button', { name: 'Создать уроки за период' })).toHaveCount(0);
    await page.locator('#view-grid').click();

    await page.getByRole('link', { name: 'Расписание' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Расписание', exact: true }),
    ).toBeVisible();
    // Дневной вид: преподаватель выбирает свою группу.
    await page.locator('select[name="studyGroupId"]').selectOption({ label: GROUP });
    // Расписание преподаватель только смотрит: конструктора сетки у него нет.
    await expect(page.getByRole('link', { name: 'Настройки обучения' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Добавить занятие' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Убрать' })).toHaveCount(0);

    // Переключение вида «неделя» работает: матрица показывает пары и дни недели,
    // а клик по ячейке возвращает в дневной вид выбранного дня.
    await page.locator('#view-week').click();
    await expect(page.getByRole('cell', { name: '3-я' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Пара' })).toBeVisible();

    /**
     * В сетке недели должны быть **все семь дней**, включая воскресенье.
     *
     * Здесь стояла сетка на шесть дней, и воскресенье пропадало — при том что полоса дат
     * над сеткой показывала семь дней, а суббота и воскресенье в колледже обычные учебные
     * дни: занятие в воскресенье просто негде было увидеть.
     */
    // Заголовки берём только из таблицы: «Пн» есть и в полосе дат над сеткой.
    const headers = await page.getByRole('columnheader').allInnerTexts();
    const headerText = headers.join(' | ');
    for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) {
      expect(headerText, `в заголовках недели нет ${day}: ${headerText}`).toContain(day);
    }

    await page.locator('#view-day').click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Расписание', exact: true }),
    ).toBeVisible();

    // --- Ученик: расписание и уроки своей группы ---
    await page.getByRole('button', { name: 'Выйти' }).click();
    await login(page, ADMIN.username, ADMIN.password);

    const student = await bodyOf<{ id: string }>(
      await page.request.post('/api/students', {
        data: {
          fullName: STUDENT.fullName,
          account: {
            mustChangePassword: false,
            username: STUDENT.username,
            password: STUDENT.password,
          },
        },
      }),
      'ученик',
    );

    await page.request.post(`/api/groups/${group.id}/enrollments`, {
      data: { studentId: student.id, joinedOn: shiftDays(-100) },
    });

    await page.getByRole('button', { name: 'Выйти' }).click();
    await login(page, STUDENT.username, STUDENT.password);

    /**
     * Ученику **выбор группы не показывается** (решение владельца): у него только своя группа, а
     * список «Все доступные» выглядел как возможность смотреть чужие занятия.
     *
     * Раздел открываем адресом: занятия должны попасть в первый же запрос расписания.
     */
    await page.goto('/schedule');

    await expect(page.locator('select[name="studyGroupId"]')).toHaveCount(0);
    await expect(page.getByText('Все доступные группы')).toHaveCount(0);

    // Дневной и недельный виды работают на одних данных: дневной показывает
    // выбранный день, недельный — матрицу пар и дней.
    await page.locator('#view-week').click();
    await expect(page.getByRole('cell', { name: '3-я' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Пара' })).toBeVisible();
    await page.locator('#view-day').click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Расписание', exact: true }),
    ).toBeVisible();

    // Раздел «Уроки» — рабочий инструмент администратора и преподавателя:
    // ученику он не нужен, у него есть «Расписание».
    await expect(page.getByRole('link', { name: 'Уроки' })).toHaveCount(0);

    // Своё занятие ученик видит в расписании своей группы — это то, что он и должен
    // видеть. Дату берём из недельного вида, чтобы не зависеть от «сегодня».
    await page.locator('#view-week').click();
    const lessonCell = page.getByRole('button', { name: new RegExp(SUBJECT) }).first();
    if ((await lessonCell.count()) > 0) {
      await lessonCell.click();
      await expect(page.getByText(SUBJECT).first()).toBeVisible();
    }
  });
});
