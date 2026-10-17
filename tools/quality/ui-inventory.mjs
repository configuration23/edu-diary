/**
 * Замеры интерфейса: что и в каком количестве используется.
 *
 * Нужны для «причёсывания» оформления: увидеть, сколько на самом деле вариантов одного объекта
 * (кнопки, поля, ссылки, отступы), а не спорить по памяти. Модуль **ничего не меняет** и ничего не
 * запрещает — считает и отдаёт числа; отчёт по ним пишет `write-ui-inventory.mjs`.
 *
 * Почему отдельным инструментом, а не разовым скриптом: замеры нужны повторно — после каждого
 * этапа работ, и позже как основа для проверки `check:ui`. Отчёт, который нельзя пересчитать,
 * устаревает в тот же день.
 */

/** Класс рамки поля ввода, скопированный руками по месту. */
export const CONTROL_FRAME = 'rounded-md border border-slate-300';

/** Объекты интерфейса, у которых уже есть примитив в `components/ui.tsx` и `components/layout.tsx`. */
const PRIMITIVES = [
  'Button',
  'Field',
  'Card',
  'Section',
  'Spoiler',
  'Badge',
  'Alert',
  'Table',
  'EmptyState',
  'Toolbar',
  'QueryState',
  'PersonList',
];

/** Сырые контролы: элементы формы, нарисованные по месту вместо примитива. */
const RAW_CONTROLS = [
  { name: '<select>', pattern: /<select\b/g },
  { name: '<textarea>', pattern: /<textarea\b/g },
  { name: 'input[type=checkbox]', pattern: /<input[^>]*type="checkbox"/g },
  { name: 'input[type=file]', pattern: /<input[^>]*type="file"/g },
  { name: '<input> без type', pattern: /<input(?![^>]*\btype=)[^>]*>/g },
];

/** Акценты: цвета, которые претендуют на роль «главного». */
const ACCENTS = ['bg-blue-700', 'bg-slate-900', 'bg-red-700', 'bg-white'];

/** Способы сделать ссылку — со временем должен остаться один. */
const LINK_PATTERNS = [
  { name: 'text-blue-700 underline', pattern: /text-blue-700 underline/g },
  { name: 'cursor-pointer text-blue-700', pattern: /cursor-pointer text-blue-700/g },
  { name: 'activeProps (навигация)', pattern: /activeProps/g },
  { name: '<Link', pattern: /<Link\b/g },
];

/** Вложенное создание: запись, которая принадлежит конкретному объекту, а не разделу. */
const SCOPED_CREATE = ['Добавить период', 'Зачислить', 'Привязать', 'Добавить в расписание'];

/** Теги, которые считаются «блоками» интерфейса: их вложенность друг в друга — отдельная метрика. */
const BLOCK_TAGS = new Set(['Page', 'Card', 'Section', 'Spoiler', 'PageHeader']);

/**
 * Разобрать JSX-теги в тексте файла.
 *
 * Простой поиск `<...>` здесь не годится: в атрибутах встречаются стрелочные функции
 * (`onChange={(event) => …}`), и первый `>` обрывает тег на середине. Поэтому разбор идёт
 * посимвольно с учётом кавычек и фигурных скобок.
 *
 * Заодно отсекаются дженерики TypeScript: в `useState<string | null>` знак `<` стоит **после
 * буквы**, а JSX-тег — в позиции выражения. Без этого правила каждая типизированная переменная
 * добавляла бы ложный уровень вложенности.
 */
export function tokenizeTags(text) {
  const tags = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '<') continue;

    const next = text[index + 1];

    if (next === undefined) break;
    if (next === '>') continue; // фрагмент <> — уровня не добавляет

    const isClosing = next === '/';

    if (!isClosing && !/[A-Za-z]/.test(next)) continue;

    const before = index === 0 ? '' : text[index - 1];

    /** Знак `<` сразу после буквы или цифры — это тип, а не разметка. */
    if (!isClosing && /[\w$]/.test(before)) continue;

    let cursor = index + 1;
    let quote = null;
    let braces = 0;
    let selfClosing = false;

    for (; cursor < text.length; cursor += 1) {
      const character = text[cursor];

      if (quote !== null) {
        if (character === quote) quote = null;
        continue;
      }

      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        continue;
      }

      if (character === '{') {
        braces += 1;
        continue;
      }

      if (character === '}') {
        braces -= 1;
        continue;
      }

      if (character === '>' && braces === 0) {
        selfClosing = text[cursor - 1] === '/';
        break;
      }
    }

    const name = /^\/?([A-Za-z][\w.]*)/.exec(text.slice(index + 1, cursor));

    tags.push({ name: name === null ? null : name[1], isClosing, selfClosing });

    index = cursor;
  }

  return tags;
}

