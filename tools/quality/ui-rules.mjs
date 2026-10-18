/**
 * Правила оформления: что запрещено в экранах.
 *
 * Зачем проверка, если всё уже приведено к одному виду: **правило без проверки живёт до первого
 * нового экрана**. Здесь ровно то, что уже случилось однажды — 51 копия класса рамки, 419 вхождений
 * палитры, шесть значений отступа.
 *
 * Модуль чистый: получает `{ path, text }`, отдаёт нарушения. Так его можно проверить тестом на
 * синтетике и переиспользовать в других проверках.
 */

/** Цветовые семейства палитры: в экранах их быть не должно — только роли темы. */
const PALETTE =
  /(?:^|[\s"'`:])(?:bg|text|border|divide|ring|from|to|via|hover:bg|hover:text|focus:border|focus:ring)-(slate|blue|sky|amber|emerald|green|red|zinc|gray|neutral)-\d{2,3}/g;

/** Сырые контролы: вид задаётся примитивом, а не разметкой экрана. */
const RAW_CONTROLS = [
  { pattern: /<select\b/g, name: '<select>', fallback: 'Select' },
  { pattern: /<textarea\b/g, name: '<textarea>', fallback: 'Textarea' },
  { pattern: /<input[^>]*type="checkbox"/g, name: '<input type="checkbox">', fallback: 'Checkbox' },
  { pattern: /<input[^>]*type="file"/g, name: '<input type="file">', fallback: 'FilePicker' },
];

/** Разрешённые отступы в стеках: inline, field, block. */
const ALLOWED_STACK_GAPS = new Set(['1', '3', '6']);
const STACK_GAP = /flex flex-col gap-(\d+)/g;

/**
 * Файлы, где правила не действуют.
 *
 * `ui.tsx` **определяет** примитивы: в нём и `<select>`, и чекбокс, и оттенки палитры в одном месте —
 * это единственное законное место для таких элементов. Иначе проверка требовала бы убрать то, из
 * чего состоит сам примитив.
 */
const EXEMPT = ['components/ui.tsx'];

function isExempt(path) {
  const normalized = path.split('\\').join('/');

  return EXEMPT.some((suffix) => normalized.endsWith(suffix));
}

/** Номер строки по индексу в тексте. */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Нарушения в одном файле.
 *
 * Каждое нарушение несёт **подсказку, чем заменить**: сообщение «нельзя» без замены заставляет
 * искать примитив самому, а значит — обходить проверку.
 */
export function findViolations({ path, text }) {
  if (isExempt(path)) return [];

  const violations = [];

  for (const match of text.matchAll(PALETTE)) {
    violations.push({
      path,
      line: lineOf(text, match.index ?? 0),
      rule: 'палитра',
      found: match[0].trim(),
      hint: 'цвет задаётся ролью темы: bg-card, text-foreground, border-input, bg-primary',
    });
  }

  for (const control of RAW_CONTROLS) {
    for (const match of text.matchAll(control.pattern)) {
      violations.push({
        path,
        line: lineOf(text, match.index ?? 0),
        rule: 'сырой контрол',
        found: control.name,
        hint: `используйте примитив ${control.fallback}`,
      });
    }
  }

  for (const match of text.matchAll(STACK_GAP)) {
    if (ALLOWED_STACK_GAPS.has(match[1])) continue;

    violations.push({
      path,
      line: lineOf(text, match.index ?? 0),
      rule: 'отступ стека',
      found: match[0],
      hint: 'допустимы gap-1 (inline), gap-3 (field), gap-6 (block)',
    });
  }

  return violations;
}

/** Нарушения по набору файлов. */
export function checkSources(sources) {
  return sources.flatMap((source) => findViolations(source));
}
