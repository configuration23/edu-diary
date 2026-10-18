import { describe, expect, it } from 'vitest';

import { checkSources, findViolations } from './ui-rules.mjs';

/**
 * Замок оформления.
 *
 * Проверяем **и то, что правило ловит, и то, что оно не ловит лишнего**: второе важнее. Проверка,
 * которая срабатывает на правильном коде, будет отключена через неделю — вместе с пользой.
 */
const file = (text) => ({ path: 'apps/web/src/screens/Example.tsx', text });

describe('палитра вместо ролей', () => {
  it('ловит оттенок палитры в классе', () => {
    const found = findViolations(file('<span className="text-slate-500">x</span>'));

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe('палитра');
  });

  it('не ловит роли темы и цвет предмета', () => {
    /** Роли — цель проверки; цвет предмета приходит из базы и классом не задаётся. */
    const found = findViolations(
      file(
        '<div className="bg-card text-muted-foreground border-border">' +
          '<span style={{ backgroundColor: subjectColor(id) }} />' +
          '</div>',
      ),
    );

    expect(found).toEqual([]);
  });
});

describe('сырые контролы', () => {
  it('ловит select, textarea, чекбокс и файл', () => {
    const found = findViolations(
      file('<select /><textarea /><input type="checkbox" /><input type="file" />'),
    );

    expect(found.map((item) => item.found)).toEqual([
      '<select>',
      '<textarea>',
      '<input type="checkbox">',
      '<input type="file">',
    ]);
  });

  it('не ловит примитивы', () => {
    expect(findViolations(file('<Select /><Textarea /><Checkbox /><FilePicker />'))).toEqual([]);
  });
});

describe('отступы стека', () => {
  it('пропускает три разрешённых значения', () => {
    expect(
      findViolations(
        file(
          '<div className="flex flex-col gap-1" /><div className="flex flex-col gap-3" /><div className="flex flex-col gap-6" />',
        ),
      ),
    ).toEqual([]);
  });

  it('ловит остальные значения', () => {
    const found = findViolations(file('<div className="flex flex-col gap-4" />'));

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe('отступ стека');
  });

  it('горизонтальный ряд не проверяется', () => {
    /** В строке `gap-2` — расстояние между кнопками, а не отступ между блоками. */
    expect(findViolations(file('<div className="flex gap-2" />'))).toEqual([]);
  });
});

describe('исключения', () => {
  it('файл примитивов исключён: в нём законно есть и select, и палитра', () => {
    const primitives = {
      path: 'apps/web/src/components/ui.tsx',
      text: '<select /><span className="text-slate-500" />',
    };

    expect(findViolations(primitives)).toEqual([]);
  });
});

describe('отчёт', () => {
  it('у каждого нарушения есть подсказка, чем заменить', () => {
    /** «Нельзя» без замены заставляет искать примитив самому — и обходить проверку. */
    const violations = checkSources([file('<select />')]);

    expect(violations[0].hint).toContain('Select');
  });

  it('указывает файл и строку', () => {
    const violations = checkSources([file('<div>\n  <select />\n</div>')]);

    expect(violations[0]).toMatchObject({ line: 2 });
    expect(violations[0].path).toContain('Example.tsx');
  });
});