/**
 * Глубина вложенности элементов.
 *
 * Зачем: «окно в окне» — главная причина, по которой одинаковые блоки выглядят по-разному.
 * `Card` внутри `Section` внутри `Spoiler` даёт три рамки и три набора отступов; причёсывать
 * оформление, не зная глубины, значит править следствие, а не причину.
 */
export function measureNesting(sources) {
  const perFile = [];
  const histogram = new Map();
  const blocks = new Map();
  let deepest = 0;
  let elements = 0;
  let depthSum = 0;
  let deepElements = 0;

  for (const source of sources) {
    const stack = [];
    let fileMax = 0;

    for (const tag of tokenizeTags(source.text)) {
      if (tag.name === null) continue;

      if (tag.isClosing) {
        const matched = stack.lastIndexOf(tag.name);

        if (matched !== -1) stack.length = matched;

        continue;
      }

      const depth = stack.length + 1;
      const blockDepth = stack.filter((name) => BLOCK_TAGS.has(name)).length;

      fileMax = Math.max(fileMax, depth);
      elements += 1;
      depthSum += depth;
      histogram.set(depth, (histogram.get(depth) ?? 0) + 1);

      if (depth >= 6) deepElements += 1;

      if (BLOCK_TAGS.has(tag.name)) {
        const known = blocks.get(tag.name) ?? { count: 0, depthSum: 0, maxBlockDepth: 0 };

        known.count += 1;
        known.depthSum += depth;
        known.maxBlockDepth = Math.max(known.maxBlockDepth, blockDepth);
        blocks.set(tag.name, known);
      }

      if (!tag.selfClosing) stack.push(tag.name);
    }

    deepest = Math.max(deepest, fileMax);
    perFile.push({ path: source.path, maxDepth: fileMax });
  }

  return {
    deepest,
    average: elements === 0 ? 0 : Math.round((depthSum / elements) * 10) / 10,
    deepElements,
    histogram: [...histogram.entries()]
      .map(([depth, count]) => ({ depth, count }))
      .sort((left, right) => left.depth - right.depth),
    deepestFiles: perFile
      .sort((left, right) => right.maxDepth - left.maxDepth || left.path.localeCompare(right.path))
      .slice(0, 10),
    blocks: [...blocks.entries()]
      .map(([tag, value]) => ({
        tag,
        count: value.count,
        averageDepth: Math.round((value.depthSum / value.count) * 10) / 10,
        maxBlockDepth: value.maxBlockDepth,
      }))
      .sort((left, right) => right.maxBlockDepth - left.maxBlockDepth),
  };
}

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

function countAll(sources, pattern) {
  return sources.reduce((sum, source) => sum + countMatches(source.text, pattern), 0);
}

function filesMatching(sources, pattern) {
  return sources
    .filter((source) => countMatches(source.text, pattern) > 0)
    .map((source) => source.path);
}

