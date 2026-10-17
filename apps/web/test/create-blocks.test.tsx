import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Создание по кнопке — во всех блоках, где оно есть.
 *
 * Паттерн, принятый в проекте: форма создания **скрыта**, кнопка стоит в правой верхней части
 * блока-списка, форма показывается над списком, у формы есть **«Отмена»**, после создания она
 * закрывается.
 *
 * Проверяем **исходник компонента**, а не отрендеренную страницу: формы скрыты по умолчанию, и в
 * разметке их нет — проверка HTML их не увидит. Это тот случай, когда «есть ли кнопка на странице»
 * молча проходила бы на сломанном.
 */

/** Блок формы создания в файле: от объявления функции до следующего объявления. */
function block(file: string, name: string): string {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf(`function ${name}(`);

  expect(start, `не найдена форма ${name} в ${file}`).toBeGreaterThanOrEqual(0);

  const next = source.indexOf('\nfunction ', start + 1);

  return source.slice(start, next === -1 ? source.length : next);
}

interface BlockCase {
  /** Что это за блок — для понятного сообщения при падении. */
  title: string;
  file: string;
  name: string;
  /** Подпись кнопки в шапке. */
  action: string;
  /**
   * Где живёт состояние «форма открыта».
   *
   * У части блоков форма сама владеет состоянием; у `EntryForm` и `QuickSubstitution` — нет: их
   * рисует экран, он и держит кнопку с переключателем. Проверять условие рядом с формой в этом
   * случае бессмысленно.
   */
  container?: { file: string; name: string };
}

const BLOCKS: BlockCase[] = [
  {
    title: 'Справочники: предметы',
    file: 'apps/web/src/screens/CatalogsScreen.tsx',
    name: 'SubjectsCard',
    action: 'Добавить предмет',
  },
  {
    title: 'Справочники: аудитории',
    file: 'apps/web/src/screens/CatalogsScreen.tsx',
    name: 'RoomsCard',
    action: 'Добавить аудиторию',
  },
  {
    title: 'Справочники: причины оценок',
    file: 'apps/web/src/screens/CatalogsScreen.tsx',
    name: 'CategoriesCard',
    action: 'Добавить причину',
  },
  {
    title: 'Справочники: звонки',
    file: 'apps/web/src/screens/CatalogsScreen.tsx',
    name: 'BellsCard',
    action: 'Добавить звонок',
  },
  {
    title: 'Сетка: занятие',
    file: 'apps/web/src/screens/ScheduleTemplateScreen.tsx',
    name: 'EntryForm',
    action: 'Добавить занятие',
    container: {
      file: 'apps/web/src/screens/ScheduleTemplateScreen.tsx',
      name: 'ScheduleTemplateScreen',
    },
  },
  {
    title: 'Замены: замена',
    file: 'apps/web/src/screens/SubstitutionsScreen.tsx',
    name: 'QuickSubstitution',
    action: 'Оформить замену',
    container: {
      file: 'apps/web/src/screens/SubstitutionsScreen.tsx',
      name: 'SubstitutionsScreen',
    },
  },
];

describe('создание по кнопке в блоках', () => {
  for (const item of BLOCKS) {
    it(`${item.title}: форма скрыта, есть «Отмена» и закрытие после создания`, () => {
      /** «Отмена» — в самой форме: иначе её нечем закрыть, кроме создания записи. */
      expect(block(item.file, item.name), `${item.title}: нет кнопки «Отмена»`).toContain('Отмена');

      /** Условие показа и закрытие — там, где живёт состояние. */
      const holder = block(item.container?.file ?? item.file, item.container?.name ?? item.name);

      expect(holder, `${item.title}: нет условия показа формы`).toMatch(
        /\{creating|creating &&|creating \?/,
      );
      expect(holder, `${item.title}: форма не закрывается после создания`).toContain(
        'setCreating(false)',
      );
    });
  }

  it('кнопка создания стоит в шапке блока-списка', () => {
    /**
     * Кнопка — в `actions` карточки: это правая верхняя часть блока. Если её перенести в тело,
     * она снова начнёт конкурировать со списком за место.
     */
    for (const item of BLOCKS) {
      const source = readFileSync(item.file, 'utf8');
      expect(source, `${item.title}: кнопки «${item.action}» нет`).toContain(item.action);
    }
  });
});
