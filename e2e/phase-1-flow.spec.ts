import { expect, test, type Page } from '@playwright/test';

/**
 * Сквозной сценарий Этапа 1: мастер настройки → работа администратора → вход
 * под созданным пользователем, смена пароля и выход.
 *
 * Сценарии идут последовательно и меняют состояние системы (мастер проходится
 * один раз), поэтому файл один и запускается в одном потоке. Тест рассчитан на
 * пустую базу: в CI она создаётся заново, локально её нужно пересоздать
 * (`docker compose down -v` или отдельная база).
 */

const ADMIN = {
  username: 'admin',
  fullName: 'Администратор E2E',
  // Пароль не должен содержать логин: политика паролей это проверяет.
  password: 'e2e-rukovoditel-2025',
};

const TEACHER = {
  username: 'prepod-e2e',
  fullName: 'Преподаватель Электронный',
  password: 'e2e-prepodavatel-2025',
  newPassword: 'e2e-novyy-parol-2025',
};

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('Логин').fill(username);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
}

/**
 * Каждый тест Playwright получает чистый контекст браузера, поэтому сессию
 * нужно устанавливать заново. Ждём, пока приложение определит состояние
 * (экран входа или уже открытое приложение), и при необходимости входим.
 */
async function ensureSession(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/');

  const loginButton = page.getByRole('button', { name: 'Войти' });
  const logoutButton = page.getByRole('button', { name: 'Выйти' });

  await expect(loginButton.or(logoutButton)).toBeVisible();

  if (await loginButton.isVisible()) {
    await login(page, username, password);
    await expect(logoutButton).toBeVisible();
  }
}

test.describe.serial('Этап 1: настройка, вход, права', () => {
  test('на пустой базе приложение показывает мастер настройки', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Первичная настройка дневника' })).toBeVisible();
    await expect(page.getByText('Подключение к базе данных')).toBeVisible();
    await expect(page.getByText('применено', { exact: false })).toBeVisible();
  });

  test('мастер создаёт заведение, учебный год и администратора', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('Название учебного заведения').fill('Колледж E2E');
    await page.getByLabel('Короткое название').fill('E2E');
    await page.getByRole('button', { name: 'Далее' }).click();

    await expect(page.getByText('Шаг 2 из 3')).toBeVisible();
    await page.getByLabel('Учебный год').fill('2026/2027');
    await page.getByRole('button', { name: 'Далее' }).click();

    await expect(page.getByText('Шаг 3 из 3')).toBeVisible();
    await page.getByLabel('Логин администратора').fill(ADMIN.username);
    await page.getByLabel('ФИО администратора').fill(ADMIN.fullName);
    await page.getByLabel('Пароль', { exact: true }).fill(ADMIN.password);
    await page.getByLabel('Повтор пароля').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Завершить настройку' }).click();

    // Мастер заканчивается рабочим входом администратора.
    await expect(page.getByText(ADMIN.fullName)).toBeVisible();
    await expect(page.getByTestId('health-status')).toContainText('Сервер и база данных доступны');
  });

  test('администратор создаёт пользователя с ролью преподавателя', async ({ page }) => {
    await ensureSession(page, ADMIN.username, ADMIN.password);
    await page.getByRole('link', { name: 'Пользователи и роли' }).click();

    await page.getByLabel('Логин').fill(TEACHER.username);
    await page.getByLabel('ФИО').fill(TEACHER.fullName);
    await page.getByLabel('Временный пароль').fill(TEACHER.password);

    // Роли по умолчанию отмечен преподаватель — проверяем и оставляем.
    await expect(page.getByLabel('Преподаватель')).toBeChecked();
    await page.getByRole('button', { name: 'Создать пользователя' }).click();

    await expect(page.getByText('Пользователь создан', { exact: false })).toBeVisible();
    await expect(page.getByRole('cell', { name: TEACHER.username })).toBeVisible();
  });

  test('журнал аудита показывает настройку системы и изменение пользователей', async ({ page }) => {
    await ensureSession(page, ADMIN.username, ADMIN.password);
    await page.getByRole('link', { name: 'Аудит' }).click();

    await expect(page.getByText('setup_completed')).toBeVisible();
    await expect(page.getByText('create', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Администратор E2E').first()).toBeVisible();
  });

  test('выход и вход под созданным пользователем работают в браузере', async ({ page }) => {
    await ensureSession(page, ADMIN.username, ADMIN.password);

    // Неверный пароль: сообщение общее, без подсказок о существовании учётки.
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();

    await login(page, TEACHER.username, 'nepravilnyy-parol-2025');
    await expect(page.getByText('Неверный логин или пароль')).toBeVisible();

    await login(page, TEACHER.username, TEACHER.password);
    await expect(page.getByText(TEACHER.fullName)).toBeVisible();
    // Преподаватель не видит разделы администратора.
    await expect(page.getByRole('link', { name: 'Пользователи и роли' })).toHaveCount(0);
  });

  test('пользователь меняет свой пароль и входит с новым', async ({ page }) => {
    await ensureSession(page, TEACHER.username, TEACHER.password);

    await page.getByLabel('Текущий пароль').fill(TEACHER.password);
    await page.getByLabel('Новый пароль', { exact: true }).fill(TEACHER.newPassword);
    await page.getByLabel('Повтор нового пароля').fill(TEACHER.newPassword);
    await page.getByRole('button', { name: 'Сменить пароль' }).click();

    await expect(page.getByText('Пароль изменён')).toBeVisible();

    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();

    await login(page, TEACHER.username, TEACHER.newPassword);
    await expect(page.getByText(TEACHER.fullName)).toBeVisible();
  });

  test('просмотр карточки ученика и выгрузка попадают в аудит доступа', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { username: ADMIN.username, password: ADMIN.password },
    });
    expect(login.status()).toBe(200);
    const cookie = login.headers()['set-cookie'] ?? '';

    const students = await request.get('/api/students', { headers: { cookie } });
    expect(students.status()).toBe(200);

    const created = await request.post('/api/students', {
      headers: { cookie },
      data: { fullName: 'Ученик Браузерный' },
    });
    expect(created.status()).toBe(201);
    const student = (await created.json()) as { id: string };

    const card = await request.get(`/api/students/${student.id}`, { headers: { cookie } });
    expect(card.status()).toBe(200);

    const exported = await request.get('/api/students/export.csv', { headers: { cookie } });
    expect(exported.status()).toBe(200);
    expect(await exported.text()).toContain('Ученик Браузерный');

    const audit = await request.get(`/api/audit?entityKind=student&entityId=${student.id}`, {
      headers: { cookie },
    });
    const entries = (await audit.json()) as { items: Array<{ action: string; isAccess: boolean }> };

    expect(entries.items.some((item) => item.action === 'access' && item.isAccess)).toBe(true);

    const accessOnly = await request.get('/api/audit?accessOnly=true', { headers: { cookie } });
    const accessEntries = (await accessOnly.json()) as { items: Array<{ action: string }> };
    expect(accessEntries.items.some((item) => item.action === 'export')).toBe(true);
  });

  test('записи аудита невозможно изменить или удалить через API', async ({ request }) => {
    const login = await request.post('/api/auth/login', {
      data: { username: ADMIN.username, password: ADMIN.password },
    });
    const cookie = login.headers()['set-cookie'] ?? '';

    for (const method of ['patch', 'put', 'delete'] as const) {
      const response = await request[method]('/api/audit/00000000-0000-7000-8000-000000000000', {
        headers: { cookie },
        data: { action: 'poddelka' },
      });
      expect(response.status(), `${method} /api/audit/:id`).toBe(404);
    }
  });
});