/** Частоты значений: сколько раз встретилось каждое. Сортировка — по убыванию частоты. */
function frequencies(sources, pattern) {
  const seen = new Map();

  for (const source of sources) {
    for (const match of source.text.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      seen.set(value, (seen.get(value) ?? 0) + 1);
    }
  }

  return [...seen.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

/**
 * Посчитать метрики по исходникам.
 *
 * Вход — список `{ path, text }`: так функцию можно проверить на синтетических данных, не читая
 * диск, и переиспользовать для проверки `check:ui`.
 */
export function measureSources(sources) {
  const screens = sources.filter((source) => source.path.includes('/screens/'));

  return {
    totals: {
      files: sources.length,
      screens: screens.length,
      lines: sources.reduce((sum, source) => sum + source.text.split('\n').length, 0),
    },
    primitives: PRIMITIVES.map((name) => ({
      name,
      count: countAll(sources, new RegExp(`<${name}\\b`, 'g')),
      files: filesMatching(sources, new RegExp(`<${name}\\b`, 'g')).length,
    })),
    rawControls: RAW_CONTROLS.map((control) => ({
      name: control.name,
      count: countAll(sources, new RegExp(control.pattern.source, 'g')),
      files: filesMatching(sources, new RegExp(control.pattern.source, 'g')).length,
    })),
    frame: {
      count: countAll(sources, new RegExp(CONTROL_FRAME, 'g')),
      files: filesMatching(sources, new RegExp(CONTROL_FRAME, 'g')).length,
    },
    heights: frequencies(sources, /\bpy-(0\.5|1|1\.5|2|2\.5|3)\b/g),
    radii: frequencies(sources, /\brounded(?:-(?:sm|md|lg|xl|full))?\b/g),
    stacks: frequencies(sources, /flex flex-col gap-(\d)/g),
    paddings: frequencies(sources, /\bp-(\d)\b/g),
    colours: frequencies(sources, /(?:bg|text|border)-(slate|blue|sky|emerald|green|red|amber)-/g),
    accents: ACCENTS.map((token) => ({
      token,
      count: countAll(sources, new RegExp(token, 'g')),
      files: filesMatching(sources, new RegExp(token, 'g')),
    })),
    links: LINK_PATTERNS.map((link) => ({
      name: link.name,
      count: countAll(sources, new RegExp(link.pattern.source, 'g')),
    })),
    grids: frequencies(sources, /sm:grid-cols-(\d)/g),
    headings: frequencies(sources, /<h([1-3])\b/g),
    pageWidths: frequencies(sources, /<Page width="(\w+)"/g),
    nesting: measureNesting(sources),
    screens: screens
      .map((source) => ({
        path: source.path,
        rawControls: RAW_CONTROLS.reduce(
          (sum, control) =>
            sum + countMatches(source.text, new RegExp(control.pattern.source, 'g')),
          0,
        ),
        frame: countMatches(source.text, new RegExp(CONTROL_FRAME, 'g')),
        cards: countMatches(source.text, /<Card\b/g),
        sections: countMatches(source.text, /<Section\b/g),
        headings: countMatches(source.text, /<h[1-3]\b/g),
      }))
      .sort((left, right) => right.rawControls + right.frame - (left.rawControls + left.frame)),
    createPlacement: {
      byButton: filesMatching(screens, /setCreating/g),
      standaloneCard: filesMatching(screens, /title="(Новый|Новая|Новое)\s/g),
      scoped: SCOPED_CREATE.map((label) => ({
        label,
        files: filesMatching(sources, new RegExp(label, 'g')),
      })),
    },
  };
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;

  return [head, divider, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

/** Отчёт в Markdown. Числа — из замеров, ни одно не вписано руками. */
export function toMarkdown(metrics) {
  const rawControls = metrics.rawControls.reduce((sum, control) => sum + control.count, 0);
  const accents = metrics.accents.filter((accent) => accent.count > 0);
  const scoped = metrics.createPlacement.scoped.filter((item) => item.files.length > 0);

  return `# Замеры интерфейса

Отчёт **генерируется**: \`npm run ui:inventory\`. Руками не правится — правки затрутся при
следующем запуске, а числа разойдутся с кодом.

Файлов \`.tsx\`: **${metrics.totals.files}** (экранов: ${metrics.totals.screens}), строк: ${metrics.totals.lines}.

## Примитивы: что уже есть

${table(
  ['Объект', 'Использований', 'Файлов'],
  metrics.primitives.map((item) => [item.name, item.count, item.files]),
)}

## Дыра первая: контролы формы без примитива

${table(
  ['Элемент', 'Штук', 'Файлов'],
  metrics.rawControls.map((item) => [item.name, item.count, item.files]),
)}

Сырых контролов всего: **${rawControls}**. Рамка поля ввода \`${CONTROL_FRAME}\` скопирована руками
**${metrics.frame.count}** раз в ${metrics.frame.files} файлах — это один и тот же класс, повторённый
по месту.

## Дыра вторая: отступы без правила

${table(
  ['Отступ между блоками', 'Раз'],
  metrics.stacks.map((item) => [`flex flex-col gap-${item.value}`, item.count]),
)}

${table(
  ['Внутренний отступ', 'Раз'],
  metrics.paddings.map((item) => [`p-${item.value}`, item.count]),
)}

${table(
  ['Высота контрола', 'Раз'],
  metrics.heights.map((item) => [`py-${item.value}`, item.count]),
)}

${table(
  ['Радиус', 'Раз'],
  metrics.radii.map((item) => [item.value, item.count]),
)}

${table(
  ['Сетка формы', 'Раз'],
  metrics.grids.map((item) => [`sm:grid-cols-${item.value}`, item.count]),
)}

## Дыра третья: ссылки четырьмя способами

${table(
  ['Способ', 'Раз'],
  metrics.links.map((item) => [item.name, item.count]),
)}

## Акценты: сколько «главных» цветов

${table(
  ['Токен', 'Раз', 'Файлов'],
  accents.map((item) => [item.token, item.count, item.files.length]),
)}

Семейства цветов:

${table(
  ['Семейство', 'Раз'],
  metrics.colours.map((item) => [item.value, item.count]),
)}

## Заголовки и ширины страниц

${table(
  ['Уровень', 'Раз'],
  metrics.headings.map((item) => [`h${item.value}`, item.count]),
)}

${table(
  ['Ширина страницы', 'Раз'],
  metrics.pageWidths.map((item) => [item.value, item.count]),
)}

## Размещение создания

Создание по кнопке в шапке списка (файлов: ${metrics.createPlacement.byButton.length}):

${metrics.createPlacement.byButton.map((path) => `- \`${path}\``).join('\n')}

Отдельной постоянной карточкой (файлов: ${metrics.createPlacement.standaloneCard.length}):

${metrics.createPlacement.standaloneCard.map((path) => `- \`${path}\``).join('\n')}

Вложенное создание внутри объекта:

${scoped.length === 0 ? '_нет_' : scoped.map((item) => `- «${item.label}» — ${item.files.join(', ')}`).join('\n')}

## Вложенность элементов

Замер идёт **по файлу**: если спойлер на странице содержит экран, а тот рисует карточку, лишний\nуровень собирается из двух файлов и здесь не виден. Поэтому реальная вложенность на собранных\nстраницах **выше** этих чисел, а не равна им.\n\nМаксимальная глубина: **${metrics.nesting.deepest}**. Средняя: **${metrics.nesting.average}**.
Элементов глубже пятого уровня: **${metrics.nesting.deepElements}**.

${table(
  ['Уровень', 'Элементов'],
  metrics.nesting.histogram.map((item) => [item.depth, item.count]),
)}

Блоки и их вложенность друг в друга (сколько блоков внутри блока — сверху худшие):

${table(
  ['Блок', 'Штук', 'Средняя глубина', 'Максимум блоков внутри блока'],
  metrics.nesting.blocks.map((item) => [
    item.tag,
    item.count,
    item.averageDepth,
    item.maxBlockDepth,
  ]),
)}

Самые глубокие файлы:

${table(
  ['Файл', 'Глубина'],
  metrics.nesting.deepestFiles.map((item) => [
    `\`${item.path.replace(/^apps\/web\/src\//, '')}\``,
    item.maxDepth,
  ]),
)}

## Экраны: где расхождений больше

Отсортировано по сумме «сырые контролы + скопированная рамка».

${table(
  ['Экран', 'Сырых контролов', 'Рамка', 'Card', 'Section', 'Заголовков'],
  metrics.screens.map((screen) => [
    `\`${screen.path.replace(/^apps\/web\/src\/screens\//, '')}\``,
    screen.rawControls,
    screen.frame,
    screen.cards,
    screen.sections,
    screen.headings,
  ]),
)}
`;
}
