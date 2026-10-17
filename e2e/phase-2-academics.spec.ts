import { expect, test, type Page } from '@playwright/test';

/**
 * Сквозной сценарий Этапа 2 через интерфейс: админ ведёт учебный год, группу и
 * назначение, а преподаватель видит только своё назначение.
 *
 * Сценарий самодостаточен: в отличие от `phase-1-flow.spec.ts` он не проходит
 * мастер настройки, а опирается на уже настроенную базу (её готовит команда
 * `npm run e2e:isolated`). Учётные записи создаются заранее через API, потому
 * что экрана управления пользователями это не касается — цель теста в разделах
 * учебного процесса.
 *
 * Ожидаемый порядок запуска: сначала `phase-1-flow.spec.ts` (он заводит
 * администратора), затем этот файл.
 */

/**
 * Раскрыть раздел «Учебного процесса».
 *
 * Разделы свёрнуты по умолчанию (решение владельца): страница должна открываться обзором. Строка
 * `<summary>` — единственная нажимаемая часть спойлера.
 *
 * Заголовок ищем **точно**: в описании соседних разделов встречаются те же слова — «группы» есть и
 * в описании учебных годов, и поиск по вхождению находил сразу два спойлера.
 */
async function openSection(page: Page, title: string): Promise<void> {
  await page
    .locator('summary')
    .filter({ has: page.getByText(title, { exact: true }) })
    .click();
}

const ADMIN = {
  username: 'admin',
  // Пароль администратора не меняется сценарием Этапа 1.
  password: 'e2e-rukovoditel-2025',
};

const CURATOR = {
  username: 'prepod-gruppy-e2e',
  fullName: 'Преподаватель Групповой',
  // Пароль берётся администратором, поэтому он не содержит логин.
  password: 'kolledzh-gruppy-2025',
};

const SUBJECT = 'Информатика (E2E)';
const GROUP = 'E2E-ИС-21';

/** Календарная дата, сдвинутая относительно сегодняшнего дня. */
function shiftDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Логин').fill(username);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
}

/** Создаёт преподавателя администратором через API (в рамках его сессии). */
async function ensureTeacher(page: Page): Promise<string> {
  const response = await page.request.post('/api/users', {
    data: {
      username: CURATOR.username,
      fullName: CURATOR.fullName,
      password: CURATOR.password,
      roles: ['teacher'],
    },
  });

  // Пользователь уже существует — это не ошибка для повторного прогона.
  if (response.status() === 201) {
    const created = (await response.json()) as { id: string };
    return created.id;
  }

  const list = await page.request.get('/api/users?limit=200');
  const body = (await list.json()) as { items: Array<{ id: string; username: string }> };
  const existing = body.items.find((item) => item.username === CURATOR.username);

  if (existing === undefined) {
    throw new Error(
      `Не удалось создать преподавателя: ${response.status()} ${await response.text()}`,
    );
  }

  return existing.id;
}

test.describe.configure({ mode: 'serial' });

// Сценарий длиннее обычного: шесть разделов подряд, каждая проверка ждёт
// перезапроса данных. Ставим запас, чтобы тест не падал на медленном прогоне.
test.setTimeout(120_000);

