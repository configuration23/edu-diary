import { describe, expect, it } from 'vitest';

import { measureNesting, measureSources, toMarkdown, tokenizeTags } from './ui-inventory.mjs';

/**
 * Замеры интерфейса.
 *
 * Проверяем **сами замеры**, а не отчёт: если считать неправильно, отчёт будет уверенно врать, а
 * решения по нему — неверными. Тонкие места здесь два: разбор JSX в атрибутах со стрелочными
 * функциями и отсев дженериков TypeScript.
 */

function source(path, text) {
  return { path, text };
}

describe('разбор тегов', () => {
  it('стрелочная функция в атрибуте не обрывает тег', () => {
    /**
     * `onChange={(event) => …}` содержит `>` внутри атрибута. Простой поиск до первого `>` сломался
     * бы здесь и занизил вложенность у любого обработчика.
     */
    const tags = tokenizeTags('<Card onClick={(event) => setX(event.target.value)}>');

    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ name: 'Card', isClosing: false, selfClosing: false });
  });

  it('дженерик TypeScript не считается тегом', () => {
    /** `useState<string | null>` — это тип, а не разметка: иначе каждый такой вызов давал бы уровень. */
    const tags = tokenizeTags('const [value, setValue] = useState<string | null>(null);');

    expect(tags).toHaveLength(0);
  });

  it('самозакрывающийся тег не открывает уровень', () => {
    expect(tokenizeTags('<TextInput />')[0]).toMatchObject({ selfClosing: true });
  });
});

describe('глубина вложенности', () => {
  const nested = source(
    'apps/web/src/screens/Example.tsx',
    `<Page>
  <Card>
    <Section>
      <div>
        <span>текст</span>
      </div>
    </Section>
  </Card>
</Page>`,
  );

  it('считает глубину по разметке', () => {
    const nesting = measureNesting([nested]);

    /** Page=1, Card=2, Section=3, div=4, span=5. */
    expect(nesting.deepest).toBe(5);
    expect(nesting.average).toBe(3);
  });

  it('считает, сколько блоков вложено в блоки', () => {
    const nesting = measureNesting([nested]);

    /** `Card` внутри `Page` — один блок; `Section` внутри двух блоков. */
    const card = nesting.blocks.find((item) => item.tag === 'Card');
    const section = nesting.blocks.find((item) => item.tag === 'Section');

    expect(card?.maxBlockDepth).toBe(1);
    expect(section?.maxBlockDepth).toBe(2);
  });

  it('выделяет глубокую разметку отдельно', () => {
    const nesting = measureNesting([nested]);

    /** Глубже пятого уровня здесь ничто не идёт — порог должен срабатывать по факту. */
    expect(nesting.deepElements).toBe(0);
  });
});

describe('замеры целиком', () => {
  const sources = [
    source(
      'apps/web/src/screens/One.tsx',
      `<Card title="Список" actions={<Button>Добавить</Button>}>
  <select className="rounded-md border border-slate-300" />
</Card>`,
    ),
    source(
      'apps/web/src/screens/Two.tsx',
      `<Card title="Новый предмет">
  <TextField />
</Card>`,
    ),
  ];

  it('находит сырые контролы и скопированную рамку', () => {
    const metrics = measureSources(sources);

    expect(metrics.rawControls.find((item) => item.name === '<select>')?.count).toBe(1);
    expect(metrics.frame.count).toBe(1);
  });

  it('отличает создание по кнопке от отдельной карточки', () => {
    const metrics = measureSources(sources);

    expect(metrics.createPlacement.byButton).toEqual([]);
    expect(metrics.createPlacement.standaloneCard).toEqual(['apps/web/src/screens/Two.tsx']);
  });

  it('отчёт собирается и содержит ключевые разделы', () => {
    const markdown = toMarkdown(measureSources(sources));

    expect(markdown).toContain('# Замеры интерфейса');
    expect(markdown).toContain('## Вложенность элементов');
    expect(markdown).toContain('## Экраны: где расхождений больше');
  });
});
