import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { darkTokens, lightTokens, missingInDark, missingInLight } from './theme-tokens.mjs';

/**
 * Токены темы.
 *
 * Проверка на реальном `index.css` и на синтетическом примере: первое ловит забытое значение в
 * настоящей теме, второе доказывает, что проверка вообще способна упасть.
 */
const REAL_CSS = readFileSync('apps/web/src/index.css', 'utf8');

const SYNTHETIC = `@theme {
  --color-card: #fff;
  --color-foreground: #000;
  --color-primary: #00f;
}

:root[data-theme='dark'] {
  --color-card: #111;
  --color-foreground: #eee;
}`;

describe('токены темы', () => {
  it('светлая и тёмная темы описывают одинаковый набор цветов', () => {
    /**
     * Забытое значение в тёмной теме — самая частая ошибка: место просто становится нечитаемым, и
     * причину ищут по всему интерфейсу.
     */
    expect(missingInDark(REAL_CSS)).toEqual([]);
    expect(missingInLight(REAL_CSS)).toEqual([]);
  });

  it('в тёмной теме заданы и поверхности, и текст, и акцент', () => {
    const tokens = darkTokens(REAL_CSS);

    for (const required of [
      'background',
      'card',
      'foreground',
      'muted-foreground',
      'primary',
      'primary-foreground',
      'danger',
    ]) {
      expect(tokens, `нет токена ${required}`).toContain(required);
    }
  });

  it('светлая тема содержит тот же набор ролей', () => {
    const tokens = lightTokens(REAL_CSS);

    for (const required of ['background', 'card', 'border', 'input', 'primary', 'primary-soft']) {
      expect(tokens, `нет токена ${required}`).toContain(required);
    }
  });

  it('проверка умеет падать: забытое значение видно', () => {
    /** Без этого тест «всё совпадает» ничего не доказывает — он может совпадать всегда. */
    expect(missingInDark(SYNTHETIC)).toEqual(['primary']);
  });

  it('лишнее значение в тёмной теме видно как опечатка', () => {
    const withTypo = SYNTHETIC.replace('--color-primary: #00f;', '--color-primary: #00f;').replace(
      '--color-foreground: #eee;',
      '--color-foreground: #eee;\n  --color-primray: #00f;',
    );

    expect(missingInLight(withTypo)).toEqual(['primray']);
  });
});
