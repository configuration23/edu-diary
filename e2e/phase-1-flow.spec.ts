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

    /**
     * Состояние системы переехало с «Обзора» в **профиль** и показывается **только администратору**
     * (решения владельца, Этап 6). Идём туда **через имя в шапке** — единственный путь: в меню
     * профиля нет. Заодно проверяем, что этот вход работает.
     */
    await page.getByRole('link', { name: ADMIN.fullName }).click();
    await expect(page.getByTestId('health-status')).toContainText('Сервер и база данных доступны');
  });

  test('администратор создаёт пользователя с ролью преподавателя', async ({ page }) => {
    await ensureSession(page, ADMIN.username, ADMIN.password);
    await page.getByRole('link', { name: 'Учётные записи и роли' }).click();

    // Поля ищем внутри карточки «Новый пользователь»: ниже на странице есть
    // блок «Новый ученик» со своими полями, в том числе «ФИО».
    //
    // Блок один, с вкладками: «Учётная запись» (открыта по умолчанию) и «Законный
    // представитель».
    const userForm = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Новый пользователь' }) });

    await userForm.getByLabel('Логин').fill(TEACHER.username);
    await userForm.locator('input[name="fullName"]').fill(TEACHER.fullName);
    await userForm.getByLabel('Временный пароль').fill(TEACHER.password);

    // Роли по умолчанию отмечен преподаватель — проверяем и оставляем.
    await expect(userForm.getByLabel('Преподаватель')).toBeChecked();
    await userForm.getByRole('button', { name: 'Создать учётную запись' }).click();

    await expect(page.getByText('Учётная запись создана', { exact: false })).toBeVisible();
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
    await expect(page.getByRole('link', { name: 'Учётные записи и роли' })).toHaveCount(0);
  });

  test('пользователь меняет свой пароль и входит с новым', async ({ page }) => {
    await ensureSession(page, TEACHER.username, TEACHER.password);

    /**
     * Смена пароля теперь в **профиле** (Этап 6, решение владельца): раньше была на «Обзоре». Идём
     * туда **через имя в шапке** — заодно проверяем, что этот вход работает, а не только прямой
     * адрес.
     */
    await page.getByRole('link', { name: TEACHER.fullName }).click();
    await expect(page.getByRole('heading', { name: 'Профиль' })).toBeVisible();

    await page.getByLabel('Текущий пароль').fill(TEACHER.password);
    await page.getByLabel('Новый пароль', { exact: true }).fill(TEACHER.newPassword);
    await page.getByLabel('Повтор нового пароля').fill(TEACHER.newPassword);
    await page.getByRole('button', { name: 'Сменить пароль' }).click();

    await expect(page.getByText('Пароль изменён')).toBeVisible();

    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();

    await login(page, TEACHER.username, TEACHER.newPassword);

    /**
     * Имя теперь встречается **дважды**: ссылка в шапке и поле в профиле. Поэтому проверяем
     * именно значение в профиле — иначе проверка «вход удался» ловила бы шапку, которая есть и
     * до входа.
     */
    await page.getByRole('link', { name: TEACHER.fullName }).click();
    await expect(page.getByRole('main').getByText(TEACHER.fullName)).toBeVisible();
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

  /**
   * Консоль браузера должна оставаться чистой.
   *
   * Здесь, а не в отдельном файле: мастер настройки проходится в этом же наборе, и
   * на чистой базе система существует только начиная отсюда. Отдельный файл шёл
   * первым по алфавиту, попадал на экран мастера и падал.
   *
   * Разделяем дефект и ожидаемое:
   * - **исключения страницы и сообщения консоли** — дефект;
   * - **500 и выше** — дефект сервера;
   * - **401** — сессии нет. Один такой ответ на загрузку страницы нормален: cookie
   *   сессии `httpOnly`, и приложение обязано спросить сервер. Больше — значит, после
   *   выхода запросы предыдущего пользователя продолжают уходить без сессии (так и
   *   было: семь-восемь 401 подряд);
   * - **403** — права: роль просит то, чего ей не положено. Это не дефект.
   *
   * Отдельная ловушка: браузер печатает «Failed to load resource» на каждый неудачный
   * ответ. Если считать это ошибкой приложения, проверка начнёт падать на ожидаемых
   * 403, поэтому такие сообщения отбрасываем, а ответы считаем по статусам.
   */
  test('консоль браузера чиста при обходе разделов', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const serverErrors: string[] = [];
    const unauthorized: string[] = [];

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (message.text().includes('Failed to load resource')) return;
      consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/')) return;

      const label = `${String(response.status())} ${url.pathname}`;
      if (response.status() >= 500) serverErrors.push(label);
      if (response.status() === 401) unauthorized.push(label);
    });

    // Входим администратором: у него доступны все разделы.
    await ensureSession(page, ADMIN.username, ADMIN.password);

    const lessons = await page.request.get('/api/lessons');
    const lessonId = ((await lessons.json()) as { items: Array<{ id: string }> }).items[0]?.id;

    const screens = [
      '/',
      '/academic-process',
      '/catalogs',
      '/schedule',
      '/schedule/template',
      '/substitutions',
      '/lessons',
      ...(lessonId === undefined ? [] : [`/lessons/${lessonId}`]),
      '/users',
      '/privacy',
      '/audit',
      '/security',
      '/settings',
    ];

    for (const path of screens) {
      await page.goto(path);
      await expect(page.getByRole('link', { name: 'Обзор' })).toBeVisible();
    }

    /**
     * Старые адреса объединённых разделов **перенаправляют** на «Учебный процесс».
     *
     * Без перенаправления закладки на «Учебный год», «Группы и ученики» и «Назначения» отдавали бы
     * «страница не найдена» — человек решил бы, что раздел пропал.
     */
    for (const legacy of ['/academics', '/groups', '/assignments']) {
      await page.goto(legacy);
      await expect(page).toHaveURL(/\/academic-process$/);
      await expect(page.getByRole('heading', { name: 'Учебный процесс' })).toBeVisible();
    }

    /**
     * В меню больше нет старых пунктов: иначе объединение не видно, и человек продолжит ходить по
     * трём разделам, между которыми только что убрали переходы.
     */
    for (const label of ['Учебный год', 'Группы и ученики', 'Назначения']) {
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    }

    expect(pageErrors, 'исключения страницы').toEqual([]);
    expect(consoleErrors, 'ошибки консоли').toEqual([]);
    expect(serverErrors, 'ошибки сервера').toEqual([]);

    /*
     * Один 401 на загрузку страницы — это проверка «есть ли сессия»: cookie `httpOnly`,
     * иначе не узнать. Разрешаем по одному на каждый переход, но не больше.
     */
    expect(unauthorized.length, `лишние 401: ${unauthorized.join(' | ')}`).toBeLessThanOrEqual(
      screens.length,
    );
  });

  /**
   * Прямые ссылки в закрытые разделы.
   *
   * Дефект, найденный владельцем: раздел, скрытый из меню, открывался по адресу — экран
   * монтировался, запросы уходили и получали `403`, а человек видел заголовок и фильтры
   * чужого раздела. Ученику, например, открывался шаблон занятий группы с данными.
   *
   * Решение владельца: на «нет такого адреса» и на «есть, но прав нет» отвечаем
   * **одинаково** — иначе разные ответы рассказывают, какие разделы существуют.
   *
   * Проверяем обе стороны: закрытое не открывается, **а разрешённое работает** — иначе
   * гейт можно «починить» так, что он закроет всё.
   */
  test('закрытые разделы не открываются по прямой ссылке', async ({ page }) => {
    /** Текст отказа: один и тот же для неизвестного адреса и для закрытого раздела. */
    const NOT_FOUND = 'Страница не найдена';

    const forbidden = async (path: string): Promise<void> => {
      await page.goto(path);
      await expect(
        page.getByText(NOT_FOUND),
        `закрытый адрес ${path} должен отвечать отказом`,
      ).toBeVisible();
    };

    const allowed = async (path: string): Promise<void> => {
      await page.goto(path);
      await expect(
        page.getByText(NOT_FOUND),
        `разрешённый адрес ${path} не должен отвечать отказом`,
      ).toHaveCount(0);
    };

    // Администратор: доступно всё, включая разделы, закрытые остальным.
    await ensureSession(page, ADMIN.username, ADMIN.password);
    for (const path of ['/', '/users', '/audit', '/security', '/settings', '/schedule/template']) {
      await allowed(path);
    }

    // Неизвестный адрес отвечает так же, как закрытый раздел: различий быть не должно.
    await forbidden('/такого-раздела-нет');

    // Учётная запись с уникальным логином: повторный прогон не должен упираться в занятый.
    const studentUsername = `uchenik-dostupa-${String(Date.now()).slice(-6)}`;

    const created = await page.request.post('/api/students', {
      data: {
        fullName: 'Ученик Доступа',
        account: { username: studentUsername, password: 'kolledzh-dostupa-2025' },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);

    // Ученик: доступны расписание, оценки и посещение; закрыто всё служебное.
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page.getByLabel('Логин')).toBeVisible();
    await login(page, studentUsername, 'kolledzh-dostupa-2025');
    /**
     * Убеждаемся, что вход состоялся: иначе проверки ниже падали бы на экране входа, а не
     * на гейте, и причину пришлось бы искать по скриншоту.
     */
    await expect(page.getByRole('link', { name: 'Обзор' })).toBeVisible();

    for (const path of ['/', '/schedule', '/analytics']) {
      await allowed(path);
    }

    for (const path of [
      '/users',
      '/audit',
      '/security',
      '/settings',
      '/catalogs',
      '/schedule/template',
      '/substitutions',
      '/lessons',
      /** Объединённая страница: ученику не положена — там годы, группы и назначения. */
      '/academic-process',
    ]) {
      await forbidden(path);
    }

    /**
     * Старые адреса объединённых разделов у ученика ведут на **тот же** закрытый экран.
     *
     * Проверяем, что это «Страница не найдена», а не ошибка: перенаправление не должно выдавать
     * ученику существование раздела и не должно показывать ему `403`.
     */
    for (const legacy of ['/academics', '/groups', '/assignments']) {
      await page.goto(legacy);
      await expect(page.getByText('Страница не найдена', { exact: false })).toBeVisible();
    }

    /** В меню ученика объединённого раздела нет: ему там нечего делать. */
    await expect(page.getByRole('link', { name: 'Учебный процесс' })).toHaveCount(0);

    /**
     * На **разрешённых** экранах ученик не должен получать `403` и `400`.
     *
     * Владелец видел иное: контекст учебного процесса запрашивал год, группы и назначения
     * безусловно, поэтому ученик получал по три отказа `403` на каждом экране, а в
     * «Оценках и посещении» уходили запросы без ученика и получали `400`. Повтор ошибок
     * тоже убран: `retry` теперь только для `5xx`.
     */
    const forbiddenResponses: string[] = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/')) return;
      const status = response.status();
      if (status === 403 || status === 400) {
        forbiddenResponses.push(`${String(status)} ${url.pathname}`);
      }
    });

    for (const path of ['/', '/schedule', '/analytics']) {
      await allowed(path);
      // Ждём ответы: проверка ниже смотрит, что успело прийти.
      await page.waitForTimeout(800);
    }

    expect(
      forbiddenResponses,
      `отказы на разрешённых экранах: ${forbiddenResponses.join(' | ')}`,
    ).toEqual([]);
  });
});
