import { expect, test, type Page } from '@playwright/test';

/**
 * Снимки экранов для **визуального контроля** — не проверки.
 *
 * Запускаются только по запросу: `CAPTURE_SCREENS=1 npm run e2e:isolated`. Обычный прогон их
 * пропускает, чтобы десяток PNG не появлялся на каждой сборке.
 *
 * Почему снимки, а не сравнение с эталоном: локально сценарии идут на Windows, в CI — на Linux,
 * и шрифты там рисуются разными движками. Эталон, снятый на Windows, в CI падал бы всегда — то
 * есть проверка превратилась бы в вечно красную и была бы отключена через неделю. Структурные
 * нарушения (сырые контролы, классы палитры вместо токенов) ловит отдельная проверка `check:ui`,
 * а снимки нужны человеку: посмотреть, что «не поехало».
 *
 * Снимки складываются в `.local-screens` — каталог вне репозитория (см. `.gitignore`).
 */

const CAPTURE = process.env.CAPTURE_SCREENS === '1';
const OUTPUT = '.local-screens';

/** Учётная запись, которую создаёт `phase-1-flow.spec.ts` (этот файл идёт после него). */
const ADMIN = { username: 'admin', password: 'e2e-rukovoditel-2025' };

/**
 * Экраны для снимка.
 *
 * `expand` — раскрыть все спойлеры: иначе на снимке видна только сводка, а содержимое блоков
 * остаётся непроверенным.
 */
const SCREENS = [
  { path: '/', name: '01-overview' },
  { path: '/schedule', name: '02-schedule' },
  { path: '/analytics', name: '03-grades' },
  { path: '/submitted', name: '04-submitted' },
  { path: '/catalogs', name: '05-catalogs', expand: true },
  { path: '/academic-process', name: '06-academic-process', expand: true },
  { path: '/lessons', name: '07-lessons' },
  { path: '/users', name: '08-users' },
  { path: '/privacy', name: '09-privacy' },
  { path: '/settings', name: '10-settings', expand: true },
];

const THEMES = ['light', 'dark'] as const;

async function login(page: Page): Promise<void> {
  await page.goto('/');

  const loginButton = page.getByRole('button', { name: 'Войти' });
  const logoutButton = page.getByRole('button', { name: 'Выйти' });

  await expect(loginButton.or(logoutButton)).toBeVisible();

  if (await loginButton.isVisible()) {
    await page.getByLabel('Логин').fill(ADMIN.username);
    await page.getByLabel('Пароль', { exact: true }).fill(ADMIN.password);
    await loginButton.click();
    await expect(logoutButton).toBeVisible();
  }
}

test.describe('снимки экранов', () => {
  test.skip(!CAPTURE, 'снимки снимаются только по запросу: CAPTURE_SCREENS=1');

  test('снять экраны в обеих темах', async ({ page }) => {
    /** Плотный экран: иначе в кадр попадает мало строк и «поехавшее» не видно. */
    await page.setViewportSize({ width: 1440, height: 1000 });

    await login(page);

    for (const theme of THEMES) {
      for (const screen of SCREENS) {
        await page.goto(screen.path);

        /**
         * Тема переключается атрибутом на `<html>` — это единственный переключатель, поэтому
         * снимок делается тем же механизмом, каким будет пользоваться человек.
         *
         * Скрипт передаётся **строкой**: в типах e2e нет DOM (`document`), а тянуть библиотеку
         * ради двух строк не стоит. Значение берётся из `THEMES`, то есть из литерала.
         */
        await page.evaluate(`document.documentElement.dataset.theme = '${theme}'`);

        if (screen.expand === true) {
          for (const summary of await page.locator('summary').all()) {
            await summary.click();
          }
        }

        /** Ждём, пока доедет содержимое: иначе на снимке окажутся «Загружаем…». */
        await page.waitForTimeout(400);

        await page.screenshot({
          path: `${OUTPUT}/${theme}-${screen.name}.png`,
          fullPage: true,
        });
      }
    }
  });
});
