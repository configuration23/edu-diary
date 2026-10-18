/**
 * Токены темы: светлая и тёмная описывают **один и тот же** набор.
 *
 * Главная ошибка тем — забыть значение в тёмной теме. Внешне это выглядит как «место стало
 * нечитаемым», и искать причину приходится по всему интерфейсу. Проверка сравнивает наборы имён и
 * падает, если в одной из тем чего-то не хватает.
 *
 * Модуль ничего не меняет: читает CSS и отдаёт имена токенов по блокам — его же можно использовать
 * в `check:ui`.
 */

/** Вырезать содержимое блока по открывающей строке: до парной закрывающей скобки. */
function sliceBlock(source, headerPattern) {
  const match = headerPattern.exec(source);

  if (match === null) return null;

  let depth = 0;

  for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;

    if (source[index] === '}') {
      depth -= 1;

      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }

  return null;
}

/** Имена цветовых токенов внутри куска CSS. */
export function colorTokens(css) {
  return [...css.matchAll(/--color-([a-z-]+)\s*:/g)].map((match) => match[1]).sort();
}

/** Светлая тема — блок `@theme`. */
export function lightTokens(source) {
  const block = sliceBlock(source, /@theme\s*\{/);

  return block === null ? [] : colorTokens(block);
}

/** Тёмная тема — правила `[data-theme='dark']`. Кавычки допускаются одинарные и двойные. */
export function darkTokens(source) {
  const blocks = [...source.matchAll(/:root\[data-theme=['"]dark['"]\]\s*\{/g)];

  return blocks.flatMap((match) => {
    const block = sliceBlock(source.slice(match.index), /:root\[data-theme=['"]dark['"]\]\s*\{/);

    return block === null ? [] : colorTokens(block);
  });
}

/**
 * Токены, которых не хватает в тёмной теме.
 *
 * Цвета статусов и акцента нужны обеим темам: если значение задано только в светлой, в тёмной
 * получится цвет светлой темы на тёмном фоне — то есть нечитаемый текст.
 */
export function missingInDark(source) {
  const light = new Set(lightTokens(source));
  const dark = new Set(darkTokens(source));

  return [...light].filter((token) => !dark.has(token));
}

/** Токены, которые есть только в тёмной теме: почти всегда опечатка в имени. */
export function missingInLight(source) {
  const light = new Set(lightTokens(source));
  const dark = new Set(darkTokens(source));

  return [...dark].filter((token) => !light.has(token));
}