test.describe('Этап 2: год, группа, назначения', () => {
  test('админ заводит год, группу и назначение, преподаватель видит только своё', async ({
    page,
  }) => {
    await login(page, ADMIN.username, ADMIN.password);
    const teacherUserId = await ensureTeacher(page);

    // --- Учебный год ---
    await page.getByRole('link', { name: 'Учебный процесс' }).click();
    /** Раздел свёрнут: сначала раскрываем, потом ищем кнопку внутри. */
    await openSection(page, 'Учебные годы');
    /** Форма скрыта до нажатия: кнопка в шапке блока «Учебные годы». */
    await page.getByRole('button', { name: 'Создать год' }).click();
    await expect(page.getByRole('heading', { name: 'Новый учебный год' })).toBeVisible();

    const yearTitle = `E2E ${new Date().getFullYear()}/${new Date().getFullYear() + 1}`;

    /** Поля года — только внутри его карточки: на странице есть и другие формы. */
    const yearForm = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Новый учебный год' }) });

    await yearForm.getByLabel('Название').fill(yearTitle);
    await yearForm.getByLabel('Начало').fill(shiftDays(-120));
    await yearForm.getByLabel('Окончание').fill(shiftDays(600));
    await yearForm.getByLabel('Сделать активным').check();
    await yearForm.getByRole('button', { name: 'Создать год' }).click();

    await expect(page.getByRole('cell', { name: yearTitle })).toBeVisible();
    // Активным становится только что созданный год: у остальных badge «обычный».
    await expect(
      page.getByRole('row', { name: new RegExp(yearTitle) }).getByText('активный'),
    ).toBeVisible();

    // Периоды открываются для выбранного года. Новый период не создаём: у
    // года мастера уже есть период, и любой другой внутри тех же границ
    // пересечётся с ним — сервер справедливо ответит 409 (правило проверяется
    // интеграционными тестами API).
    await page
      .getByRole('row', { name: new RegExp(yearTitle) })
      .getByRole('button', { name: 'Периоды' })
      .click();
    await expect(page.getByRole('heading', { name: `Год ${yearTitle}` })).toBeVisible();

    // --- Группа ---
    await openSection(page, 'Группы');
    /** Та же схема: кнопка «Создать группу» в шапке блока «Группы». */
    await page.getByRole('button', { name: 'Создать группу' }).click();
    await expect(page.getByRole('heading', { name: 'Новая группа' })).toBeVisible();
    // Группа создаётся в активном году: отдельного выбора года в форме нет.
    await expect(page.getByText('Группа войдёт в активный год')).toBeVisible();

    /** Так же — внутри карточки группы. */
    const groupForm = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Новая группа' }) });

    await groupForm.getByLabel('Название').fill(GROUP);
    await groupForm.getByLabel('Курс').fill('2');
    await groupForm.getByLabel('Начало').fill(shiftDays(-120));
    await groupForm.getByLabel('Окончание').fill(shiftDays(600));
    await groupForm.getByRole('button', { name: 'Создать группу' }).click();

    await expect(page.getByRole('cell', { name: GROUP })).toBeVisible();

    // --- Предмет ---
    await page.getByRole('link', { name: 'Справочники' }).click();
    await expect(page.getByRole('heading', { name: 'Предметы' })).toBeVisible();

    await page.getByLabel('Название').first().fill(SUBJECT);
    await page.getByRole('button', { name: 'Добавить предмет' }).click();
    await expect(page.getByRole('cell', { name: SUBJECT })).toBeVisible();

    // --- Назначение ---
    await page.getByRole('link', { name: 'Учебный процесс' }).click();
    await openSection(page, 'Назначения');
    await page.getByRole('button', { name: 'Создать назначение' }).click();
    await expect(page.getByRole('heading', { name: 'Новое назначение' })).toBeVisible();

    // Формы назначения ищем внутри её карточки: на странице есть и другие поля
    // «Группа» — например в списке назначений.
    const assignmentForm = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Новое назначение' }) });

    await assignmentForm.getByLabel('Преподаватель').selectOption({ label: CURATOR.fullName });
    await assignmentForm.getByLabel('Предмет').selectOption({ label: SUBJECT });
    await assignmentForm.getByLabel('Группа').selectOption({ label: GROUP });
    await assignmentForm.getByLabel('Начало').fill(shiftDays(1));
    await assignmentForm.getByRole('button', { name: 'Назначить' }).click();

    await expect(page.getByRole('cell', { name: CURATOR.fullName })).toBeVisible();
    await expect(page.getByRole('cell', { name: SUBJECT })).toBeVisible();
    await expect(page.getByRole('cell', { name: GROUP })).toBeVisible();

    // --- Преподаватель видит только своё ---
    await page.getByRole('button', { name: 'Выйти' }).click();
    await login(page, CURATOR.username, CURATOR.password);

    await page.getByRole('link', { name: 'Учебный процесс' }).click();
    await openSection(page, 'Назначения');
    await expect(page.getByText('Здесь видны только ваши назначения')).toBeVisible();
    await expect(page.getByRole('cell', { name: SUBJECT })).toBeVisible();

    // Формы создания у преподавателя нет.
    await expect(page.getByRole('heading', { name: 'Новое назначение' })).toHaveCount(0);
    await expect(teacherUserId).toBeTruthy();
  });
});
